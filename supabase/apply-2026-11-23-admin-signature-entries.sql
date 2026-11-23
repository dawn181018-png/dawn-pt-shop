-- 2026-11-23 서명 시트 "관리자 서명 입력" — 새 표 하나 + 서버 처리 함수 2개를 추가한다.
-- 기존 표의 칸·데이터, 이미 저장된 서명 그림과 기록은 바꾸지 않는다. 세션 차감·잔여·매출·완료 상태도 건드리지 않는다
-- (예약의 "서명 위치" 칸만 채우거나 다시 비운다).
-- 무엇을 하나:
--   - 완료 처리됐지만 서명이 비어 있는 회차에, 관리자(대표)만 서명 그림을 넣을 수 있다(붙여넣기 / 파일).
--   - 넣은 서명은 "관리자 입력"으로 기록(누가·언제·어떤 방식)해서 고객이 직접 한 서명과 구분한다.
--   - 잘못 넣었으면 "관리자 입력" 서명만 지울 수 있고, 지운 사실도 기록으로 남는다. 고객이 직접 한 서명은 못 지운다.
--   - 이미 서명된 회차는 덮어쓰지 못하고, NO SHOW·예정·취소 회차에는 넣지 못한다.
-- 기록은 추가만 된다 — 누구도(관리자 포함) 직접 쓰거나 고치거나 지울 수 없고, 아래 두 함수만 한 줄씩 추가한다.
-- 대리 트레이너·회원 계정은 조회도, 함수 실행도 막힌다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 다시 실행해도 안전하다.

create table if not exists signature_admin_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,                     -- 예약의 주인(관리자)
  reservation_id uuid not null,               -- 예약을 지워도 기록은 남도록 연결(FK)은 걸지 않는다
  customer_id uuid,
  action text not null check (action in ('add', 'remove')),  -- 넣음 / 지움
  signature_path text not null,               -- 넣은(지운) 서명 그림의 보관함 경로
  method text check (method in ('paste', 'file')),           -- 넣은 방식(지움은 비어 있음)
  actor_id uuid not null,                     -- 넣은(지운) 계정
  created_at timestamptz not null default now()
);
create index if not exists idx_signature_admin_entries_owner on signature_admin_entries(owner_id, reservation_id, created_at);

alter table signature_admin_entries enable row level security;
drop policy if exists "signature_admin_entries_owner_select" on signature_admin_entries;
create policy "signature_admin_entries_owner_select" on signature_admin_entries for select
  using (owner_id = auth.uid() and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('member', 'delegate'));
revoke all on signature_admin_entries from anon, authenticated;
grant select on signature_admin_entries to authenticated;
grant select on signature_admin_entries to service_role;

-- 관리자 서명 넣기: 모든 검사를 서버에서 하고, 서명 칸 채우기와 기록 추가를 한 번에 처리한다(기록 실패 시 함께 취소).
create or replace function admin_attach_signature(p_reservation_id uuid, p_path text, p_method text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
  v_r reservations%rowtype;
begin
  if v_uid is null or v_role in ('member', 'delegate') then raise exception 'not_allowed'; end if;
  if p_method is null or p_method not in ('paste', 'file') then raise exception 'bad_method'; end if;
  if p_path is null or p_path not like v_uid::text || '/admin/%' or position('..' in p_path) > 0 then raise exception 'bad_path'; end if;
  select * into v_r from reservations where id = p_reservation_id and owner_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_r.status <> 'done' then raise exception 'not_done'; end if;          -- NO SHOW·예정·취소에는 넣지 않는다
  if v_r.signature_url is not null then raise exception 'already_signed'; end if; -- 이미 서명된 회차는 덮어쓰지 않는다
  update reservations set signature_url = p_path where id = v_r.id returning * into v_r;
  insert into signature_admin_entries (owner_id, reservation_id, customer_id, action, signature_path, method, actor_id)
    values (v_r.owner_id, v_r.id, v_r.customer_id, 'add', p_path, p_method, v_uid);
  return to_jsonb(v_r);
end;
$$;
revoke execute on function admin_attach_signature(uuid, text, text) from public, anon;
grant execute on function admin_attach_signature(uuid, text, text) to authenticated;

-- 관리자 입력 서명 지우기: 지금 서명이 "관리자가 넣은 그 그림"일 때만 비운다. 고객이 직접 한 서명은 거절.
create or replace function admin_remove_signature(p_reservation_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
  v_r reservations%rowtype;
  v_last signature_admin_entries%rowtype;
begin
  if v_uid is null or v_role in ('member', 'delegate') then raise exception 'not_allowed'; end if;
  select * into v_r from reservations where id = p_reservation_id and owner_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  select * into v_last from signature_admin_entries
    where reservation_id = v_r.id and owner_id = v_uid order by created_at desc, id desc limit 1;
  if v_r.signature_url is null or v_last.id is null or v_last.action <> 'add' or v_last.signature_path is distinct from v_r.signature_url then
    raise exception 'not_admin_signature';
  end if;
  update reservations set signature_url = null where id = v_r.id returning * into v_r;
  insert into signature_admin_entries (owner_id, reservation_id, customer_id, action, signature_path, method, actor_id)
    values (v_r.owner_id, v_r.id, v_r.customer_id, 'remove', v_last.signature_path, null, v_uid);
  return to_jsonb(v_r);
end;
$$;
revoke execute on function admin_remove_signature(uuid) from public, anon;
grant execute on function admin_remove_signature(uuid) to authenticated;

notify pgrst, 'reload schema';
