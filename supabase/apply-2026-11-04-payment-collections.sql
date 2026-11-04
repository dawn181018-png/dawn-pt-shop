-- 2026-11-04 미수금 결제(잔금) 기록 — 추가만 하는 마이그레이션. 기존 표의 데이터는 한 줄도 바꾸거나 지우지 않는다.
-- 지금까지는 판매 건(products)에 결제금액이 숫자 하나로만 있어서, 나중에 받은 잔금도 "판매한 달" 매출에 더해졌다.
-- 이제 잔금은 이 표에 한 번 받을 때마다 한 줄씩(받은 날짜·금액·결제수단) 쌓고, 매출은 받은 날짜에 잡는다.
--   - products.paid_amount는 "판매할 때 처음 받은 금액"으로 그대로 둔다(옮기거나 고치지 않음) → 지난 달 숫자 불변.
--   - 남은 미수금 = 판매가 − 처음 결제금액 − (취소되지 않은 잔금 합계). 따로 저장하지 않고 계산한다.
--   - 잘못 받은 잔금은 지우지 않고 "결제 취소"(취소 시각·사유 기록)로 매출에서만 뺀다.
-- 관리자(트레이너) 계정만 쓸 수 있다. 회원(member)·대리 트레이너(delegate) 계정은 조회도 입력도 못 한다.
-- 쓰기는 아래 함수로만 가능하다(표에 직접 insert/update/delete 권한을 주지 않는다).
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 다시 실행해도 안전하다.

-- 1) 잔금 기록 표
create table if not exists payment_collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  -- 판매 건은 앱에서 완전히 지울 수 없지만(보관만), 혹시라도 지우려 하면 돈 기록이 딸려 사라지지 않게 막는다.
  product_id uuid not null references products(id) on delete restrict,
  amount numeric not null check (amount > 0),
  paid_date date not null,                      -- 매출로 잡히는 날짜(한국 날짜)
  payment_method text not null check (payment_method in ('card', 'cash', 'transfer')),
  request_id uuid not null,                     -- 같은 요청이 두 번 와도(연속 클릭·재전송) 한 번만 기록하기 위한 값
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,                     -- 값이 있으면 취소된 잔금(매출·미수금 계산에서 뺀다)
  cancelled_by uuid,
  cancel_reason text
);
create unique index if not exists uq_payment_collections_request on payment_collections(owner_id, request_id);
create index if not exists idx_payment_collections_owner on payment_collections(owner_id, product_id);
alter table payment_collections enable row level security;
drop policy if exists "payment_collections_owner_select" on payment_collections;
create policy "payment_collections_owner_select" on payment_collections for select
  using (owner_id = auth.uid() and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('member', 'delegate'));
revoke all on payment_collections from anon, authenticated;
grant select on payment_collections to authenticated;
grant select on payment_collections to service_role;

-- 2) 결제 수정 이력에 "어느 잔금을 고쳤는지" 칸 추가(비어 있으면 예전처럼 판매 건 자체의 수정)
alter table payment_edit_logs add column if not exists collection_id uuid references payment_collections(id) on delete set null;

-- 공용: 이 판매 건에서 취소되지 않은 잔금 합계(자기 자신 p_except는 빼고)
create or replace function product_collected_amount(p_product_id uuid, p_except uuid default null) returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(amount), 0) from payment_collections
  where product_id = p_product_id and cancelled_at is null and (p_except is null or id <> p_except);
$$;
revoke execute on function product_collected_amount(uuid, uuid) from public, anon, authenticated;

-- 3) 잔금 받기: 판매 건을 잠근 상태에서 남은 미수금을 다시 계산해 검사하고 한 줄 기록한다(한 트랜잭션).
--    같은 request_id가 이미 있으면 새로 만들지 않고 그 기록을 그대로 돌려준다(중복 기록 방지).
create or replace function collect_unpaid_payment(
  p_product_id uuid, p_amount numeric, p_paid_date date, p_payment_method text, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p products%rowtype;
  v_existing payment_collections%rowtype;
  v_remaining numeric;
  v_row payment_collections%rowtype;
begin
  if v_uid is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('member', 'delegate') then raise exception 'not_allowed'; end if;
  if p_request_id is null then raise exception '요청 값이 올바르지 않아요'; end if;
  select * into v_p from products where id = p_product_id and owner_id = v_uid for update;
  if not found then raise exception '판매 건을 찾을 수 없어요'; end if;

  -- 판매 건을 잠근 뒤에 확인하므로, 같은 요청이 동시에 두 번 와도 두 번째는 여기서 첫 번째 기록을 돌려받는다.
  select * into v_existing from payment_collections where owner_id = v_uid and request_id = p_request_id;
  if found then return to_jsonb(v_existing); end if;

  if v_p.archived_at is not null then raise exception '삭제된 판매 건이에요. 복구한 뒤에 결제를 받을 수 있어요'; end if;
  if p_amount is null or p_amount <= 0 then raise exception '결제금액은 0원보다 커야 해요'; end if;
  if p_payment_method is null or p_payment_method not in ('card', 'cash', 'transfer') then raise exception '결제수단이 올바르지 않아요'; end if;
  if p_paid_date is null then raise exception '결제일이 올바르지 않아요'; end if;
  if p_paid_date < (v_p.created_at at time zone 'Asia/Seoul')::date then raise exception '결제일은 판매일보다 앞설 수 없어요'; end if;

  v_remaining := v_p.price - v_p.paid_amount - product_collected_amount(v_p.id);
  if v_remaining <= 0 then raise exception '남은 미수금이 없어요'; end if;
  if p_amount > v_remaining then raise exception '결제금액이 남은 미수금(%원)보다 많아요', v_remaining; end if;

  insert into payment_collections (owner_id, product_id, amount, paid_date, payment_method, request_id, created_by)
  values (v_uid, v_p.id, p_amount, p_paid_date, p_payment_method, p_request_id, v_uid)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke execute on function collect_unpaid_payment(uuid, numeric, date, text, uuid) from public, anon;
grant execute on function collect_unpaid_payment(uuid, numeric, date, text, uuid) to authenticated;

-- 4) 잔금 결제 취소: 기록은 남기고 취소 표시만 한다 → 매출에서 빠지고 그만큼 미수금이 다시 생긴다.
create or replace function cancel_payment_collection(p_collection_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c payment_collections%rowtype;
begin
  if v_uid is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('member', 'delegate') then raise exception 'not_allowed'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception '취소 사유를 적어주세요'; end if;
  select * into v_c from payment_collections where id = p_collection_id and owner_id = v_uid;
  if not found then raise exception '결제 기록을 찾을 수 없어요'; end if;
  perform 1 from products where id = v_c.product_id for update; -- 같은 판매 건의 받기/수정과 순서대로 처리
  select * into v_c from payment_collections where id = p_collection_id for update;
  if v_c.cancelled_at is not null then raise exception '이미 취소된 결제예요'; end if;

  update payment_collections set cancelled_at = now(), cancelled_by = v_uid, cancel_reason = btrim(p_reason)
    where id = v_c.id returning * into v_c;
  return to_jsonb(v_c);
end;
$$;
revoke execute on function cancel_payment_collection(uuid, text) from public, anon;
grant execute on function cancel_payment_collection(uuid, text) to authenticated;

-- 5) 잔금 결제 수정(금액·결제일·결제수단): 회계관리 결제 수정과 같은 규칙으로 전/후 값을 payment_edit_logs에 남긴다.
create or replace function edit_payment_collection(
  p_collection_id uuid, p_amount numeric, p_paid_date date, p_payment_method text, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c payment_collections%rowtype;
  v_p products%rowtype;
  v_limit numeric;
  v_changes jsonb := '[]'::jsonb;
  v_signed boolean;
  v_customer text;
  v_log payment_edit_logs%rowtype;
begin
  if v_uid is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('member', 'delegate') then raise exception 'not_allowed'; end if;
  select * into v_c from payment_collections where id = p_collection_id and owner_id = v_uid;
  if not found then raise exception '결제 기록을 찾을 수 없어요'; end if;
  select * into v_p from products where id = v_c.product_id for update;
  select * into v_c from payment_collections where id = p_collection_id for update;
  if v_c.cancelled_at is not null then raise exception '취소된 결제는 고칠 수 없어요'; end if;
  if v_p.archived_at is not null then raise exception '삭제된 판매 건이에요. 복구한 뒤에 고칠 수 있어요'; end if;
  if p_amount is null or p_amount <= 0 then raise exception '결제금액은 0원보다 커야 해요'; end if;
  if p_payment_method is null or p_payment_method not in ('card', 'cash', 'transfer') then raise exception '결제수단이 올바르지 않아요'; end if;
  if p_paid_date is null then raise exception '결제일이 올바르지 않아요'; end if;
  if p_paid_date < (v_p.created_at at time zone 'Asia/Seoul')::date then raise exception '결제일은 판매일보다 앞설 수 없어요'; end if;
  v_limit := v_p.price - v_p.paid_amount - product_collected_amount(v_p.id, v_c.id);
  if p_amount > v_limit then raise exception '결제금액이 남은 미수금(%원)보다 많아요', v_limit; end if;

  if p_amount <> v_c.amount then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'paid_amount', 'from', v_c.amount, 'to', p_amount));
  end if;
  if p_paid_date <> v_c.paid_date then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'paid_date', 'from', v_c.paid_date, 'to', p_paid_date));
  end if;
  if p_payment_method <> v_c.payment_method then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'payment_method', 'from', v_c.payment_method, 'to', p_payment_method));
  end if;
  if jsonb_array_length(v_changes) = 0 then raise exception '바뀐 내용이 없어요'; end if;

  select exists (select 1 from contract_signatures where product_id = v_p.id) into v_signed;
  select name into v_customer from customers where id = v_p.customer_id;

  update payment_collections set amount = p_amount, paid_date = p_paid_date, payment_method = p_payment_method
    where id = v_c.id returning * into v_c;
  insert into payment_edit_logs (owner_id, product_id, collection_id, customer_name, product_name, changes, reason, signed_contract, edited_by)
  values (v_uid, v_p.id, v_c.id, coalesce(v_customer, ''), v_p.name, v_changes, nullif(btrim(coalesce(p_reason, '')), ''), v_signed, v_uid)
  returning * into v_log;

  return jsonb_build_object('collection', to_jsonb(v_c), 'log', to_jsonb(v_log));
end;
$$;
revoke execute on function edit_payment_collection(uuid, numeric, date, text, text) from public, anon;
grant execute on function edit_payment_collection(uuid, numeric, date, text, text) to authenticated;

-- 6) 안전장치: 잔금 기록이 있는 판매 건은 판매가·처음 결제금액·판매일을 바꿀 때 "처음 결제 + 잔금 ≤ 판매가",
--    "잔금 결제일 ≥ 판매일"이 깨지지 않게 막는다(판매 건 수정창·회계관리 결제 수정 어디서 바꾸든 같다).
--    잔금 기록이 없는 판매 건(= 지금 있는 모든 판매 건)은 예전과 똑같이 동작한다.
create or replace function guard_product_collections() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_collected numeric;
begin
  if new.price is not distinct from old.price and new.paid_amount is not distinct from old.paid_amount
     and new.created_at is not distinct from old.created_at then
    return new;
  end if;
  v_collected := product_collected_amount(new.id);
  if v_collected = 0 then return new; end if;
  if new.paid_amount + v_collected > new.price then
    raise exception '이 판매 건은 미수금 결제 %원이 이미 들어와 있어서, 처음 결제금액 + 미수금 결제가 판매가(%원)를 넘을 수 없어요', v_collected, new.price;
  end if;
  if exists (select 1 from payment_collections where product_id = new.id and cancelled_at is null
             and paid_date < (new.created_at at time zone 'Asia/Seoul')::date) then
    raise exception '미수금 결제일보다 늦은 날짜로 판매일을 옮길 수 없어요';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_product_collections on products;
create trigger trg_guard_product_collections before update on products
  for each row execute function guard_product_collections();

notify pgrst, 'reload schema';
