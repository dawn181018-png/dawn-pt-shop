-- 2026-10-12 판매내역 상품 삭제(복구 가능) — 추가만 하는 마이그레이션. 기존 데이터·표 구조는 바꾸지 않고,
-- 행을 실제로 지우는 문장도 없다. 삭제 = 기존 "보관" 표시(archived_at)를 켜고 누가/언제/왜를 함께 남기는 것.
-- archived_at이 켜진 이용권은 이미 모든 화면(잔여·회계·통계·매출 계획·마이페이지·대리 화면·반복예약)에서 빠진다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 다시 실행해도 안전하다.

-- 1) 이용권에 삭제 정보 칸 추가
alter table products add column if not exists deleted_at timestamptz;
alter table products add column if not exists deleted_by uuid;
alter table products add column if not exists delete_reason text;

-- 2) 삭제·복구 이력 (추가만 가능 — 수정/삭제 권한 없음, 관리자 본인 것만 조회)
create table if not exists product_delete_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  product_id uuid references products(id) on delete set null,
  action text not null check (action in ('delete', 'restore')),
  customer_name text not null default '',
  product_name text not null default '',
  price numeric not null default 0,
  paid_amount numeric not null default 0,
  reason text,
  acted_by uuid not null default auth.uid(),
  acted_at timestamptz not null default now()
);
create index if not exists idx_product_delete_logs_owner on product_delete_logs(owner_id, product_id);
alter table product_delete_logs enable row level security;
drop policy if exists "product_delete_logs_owner_select" on product_delete_logs;
create policy "product_delete_logs_owner_select" on product_delete_logs for select
  using (owner_id = auth.uid() and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('member', 'delegate'));
revoke all on product_delete_logs from anon, authenticated;
grant select on product_delete_logs to authenticated;
grant select, insert on product_delete_logs to service_role;

-- 3) 삭제: 관리자(트레이너) 본인 이용권만. 사용된 이용권(사용 횟수 > 0 또는 완료·노쇼 레슨 연결)과
--    양도 관련 이용권은 화면을 거치지 않아도 여기서 막는다. 예약·서명·다른 이용권은 건드리지 않는다.
create or replace function delete_product(p_product_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p products%rowtype;
  v_used int;
  v_customer text;
begin
  if v_uid is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('member', 'delegate') then raise exception 'not_allowed'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception '삭제 사유를 골라주세요'; end if;
  select * into v_p from products where id = p_product_id and owner_id = v_uid for update;
  if not found then raise exception '상품을 찾을 수 없어요'; end if;
  if v_p.archived_at is not null then raise exception '이미 삭제된 상품이에요'; end if;
  select greatest(v_p.used_sessions, count(*)::int) into v_used
    from reservations where product_id = v_p.id and status in ('done', 'noshow');
  if v_used > 0 then
    raise exception '이미 %회 사용된 상품이라 삭제할 수 없습니다. 금액이나 정보 수정이 필요하면 수정 기능을 이용해주세요', v_used;
  end if;
  if exists (select 1 from pass_transfers where source_product_id = v_p.id or recipient_product_id = v_p.id) then
    raise exception '양도와 연결된 상품은 삭제할 수 없어요';
  end if;
  select name into v_customer from customers where id = v_p.customer_id;

  update products set archived_at = now(), deleted_at = now(), deleted_by = v_uid, delete_reason = btrim(p_reason)
    where id = v_p.id returning * into v_p;
  insert into product_delete_logs (owner_id, product_id, action, customer_name, product_name, price, paid_amount, reason, acted_by)
    values (v_uid, v_p.id, 'delete', coalesce(v_customer, ''), v_p.name, v_p.price, v_p.paid_amount, btrim(p_reason), v_uid);
  return to_jsonb(v_p);
end;
$$;
revoke execute on function delete_product(uuid, text) from public, anon;
grant execute on function delete_product(uuid, text) to authenticated;

-- 4) 복구: 삭제(또는 예전 "보관")된 이용권을 다시 집계에 포함시킨다.
create or replace function restore_product(p_product_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p products%rowtype;
  v_customer text;
begin
  if v_uid is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('member', 'delegate') then raise exception 'not_allowed'; end if;
  select * into v_p from products where id = p_product_id and owner_id = v_uid for update;
  if not found then raise exception '상품을 찾을 수 없어요'; end if;
  if v_p.archived_at is null then raise exception '삭제된 상품이 아니에요'; end if;
  select name into v_customer from customers where id = v_p.customer_id;

  update products set archived_at = null, deleted_at = null, deleted_by = null, delete_reason = null
    where id = v_p.id returning * into v_p;
  insert into product_delete_logs (owner_id, product_id, action, customer_name, product_name, price, paid_amount, reason, acted_by)
    values (v_uid, v_p.id, 'restore', coalesce(v_customer, ''), v_p.name, v_p.price, v_p.paid_amount, nullif(btrim(coalesce(p_reason, '')), ''), v_uid);
  return to_jsonb(v_p);
end;
$$;
revoke execute on function restore_product(uuid, text) from public, anon;
grant execute on function restore_product(uuid, text) to authenticated;

notify pgrst, 'reload schema';
