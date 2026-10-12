alter table customers add column if not exists archived_at timestamptz;
alter table products add column if not exists archived_at timestamptz;

create or replace function register_used_reservations(
  p_customer_id uuid, p_product_id uuid, p_status text, p_rows jsonb
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_p products%rowtype;
  v_count int := jsonb_array_length(p_rows);
  v_series uuid;
  v_r jsonb;
  v_created jsonb := '[]'::jsonb;
  v_row reservations%rowtype;
begin
  if p_status not in ('done', 'noshow') then raise exception '잘못된 상태예요'; end if;
  if v_count < 1 then raise exception '등록할 예약이 없어요'; end if;
  select * into v_p from products where id = p_product_id and owner_id = v_owner and customer_id = p_customer_id for update;
  if not found then raise exception '이용권을 찾을 수 없어요'; end if;
  if v_p.type = 'session' and v_p.total_sessions - v_p.used_sessions < v_count then
    raise exception '남은 횟수(%회)보다 많이 출석/결석으로 등록할 수 없어요', v_p.total_sessions - v_p.used_sessions;
  end if;
  if v_count > 1 then v_series := gen_random_uuid(); end if;
  for v_r in select * from jsonb_array_elements(p_rows) loop
    insert into reservations (owner_id, customer_id, product_id, series_id, date, time, duration, memo, status, type)
    values (v_owner, p_customer_id, p_product_id, v_series, (v_r->>'date')::date, v_r->>'time',
      coalesce((v_r->>'duration')::int, 50), coalesce(v_r->>'memo', ''), p_status, 'pt')
    returning * into v_row;
    v_created := v_created || to_jsonb(v_row);
  end loop;
  if v_p.type = 'session' then
    update products set used_sessions = greatest(0, least(total_sessions, used_sessions + v_count))
      where id = p_product_id returning * into v_p;
  end if;
  return jsonb_build_object('reservations', v_created, 'product', to_jsonb(v_p));
end;
$$;
grant execute on function register_used_reservations(uuid, uuid, text, jsonb) to authenticated;
grant execute on function register_used_reservations(uuid, uuid, text, jsonb) to service_role;

create or replace function close_series_from(p_series_id uuid, p_from date, p_delete boolean)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_affected int;
  v_products jsonb := '[]'::jsonb;
  v_fix record;
  v_p products%rowtype;
begin
  -- 대상 행을 먼저 잠근다(동시에 다른 처리와 겹치지 않게)
  perform 1 from reservations where series_id = p_series_id and owner_id = v_owner and date >= p_from for update;

  for v_fix in
    select product_id, count(*)::int as n from reservations
    where series_id = p_series_id and owner_id = v_owner and date >= p_from
      and status in ('done', 'noshow') and product_id is not null
    group by product_id
  loop
    update products set used_sessions = greatest(0, least(total_sessions, used_sessions - v_fix.n))
      where id = v_fix.product_id and owner_id = v_owner and type = 'session'
      returning * into v_p;
    if found then v_products := v_products || to_jsonb(v_p); end if;
  end loop;

  if p_delete then
    delete from reservations where series_id = p_series_id and owner_id = v_owner and date >= p_from;
  else
    update reservations set status = 'cancelled'
      where series_id = p_series_id and owner_id = v_owner and date >= p_from and status <> 'cancelled';
  end if;
  get diagnostics v_affected = row_count;
  return jsonb_build_object('affected', v_affected, 'products', v_products);
end;
$$;
grant execute on function close_series_from(uuid, date, boolean) to authenticated;
grant execute on function close_series_from(uuid, date, boolean) to service_role;

create or replace function proxy_context() returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_customer_ids uuid[];
  v_owner_ids uuid[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select coalesce(array_agg(distinct c), '{}'), coalesce(array_agg(distinct d.owner_id), '{}')
    into v_customer_ids, v_owner_ids
  from lesson_delegations d, unnest(d.customer_ids) c
  where d.delegate_user_id = v_uid and proxy_delegation_valid_for(d, c)
    and exists (select 1 from customers x where x.id = c and x.archived_at is null);

  return jsonb_build_object(
    'today', kst_today(),
    'delegations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', d.delegate_name, 'startsOn', d.starts_on, 'endsOn', d.ends_on,
        'active', exists (select 1 from unnest(d.customer_ids) c where proxy_delegation_valid_for(d, c)),
        'revoked', d.revoked_at is not null
      ) order by d.starts_on), '[]'::jsonb)
      from lesson_delegations d where d.delegate_user_id = v_uid
    ),
    'customers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name,
        'phoneMasked', case
          when coalesce(c.phone, '') = '' then null
          when c.phone ~ '^[0-9]{2,3}-[0-9]{3,4}-[0-9]{4}$' then split_part(c.phone, '-', 1) || '-****-' || split_part(c.phone, '-', 3)
          else left(c.phone, 3) || '****'
        end
      ) order by c.name), '[]'::jsonb)
      from customers c where c.id = any(v_customer_ids)
    ),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'customerId', p.customer_id, 'name', p.name, 'type', p.type,
        'totalSessions', p.total_sessions, 'usedSessions', p.used_sessions,
        'startDate', p.start_date, 'endDate', p.end_date, 'createdAt', p.created_at
      ) order by p.created_at), '[]'::jsonb)
      from products p where p.customer_id = any(v_customer_ids) and p.archived_at is null
    ),
    'reservations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'customerId', r.customer_id, 'productId', r.product_id, 'seriesId', r.series_id,
        'date', r.date, 'time', r.time, 'duration', r.duration, 'status', r.status,
        'workoutNote', r.workout_note, 'signed', r.signature_url is not null, 'delegateName', r.delegate_name
      ) order by r.date, r.time), '[]'::jsonb)
      from reservations r where r.type = 'pt' and r.customer_id = any(v_customer_ids)
    ),
    'busy', (
      select coalesce(jsonb_agg(jsonb_build_object('date', r.date, 'time', r.time, 'duration', r.duration) order by r.date, r.time), '[]'::jsonb)
      from reservations r
      where r.owner_id = any(v_owner_ids) and r.status <> 'cancelled'
        and not coalesce(r.type = 'pt' and r.customer_id = any(v_customer_ids), false)
        and r.date between kst_today() - 14 and kst_today() + 120
    )
  );
end;
$$;

create or replace function proxy_add_reservations(
  p_customer_id uuid, p_product_id uuid, p_dates date[], p_time text, p_duration int
) returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_d lesson_delegations%rowtype;
  v_p products%rowtype;
  v_series uuid;
  v_date date;
  v_count int := 0;
begin
  v_d := proxy_delegation_for(p_customer_id);
  if v_d.id is null then raise exception 'not_delegated'; end if;
  if p_time !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception '시간 형식이 올바르지 않아요'; end if;
  if p_duration is null or p_duration < 10 or p_duration > 240 then raise exception '레슨 시간이 올바르지 않아요'; end if;
  if p_dates is null or cardinality(p_dates) < 1 or cardinality(p_dates) > 26 then raise exception '예약 날짜가 올바르지 않아요'; end if;

  select * into v_p from products
    where id = p_product_id and customer_id = p_customer_id and owner_id = v_d.owner_id and archived_at is null;
  if not found then raise exception '이용권을 찾을 수 없어요'; end if;
  if (v_p.type = 'session' and v_p.total_sessions - v_p.used_sessions <= 0)
     or (v_p.type = 'period' and v_p.end_date is not null and v_p.end_date < kst_today()) then
    raise exception '소진된 이용권으로는 예약할 수 없어요';
  end if;

  if cardinality(p_dates) > 1 then v_series := gen_random_uuid(); end if;
  foreach v_date in array p_dates loop
    if v_date < v_d.starts_on or (v_d.ends_on is not null and v_date > v_d.ends_on) then
      raise exception '대리 기간 밖의 날짜는 예약할 수 없어요';
    end if;
    insert into reservations (owner_id, customer_id, product_id, series_id, date, time, duration, memo, status, type, delegation_id, delegate_name)
    values (v_d.owner_id, p_customer_id, p_product_id, v_series, v_date, p_time, p_duration, '', 'scheduled', 'pt', v_d.id, v_d.delegate_name);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function proxy_set_reservation_status(
  p_reservation_id uuid, p_status text, p_signature_url text default null, p_workout_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_r reservations%rowtype;
  v_d lesson_delegations%rowtype;
  v_delta int := 0;
  v_target uuid;
  v_alt uuid;
  v_p products%rowtype;
begin
  if p_status not in ('scheduled', 'done', 'noshow', 'cancelled') then raise exception '잘못된 상태예요'; end if;
  select * into v_r from reservations where id = p_reservation_id for update;
  if not found or v_r.type <> 'pt' or v_r.customer_id is null then raise exception 'not_delegated'; end if;
  v_d := proxy_delegation_for(v_r.customer_id);
  if v_d.id is null or v_d.owner_id <> v_r.owner_id then raise exception 'not_delegated'; end if;

  if p_status in ('done', 'noshow') and v_r.status not in ('done', 'noshow') then v_delta := 1;
  elsif v_r.status in ('done', 'noshow') and p_status not in ('done', 'noshow') then v_delta := -1;
  end if;

  v_target := v_r.product_id;
  if v_delta = 1 and v_target is not null then
    select * into v_p from products where id = v_target;
    -- 묶인 이용권이 소진됐거나 보관됐으면 그 고객의 가장 먼저 등록한 유효(보관 안 됨) 횟수권으로 전환
    if found and v_p.type = 'session' and (v_p.total_sessions - v_p.used_sessions <= 0 or v_p.archived_at is not null) then
      select id into v_alt from products
        where customer_id = v_r.customer_id and owner_id = v_r.owner_id and type = 'session'
          and archived_at is null and total_sessions - used_sessions > 0
        order by created_at asc limit 1;
      if v_alt is null then raise exception '차감할 수 있는 이용권이 없습니다. 담당 트레이너에게 재등록을 요청해주세요'; end if;
      v_target := v_alt;
    end if;
  end if;

  update reservations set
    status = p_status,
    product_id = v_target,
    signature_url = coalesce(p_signature_url, signature_url),
    workout_note = case when p_workout_note is null then workout_note else nullif(btrim(p_workout_note), '') end,
    delegation_id = v_d.id,
    delegate_name = v_d.delegate_name
  where id = v_r.id;

  if v_delta <> 0 and v_target is not null then
    update products set used_sessions = greatest(0, least(total_sessions, used_sessions + v_delta))
      where id = v_target and owner_id = v_r.owner_id and type = 'session';
  end if;

  return jsonb_build_object('switched', v_target is distinct from v_r.product_id, 'delta', v_delta);
end;
$$;

notify pgrst, 'reload schema';
