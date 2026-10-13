-- 2026-10-13 대리 트레이너 화면을 관리자 스케줄 화면과 같은 모양으로 바꾸면서, 대리용 데이터 함수(proxy_context)에
-- 두 값만 더한다: 지정 고객의 "신규 여부"(이용권을 산 적 없는지, 참/거짓만)와 이용권의 1회 레슨 시간.
-- 금액·결제·다른 고객 정보는 여전히 보내지 않는다. 함수 교체만 하고 데이터는 바꾸지 않는다. 다시 실행해도 안전하다.

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
        -- 신규 고객 표시용: 이 고객이 이용권을 한 번도 산 적 없는지(보관·삭제된 이용권 포함). 금액은 보내지 않는다.
        'isNew', not exists (select 1 from products px where px.customer_id = c.id),
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
        'startDate', p.start_date, 'endDate', p.end_date, 'createdAt', p.created_at,
        'sessionDuration', p.session_duration
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

notify pgrst, 'reload schema';
