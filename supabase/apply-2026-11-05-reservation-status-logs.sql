-- 2026-11-05 레슨 "누가 처리했는지" 기록 — 새 표 하나 + 예약 표에 기록용 트리거를 추가하는 마이그레이션.
-- 기존 표의 데이터는 한 줄도 바꾸거나 지우지 않고, 기존 함수(세션 차감·예약 처리 등)도 바꾸지 않는다.
-- 예약의 상태가 바뀔 때마다(완료/노쇼/취소/예약됨으로 되돌림) 또는 처음부터 완료·노쇼로 등록될 때, 그 순간 로그인해 있던
-- 계정이 관리자인지 대리 트레이너인지를 한 줄 남긴다. 이 기록으로 "대리가 예약만 잡고 관리자가 완료"와 "대리가 직접 완료"를
-- 정확히 구분한다(서명 유무와 관계없이). 이 기능을 적용한 뒤에 바뀐 레슨부터 기록된다 — 지난 레슨은 기록이 없다.
-- 안전장치: 기록을 남기다 문제가 생겨도 레슨 처리 자체는 그대로 진행된다(기록만 건너뛰고 경고만 남김).
-- 관리자 계정만 볼 수 있다. 회원(member)·대리 트레이너(delegate) 계정은 조회 못 하고, 누구도 직접 쓰거나 고치거나 지울 수 없다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 다시 실행해도 안전하다.

create table if not exists reservation_status_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,                     -- 예약의 주인(관리자)
  reservation_id uuid not null,               -- 예약을 나중에 지워도 기록은 남도록 연결(FK)은 걸지 않는다
  customer_id uuid,
  reservation_date date,
  old_status text,                            -- 처음 등록이면 null
  new_status text not null,
  actor_id uuid,                              -- 처리한 계정(없으면 서버/관리 도구에서 직접 바꾼 것)
  actor_role text not null check (actor_role in ('owner', 'delegate', 'member', 'system')),
  delegation_id uuid,                         -- 대리 트레이너가 처리했으면 그 대리 지정
  actor_name text,                            -- 대리 트레이너 이름(기록 당시)
  changed_at timestamptz not null default now()
);
create index if not exists idx_reservation_status_logs_owner on reservation_status_logs(owner_id, reservation_id, changed_at);

alter table reservation_status_logs enable row level security;
drop policy if exists "reservation_status_logs_owner_select" on reservation_status_logs;
create policy "reservation_status_logs_owner_select" on reservation_status_logs for select
  using (owner_id = auth.uid() and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('member', 'delegate'));
-- 조회만 — 쓰기는 아래 트리거만 한다(앱 계정에는 insert/update/delete 권한이 없다).
revoke all on reservation_status_logs from anon, authenticated;
grant select on reservation_status_logs to authenticated;
grant select on reservation_status_logs to service_role;

create or replace function log_reservation_status() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
  v_actor_role text;
  v_delegation uuid;
  v_name text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if tg_op = 'INSERT' and new.status = 'scheduled' then return new; end if; -- 그냥 예약만 잡은 건 기록하지 않는다
  begin
    if v_uid is null then v_actor_role := 'system';
    elsif v_role = 'delegate' then
      v_actor_role := 'delegate';
      v_delegation := new.delegation_id; -- 대리 함수는 처리할 때 같은 줄에 자기 지정을 함께 적는다
      select delegate_name into v_name from lesson_delegations where id = v_delegation;
    elsif v_role = 'member' then v_actor_role := 'member';
    else v_actor_role := 'owner';
    end if;
    insert into reservation_status_logs (owner_id, reservation_id, customer_id, reservation_date, old_status, new_status,
      actor_id, actor_role, delegation_id, actor_name)
    values (new.owner_id, new.id, new.customer_id, new.date, case when tg_op = 'UPDATE' then old.status end, new.status,
      v_uid, v_actor_role, v_delegation, v_name);
  exception when others then
    raise warning 'reservation_status_logs 기록 실패(레슨 처리는 계속): %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function log_reservation_status() from public, anon, authenticated;

drop trigger if exists trg_log_reservation_status on reservations;
create trigger trg_log_reservation_status after insert or update of status on reservations
  for each row execute function log_reservation_status();

notify pgrst, 'reload schema';
