-- 2026-11-10 대리 화면 완료/노쇼 차감 순서: "먼저 등록한 이용권부터" — 기존 함수 proxy_set_reservation_status를 같은 내용으로
-- 다시 만들되, 차감할 이용권을 고르는 부분만 바꾼다(관리자 화면과 같은 규칙).
--   예전: 레슨에 묶인 이용권에 잔여가 있으면 그 이용권에서 차감, 소진·보관됐을 때만 먼저 등록한 이용권으로 넘어감.
--   이제: 묶인 이용권이 횟수권이면 그 고객의 잔여 있는 횟수권 중 가장 먼저 등록한 것에서 차감(다 쓰면 다음 이용권).
-- 표·데이터는 바꾸지 않는다(이미 처리된 레슨·사용 횟수·등록 정보 그대로). 앞으로 처리하는 완료/노쇼부터 적용된다.
-- 권한·대리 지정 확인·세션 차감 방식(1회, 총 횟수 안에서)·처리자 기록·담당자 검사는 예전과 같다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 다시 실행해도 안전하다.

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
    -- 먼저 등록한 이용권부터 차감: 묶인 이용권이 횟수권이면, 그 고객의 잔여 있는 유효(보관 안 됨) 횟수권 중
    -- 가장 먼저 등록한 것에서 차감한다(같은 날 등록이면 지금 묶인 이용권 먼저). 기간권 레슨은 그대로 둔다.
    if found and v_p.type = 'session' then
      select id into v_alt from products
        where customer_id = v_r.customer_id and owner_id = v_r.owner_id and type = 'session'
          and archived_at is null and total_sessions - used_sessions > 0
        order by created_at asc, (id = v_r.product_id) desc, id::text asc limit 1;
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
