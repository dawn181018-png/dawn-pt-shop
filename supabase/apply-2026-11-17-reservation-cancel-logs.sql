-- 2026-11-17 예약 "취소 내역" 기록 — 새 표 하나 + 예약 표에 기록용 트리거 + 기록 방식을 알려 주는 작은 함수 2개를 추가한다.
-- 기존 표의 칸·데이터는 한 줄도 바꾸거나 지우지 않고, 기존 함수(세션 차감·잔여·매출·예약 처리)도 바꾸지 않는다.
-- 무엇을 기록하나:
--   - 예약이 "취소"로 바뀌는 순간(한 건 취소 / 반복 예약 이후 전체 취소 / 꽉 찬 반복에서 밀려서 취소 / 대리 트레이너 취소)
--   - 취소되지 않은 예약이 "삭제"되는 순간(한 건 삭제 / 반복 이후 전체 삭제 / 남은 횟수에 맞춰 정리)
--   완료·노쇼 처리, 시간 변경은 취소가 아니므로 기록하지 않는다. 이미 취소된 예약을 지울 때도 다시 기록하지 않는다.
--   이 파일을 적용한 뒤에 일어난 취소부터 기록된다 — 예전 취소는 기록이 없다(복구하지 않는다).
-- 같은 처리로 묶음: 기록은 취소와 같은 트랜잭션에서 남긴다. 기록을 못 남기면 취소(삭제)도 함께 되돌아가고 화면에 실패 알림이 뜬다.
-- 보기 권한: 관리자 계정만 조회한다. 회원(member)·대리 트레이너(delegate) 계정은 조회 못 하고, 누구도 직접 쓰거나 고치거나 지울 수 없다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 다시 실행해도 안전하다.

create table if not exists reservation_cancel_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,                     -- 예약의 주인(관리자)
  reservation_id uuid not null,               -- 예약을 지워도 기록은 남도록 연결(FK)은 걸지 않는다
  customer_id uuid,
  customer_name text,                         -- 기록 당시 이름(나중에 바뀌거나 보관돼도 그대로)
  product_id uuid,
  product_name text,
  reservation_type text,                      -- pt / misc
  reservation_date date,
  reservation_time text,
  duration int,
  trainer_email text,                         -- 담당자: 비어 있음/'owner' = 대표, 그 밖 = 대리 트레이너 이메일
  trainer_name text,                          -- 기록 당시 담당자 이름(대표 / 대리 트레이너 이름)
  series_id uuid,
  from_series boolean not null default false, -- 반복 예약에서 나온 건인지
  old_status text,                            -- 취소(삭제) 전 상태: scheduled / done / noshow
  cancel_kind text not null check (cancel_kind in ('single', 'series', 'pushed', 'delete', 'other')),
  memo text,                                  -- 취소 사유(선택)
  actor_id uuid,                              -- 취소한 계정(없으면 서버/관리 도구)
  actor_role text not null check (actor_role in ('owner', 'delegate', 'member', 'system')),
  actor_name text,                            -- 대리 트레이너 이름(기록 당시)
  cancelled_at timestamptz not null default now()
);
create index if not exists idx_reservation_cancel_logs_owner on reservation_cancel_logs(owner_id, cancelled_at desc);
create index if not exists idx_reservation_cancel_logs_customer on reservation_cancel_logs(owner_id, customer_id, cancelled_at desc);

alter table reservation_cancel_logs enable row level security;
drop policy if exists "reservation_cancel_logs_owner_select" on reservation_cancel_logs;
create policy "reservation_cancel_logs_owner_select" on reservation_cancel_logs for select
  using (owner_id = auth.uid() and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('member', 'delegate'));
-- 조회만 — 쓰기는 아래 트리거만 한다(앱 계정에는 insert/update/delete 권한이 없다).
revoke all on reservation_cancel_logs from anon, authenticated;
grant select on reservation_cancel_logs to authenticated;
grant select on reservation_cancel_logs to service_role;

-- 예약 표 트리거: 취소·삭제가 일어난 줄마다 한 줄 기록. 실패하면 오류를 그대로 올려 취소 자체를 되돌린다.
-- 취소 방식: 화면이 아래 함수로 알려 준 값(이번 처리 안에서만 유효) → 없으면 "밀려서 취소" 표시(replaced_by) →
--            대리 트레이너면 한 건 취소(대리 화면의 취소는 한 건씩만 된다) → 그 밖은 기타. 삭제는 항상 "예약 삭제".
create or replace function log_reservation_cancel() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
  v_row reservations%rowtype;
  v_kind text := nullif(current_setting('app.cancel_kind', true), '');
  v_memo text := nullif(btrim(coalesce(current_setting('app.cancel_memo', true), '')), '');
  v_actor_role text;
  v_actor_name text;
  v_trainer_name text;
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from 'cancelled' or old.status = 'cancelled' then return new; end if;
    v_row := new;
    if v_kind is null then
      if new.replaced_by is not null then v_kind := 'pushed';
      elsif v_role = 'delegate' then v_kind := 'single';
      else v_kind := 'other';
      end if;
    end if;
  else -- DELETE
    if old.status = 'cancelled' then return old; end if; -- 이미 취소된 예약은 취소할 때 기록됨(또는 기록 이전 건)
    v_row := old;
    v_kind := 'delete';
  end if;

  if v_uid is null then v_actor_role := 'system';
  elsif v_role = 'delegate' then
    v_actor_role := 'delegate';
    select delegate_name into v_actor_name from lesson_delegations
      where delegate_user_id = v_uid order by created_at desc limit 1;
  elsif v_role = 'member' then v_actor_role := 'member';
  else v_actor_role := 'owner';
  end if;

  if v_row.trainer_email is null or v_row.trainer_email = 'owner' then v_trainer_name := '대표';
  else
    select delegate_name into v_trainer_name from lesson_delegations
      where owner_id = v_row.owner_id and lower(btrim(delegate_email)) = v_row.trainer_email
      order by created_at desc limit 1;
    v_trainer_name := coalesce(v_trainer_name, v_row.trainer_email);
  end if;

  insert into reservation_cancel_logs (owner_id, reservation_id, customer_id, customer_name, product_id, product_name,
    reservation_type, reservation_date, reservation_time, duration, trainer_email, trainer_name, series_id, from_series,
    old_status, cancel_kind, memo, actor_id, actor_role, actor_name)
  values (v_row.owner_id, v_row.id, v_row.customer_id,
    (select name from customers where id = v_row.customer_id),
    v_row.product_id, (select name from products where id = v_row.product_id),
    v_row.type, v_row.date, v_row.time, v_row.duration, v_row.trainer_email, v_trainer_name, v_row.series_id,
    v_row.series_id is not null, old.status,
    v_kind, v_memo, v_uid, v_actor_role, v_actor_name);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function log_reservation_cancel() from public, anon, authenticated;

drop trigger if exists trg_log_reservation_cancel on reservations;
create trigger trg_log_reservation_cancel after update of status or delete on reservations
  for each row execute function log_reservation_cancel();

-- 화면(관리자)이 취소할 때 "취소 방식·사유"를 함께 알려 주는 함수. 실제 처리는 기존 함수를 그대로 불러서 한다
-- (권한·세션 차감·잔여 규칙이 기존과 완전히 같다). 알려 준 값은 이 처리 안에서만 유효하다.
create or replace function cancel_reservation_logged(p_reservation_id uuid, p_product_id uuid, p_memo text default null)
returns jsonb
language plpgsql
security invoker
as $$
begin
  perform set_config('app.cancel_kind', 'single', true);
  perform set_config('app.cancel_memo', coalesce(p_memo, ''), true);
  return set_reservation_status(p_reservation_id, 'cancelled', p_product_id, '{}'::jsonb);
end;
$$;
revoke execute on function cancel_reservation_logged(uuid, uuid, text) from public, anon;
grant execute on function cancel_reservation_logged(uuid, uuid, text) to authenticated;

create or replace function close_series_from_logged(p_series_id uuid, p_from date, p_delete boolean, p_memo text default null)
returns jsonb
language plpgsql
security invoker
as $$
begin
  perform set_config('app.cancel_kind', 'series', true);
  perform set_config('app.cancel_memo', coalesce(p_memo, ''), true);
  return close_series_from(p_series_id, p_from, p_delete);
end;
$$;
revoke execute on function close_series_from_logged(uuid, date, boolean, text) from public, anon;
grant execute on function close_series_from_logged(uuid, date, boolean, text) to authenticated;

notify pgrst, 'reload schema';
