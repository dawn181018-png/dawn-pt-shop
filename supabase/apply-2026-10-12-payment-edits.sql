-- 2026-10-12 회계관리: 결제 건 수정 + 수정 이력 (추가만 하는 마이그레이션 — 기존 데이터·표 구조는 바꾸지 않는다)
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 다시 실행해도 안전하다.

-- 1) 수정 이력 표: 추가만 가능(수정/삭제 권한 없음). 관리자(트레이너) 본인 것만 조회 가능.
create table if not exists payment_edit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  product_id uuid references products(id) on delete set null,
  customer_name text not null default '',
  product_name text not null default '',
  changes jsonb not null,            -- [{ "field": "paid_amount" | "paid_date" | "payment_method", "from": ..., "to": ... }]
  reason text,
  signed_contract boolean not null default false,  -- 서명된 계약서가 있는 건이었는지
  edited_by uuid not null default auth.uid(),
  edited_at timestamptz not null default now()
);
create index if not exists idx_payment_edit_logs_owner on payment_edit_logs(owner_id, product_id);
alter table payment_edit_logs enable row level security;
drop policy if exists "payment_edit_logs_owner_select" on payment_edit_logs;
create policy "payment_edit_logs_owner_select" on payment_edit_logs for select
  using (owner_id = auth.uid() and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('member', 'delegate'));
revoke all on payment_edit_logs from anon, authenticated;
grant select on payment_edit_logs to authenticated;
grant select, insert on payment_edit_logs to service_role;

-- 2) 결제 건 수정: 이용권의 결제금액·결제일·결제수단만 바꾸고, 같은 트랜잭션에서 이력을 남긴다.
--    횟수·잔여·판매가·서명·계약서·고객·예약은 건드리지 않는다. 관리자(트레이너) 계정 + 본인 이용권만 가능.
create or replace function edit_product_payment(
  p_product_id uuid, p_paid_amount numeric, p_paid_date date, p_payment_method text, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p products%rowtype;
  v_old_date date;
  v_changes jsonb := '[]'::jsonb;
  v_signed boolean;
  v_customer text;
  v_log payment_edit_logs%rowtype;
begin
  if v_uid is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('member', 'delegate') then raise exception 'not_allowed'; end if;
  select * into v_p from products where id = p_product_id and owner_id = v_uid for update;
  if not found then raise exception '결제 건을 찾을 수 없어요'; end if;
  if p_paid_amount is null or p_paid_amount < 0 then raise exception '결제금액이 올바르지 않아요'; end if;
  if p_paid_amount > v_p.price and p_paid_amount <> v_p.paid_amount then
    raise exception '결제금액은 판매가(%원)보다 클 수 없어요', v_p.price;
  end if;
  if p_payment_method is null or p_payment_method not in ('card', 'cash', 'transfer') then raise exception '결제수단이 올바르지 않아요'; end if;
  if p_paid_date is null then raise exception '결제일이 올바르지 않아요'; end if;

  v_old_date := (v_p.created_at at time zone 'Asia/Seoul')::date;
  if p_paid_amount <> v_p.paid_amount then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'paid_amount', 'from', v_p.paid_amount, 'to', p_paid_amount));
  end if;
  if p_paid_date <> v_old_date then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'paid_date', 'from', v_old_date, 'to', p_paid_date));
  end if;
  if p_payment_method <> v_p.payment_method then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'payment_method', 'from', v_p.payment_method, 'to', p_payment_method));
  end if;
  if jsonb_array_length(v_changes) = 0 then raise exception '바뀐 내용이 없어요'; end if;

  select exists (select 1 from contract_signatures where product_id = v_p.id) into v_signed;
  select name into v_customer from customers where id = v_p.customer_id;

  update products set
    paid_amount = p_paid_amount,
    payment_method = p_payment_method,
    created_at = case when p_paid_date <> v_old_date then (p_paid_date::timestamp at time zone 'Asia/Seoul') else created_at end
  where id = v_p.id
  returning * into v_p;

  insert into payment_edit_logs (owner_id, product_id, customer_name, product_name, changes, reason, signed_contract, edited_by)
  values (v_uid, v_p.id, coalesce(v_customer, ''), v_p.name, v_changes, nullif(btrim(coalesce(p_reason, '')), ''), v_signed, v_uid)
  returning * into v_log;

  return jsonb_build_object('product', to_jsonb(v_p), 'log', to_jsonb(v_log));
end;
$$;
revoke execute on function edit_product_payment(uuid, numeric, date, text, text) from public, anon;
grant execute on function edit_product_payment(uuid, numeric, date, text, text) to authenticated;

notify pgrst, 'reload schema';
