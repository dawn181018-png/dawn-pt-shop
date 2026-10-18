-- 2026-10-19 꽉 찬 반복예약에 추가 레슨 등록 — 추가만 하는 마이그레이션(기존 데이터 변경·삭제 없음). 다시 실행해도 안전하다.
-- 1) 예약에 "취소 사유"와 "대신 등록된 예약" 칸 추가
alter table reservations add column if not exists cancel_reason text;
alter table reservations add column if not exists replaced_by uuid references reservations(id) on delete set null;

-- 2) 고객이 더 잡을 수 있는 예약 수 = 횟수권(삭제 안 된 것) 잔여 합계 − 이미 잡힌 예약됨 수 (화면의 unbookedSessions와 같은 식)
create or replace function customer_unbooked_sessions(p_owner uuid, p_customer uuid) returns int
language sql stable set search_path = public
as $$
  select (
    coalesce((select sum(greatest(0, p.total_sessions - p.used_sessions)) from products p
      where p.owner_id = p_owner and p.customer_id = p_customer and p.type = 'session' and p.archived_at is null), 0)
    - (select count(*) from reservations r
      where r.owner_id = p_owner and r.customer_id = p_customer and r.type = 'pt' and r.status = 'scheduled' and r.product_id is not null)
  )::int
$$;
revoke execute on function customer_unbooked_sessions(uuid, uuid) from public, anon;
grant execute on function customer_unbooked_sessions(uuid, uuid) to authenticated, service_role;

-- 3) 관리자: 반복 묶음의 마지막 회차를 취소하고 추가 레슨을 등록 — 한 함수(한 트랜잭션) 안에서 처리해, 새 예약 저장이
--    실패하면 취소도 되지 않는다. 취소 대상은 같은 고객의, 반복 묶음 안의, 앞으로 올(한국 시간 기준) "예약됨" 회차 중
--    그 묶음의 가장 마지막 회차만 허용한다(완료·노쇼·지난 회차·단발 예약은 불가). 회차는 지우지 않고 취소 상태로 남긴다.
--    세션 차감은 없다(완료 처리 때만 차감).
create or replace function add_lesson_replacing_last(
  p_customer_id uuid, p_product_id uuid, p_date date, p_time text, p_duration int, p_memo text, p_replace_id uuid
) returns jsonb
language plpgsql security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_b reservations%rowtype;
  v_new reservations%rowtype;
begin
  if v_owner is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('member', 'delegate') then raise exception 'not_allowed'; end if;
  if p_time !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception '시간 형식이 올바르지 않아요'; end if;
  perform 1 from products where id = p_product_id and customer_id = p_customer_id and owner_id = v_owner and archived_at is null;
  if not found then raise exception '이용권을 찾을 수 없어요'; end if;
  select * into v_b from reservations where id = p_replace_id and owner_id = v_owner and customer_id = p_customer_id for update;
  if not found then raise exception '취소할 회차를 찾을 수 없어요'; end if;
  if v_b.status <> 'scheduled' or v_b.type <> 'pt' or v_b.series_id is null
     or (v_b.date + v_b.time::time) <= (now() at time zone 'Asia/Seoul')
     or exists (select 1 from reservations x where x.series_id = v_b.series_id and x.owner_id = v_owner and x.status = 'scheduled'
                and (x.date, x.time) > (v_b.date, v_b.time)) then
    raise exception '반복 예약의 마지막 앞으로의 회차만 취소할 수 있어요';
  end if;
  insert into reservations (owner_id, customer_id, product_id, series_id, date, time, duration, memo, status, type)
  values (v_owner, p_customer_id, p_product_id, null, p_date, p_time, coalesce(p_duration, 50), coalesce(p_memo, ''), 'scheduled', 'pt')
  returning * into v_new;
  update reservations set status = 'cancelled', cancel_reason = '추가 레슨 등록으로 취소됨', replaced_by = v_new.id
    where id = v_b.id returning * into v_b;
  return jsonb_build_object('created', to_jsonb(v_new), 'cancelled', to_jsonb(v_b));
end;
$$;
revoke execute on function add_lesson_replacing_last(uuid, uuid, date, text, int, text, uuid) from public, anon;
grant execute on function add_lesson_replacing_last(uuid, uuid, date, text, int, text, uuid) to authenticated;

-- 4) 대리 트레이너: 같은 처리를 지정 고객·대리 기간 안에서만(DB가 매번 확인). 새 예약에는 대리 진행 기록을 남긴다.
create or replace function proxy_add_lesson_replacing_last(
  p_customer_id uuid, p_product_id uuid, p_date date, p_time text, p_duration int, p_replace_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_d lesson_delegations%rowtype;
  v_b reservations%rowtype;
  v_new reservations%rowtype;
begin
  v_d := proxy_delegation_for(p_customer_id);
  if v_d.id is null then raise exception 'not_delegated'; end if;
  if p_time !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception '시간 형식이 올바르지 않아요'; end if;
  if p_duration is null or p_duration < 10 or p_duration > 240 then raise exception '레슨 시간이 올바르지 않아요'; end if;
  if p_date < v_d.starts_on or (v_d.ends_on is not null and p_date > v_d.ends_on) then raise exception '대리 기간 밖의 날짜는 예약할 수 없어요'; end if;
  perform 1 from products where id = p_product_id and customer_id = p_customer_id and owner_id = v_d.owner_id and archived_at is null;
  if not found then raise exception '이용권을 찾을 수 없어요'; end if;
  select * into v_b from reservations where id = p_replace_id and owner_id = v_d.owner_id and customer_id = p_customer_id for update;
  if not found then raise exception '취소할 회차를 찾을 수 없어요'; end if;
  if v_b.status <> 'scheduled' or v_b.type <> 'pt' or v_b.series_id is null
     or (v_b.date + v_b.time::time) <= (now() at time zone 'Asia/Seoul')
     or exists (select 1 from reservations x where x.series_id = v_b.series_id and x.owner_id = v_d.owner_id and x.status = 'scheduled'
                and (x.date, x.time) > (v_b.date, v_b.time)) then
    raise exception '반복 예약의 마지막 앞으로의 회차만 취소할 수 있어요';
  end if;
  insert into reservations (owner_id, customer_id, product_id, series_id, date, time, duration, memo, status, type, delegation_id, delegate_name)
  values (v_d.owner_id, p_customer_id, p_product_id, null, p_date, p_time, p_duration, '', 'scheduled', 'pt', v_d.id, v_d.delegate_name)
  returning * into v_new;
  update reservations set status = 'cancelled', cancel_reason = '추가 레슨 등록으로 취소됨', replaced_by = v_new.id
    where id = v_b.id returning * into v_b;
  return jsonb_build_object('createdId', v_new.id, 'cancelledId', v_b.id);
end;
$$;
revoke execute on function proxy_add_lesson_replacing_last(uuid, uuid, date, text, int, uuid) from public, anon;
grant execute on function proxy_add_lesson_replacing_last(uuid, uuid, date, text, int, uuid) to authenticated;

-- 5) 대리 예약 함수에도 같은 "남은 횟수 안에서만" 검사를 넣는다(화면을 거치지 않아도 막히게)
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
  -- 남은 횟수 안에서만 예약(관리자 화면과 같은 규칙): 고객의 횟수권 잔여 합계 − 이미 잡힌 예약됨 수
  if v_p.type = 'session' and cardinality(p_dates) > customer_unbooked_sessions(v_d.owner_id, p_customer_id) then
    raise exception '남은 횟수보다 많이 예약할 수 없어요 (더 잡을 수 있는 예약 %회)', greatest(0, customer_unbooked_sessions(v_d.owner_id, p_customer_id));
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

notify pgrst, 'reload schema';
