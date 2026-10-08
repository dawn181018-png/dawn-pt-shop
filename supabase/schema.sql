-- PT 회원관리 시스템 DB 스키마
-- Supabase 대시보드 > SQL Editor 에서 전체를 붙여넣고 Run 하세요.

create extension if not exists "pgcrypto";

-- ---------- customers ----------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  phone text,
  birthdate date,
  email text,
  memo text,
  is_dormant boolean not null default false,
  created_at timestamptz not null default now()
);

-- 이미 customers 테이블이 있는 기존 DB에서는 위 create table이 스킵되므로 컬럼을 추가한다. (idempotent)
alter table customers add column if not exists is_dormant boolean not null default false;

-- ---------- catalog_items (이용권 템플릿) ----------
create table if not exists catalog_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  sessions int not null default 10,
  months int not null default 1,
  price numeric not null default 0,
  session_duration int not null default 50,
  created_at timestamptz not null default now()
);

-- ---------- products (고객이 실제 구매한 이용권) ----------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null,
  type text not null check (type in ('session', 'period')),
  total_sessions int not null default 0,
  used_sessions int not null default 0,
  start_date date not null default current_date,
  end_date date,
  session_duration int not null default 50,
  list_price numeric not null default 0,
  price numeric not null default 0,
  paid_amount numeric not null default 0,
  payment_method text not null default 'card' check (payment_method in ('card', 'cash', 'transfer')),
  created_at timestamptz not null default now()
);

-- ---------- reservations (예약/출결) ----------
create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  customer_id uuid not null references customers(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  series_id uuid,
  date date not null,
  time text not null,
  duration int not null default 50,
  memo text,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'noshow', 'cancelled')),
  created_at timestamptz not null default now()
);

-- ---------- payroll_settings (트레이너별 급여 설정, 1인 1행) ----------
create table if not exists payroll_settings (
  owner_id uuid primary key references auth.users(id) default auth.uid(),
  base_salary numeric not null default 300000,
  commission_rate numeric not null default 10,
  deduction_rate numeric not null default 3.3
);

-- ---------- renewal_forecasts (재등록/신규 예정 - 예상 매출 파이프라인) ----------
-- customer_id가 없으면(null) 아직 고객으로 등록되지 않은 신규 예정 고객이며, prospect_name에 이름을 직접 적어둔다.
create table if not exists renewal_forecasts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  customer_id uuid references customers(id) on delete cascade,
  prospect_name text,
  target_month text not null, -- 'YYYY-MM'
  expected_sessions int,
  expected_amount numeric not null default 0,
  note text,
  status text not null default 'pending' check (status in ('pending', 'done', 'missed')),
  actual_amount numeric,
  actual_product_id uuid references products(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 이미 renewal_forecasts 테이블이 있는 기존 DB에서는 위 create table이 스킵되므로,
-- customer_id를 nullable로 바꾸고 prospect_name 컬럼을 추가한다. 재실행해도 안전하다(idempotent).
alter table renewal_forecasts alter column customer_id drop not null;
alter table renewal_forecasts add column if not exists prospect_name text;

-- 이미 reservations 테이블이 있는 기존 DB에서는 위 create table이 스킵되므로, 고객/상품과 연결되지 않는
-- "기타 일정"(개인 미팅, 외부 일정 등)을 지원하기 위해 type 컬럼을 추가하고 customer_id를 nullable로 바꾼다.
-- 재실행해도 안전하다(idempotent).
alter table reservations add column if not exists type text not null default 'pt' check (type in ('pt', 'misc'));
alter table reservations alter column customer_id drop not null;

-- ---------- 인덱스 ----------
create index if not exists idx_customers_owner on customers(owner_id);
create index if not exists idx_catalog_items_owner on catalog_items(owner_id);
create index if not exists idx_products_owner on products(owner_id);
create index if not exists idx_products_customer on products(customer_id);
create index if not exists idx_reservations_owner on reservations(owner_id);
create index if not exists idx_reservations_customer on reservations(customer_id);
create index if not exists idx_reservations_product on reservations(product_id);
create index if not exists idx_reservations_date on reservations(date);
create index if not exists idx_renewal_forecasts_owner on renewal_forecasts(owner_id);
create index if not exists idx_renewal_forecasts_customer on renewal_forecasts(customer_id);
create index if not exists idx_renewal_forecasts_month on renewal_forecasts(target_month);

-- ---------- RLS 활성화 ----------
alter table customers enable row level security;
alter table catalog_items enable row level security;
alter table products enable row level security;
alter table reservations enable row level security;
alter table payroll_settings enable row level security;
alter table renewal_forecasts enable row level security;

-- ---------- RLS 정책: 본인(owner_id) 데이터만 CRUD 가능 ----------
create policy "customers_owner_all" on customers
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "catalog_items_owner_all" on catalog_items
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "products_owner_all" on products
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "reservations_owner_all" on reservations
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "payroll_settings_owner_all" on payroll_settings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "renewal_forecasts_owner_all" on renewal_forecasts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------- 테이블 권한(GRANT) ----------
-- SQL Editor로 직접 만든 테이블은 대시보드 UI로 만들 때와 달리 anon/authenticated 역할에
-- 기본 권한이 자동으로 부여되지 않는다. RLS는 GRANT가 있어야 평가되므로 반드시 필요하다.
-- 이 앱은 로그인한 사용자만 사용하므로 authenticated 역할에만 부여한다.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.catalog_items to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.reservations to authenticated;
grant select, insert, update, delete on public.payroll_settings to authenticated;
grant select, insert, update, delete on public.renewal_forecasts to authenticated;

-- ---------- 세션 사용횟수 원자적 증감 ----------
-- 클라이언트에서 "현재값 읽기 -> +1/-1 계산 -> 저장" 방식은, 같은 상품의 예약 여러 건을
-- 짧은 시간 안에 연달아 완료 처리하면 경쟁 상태(race condition)로 차감이 누락될 수 있다.
-- DB에서 한 번의 UPDATE로 원자적으로 증감시켜 이 문제를 없앤다.
create or replace function adjust_used_sessions(p_product_id uuid, p_delta int)
returns setof products
language sql
as $$
  update products
  set used_sessions = greatest(0, least(total_sessions, used_sessions + p_delta))
  where id = p_product_id
  returning *;
$$;

grant execute on function adjust_used_sessions(uuid, int) to authenticated;

-- ---------- 출석 서명 (signature) ----------
-- 예약을 "출석(완료)" 처리할 때 받는 터치 서명 이미지를 저장할 컬럼과 Storage 버킷.
-- 기존 테이블/데이터는 전혀 건드리지 않는다: nullable 컬럼 추가(no default)만 하므로
-- 기존 행은 signature_url = NULL이 되고, 그 외에는 아무 영향이 없다. 재실행해도 안전하다(idempotent).
alter table reservations add column if not exists signature_url text;

-- 서명 이미지 버킷 (private). URL이 아니라 스토리지 경로를 signature_url에 저장하고,
-- 조회 시점마다 signed URL을 새로 발급한다.
insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', false)
on conflict (id) do nothing;

-- 트레이너(owner)별 폴더(첫 경로 세그먼트 = auth.uid())에만 접근 가능하도록 제한.
-- drop policy if exists + create policy 조합은 "이 정책들"에 대해서만 이미 존재하면 재생성하는
-- 것으로, signatures 버킷 전용 정책만 다루며 다른 테이블/버킷의 기존 정책은 건드리지 않는다.
drop policy if exists "signatures_owner_select" on storage.objects;
create policy "signatures_owner_select" on storage.objects for select to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "signatures_owner_insert" on storage.objects;
create policy "signatures_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "signatures_owner_update" on storage.objects;
create policy "signatures_owner_update" on storage.objects for update to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "signatures_owner_delete" on storage.objects;
create policy "signatures_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 운동일지 (workout note) ----------
-- 출석(완료) 서명 직전에 남기는 "오늘 운동 내용" 메모. 기존 테이블/데이터는 전혀 건드리지 않는다:
-- nullable 컬럼 추가(no default)만 하므로 기존 행은 workout_note = NULL이 되고, 그 외에는 아무 영향이 없다.
-- 재실행해도 안전하다(idempotent).
alter table reservations add column if not exists workout_note text;

-- ---------- customers.gender (상품판매 화면의 신규 고객 등록 폼용) ----------
-- nullable 컬럼 추가만 하므로 기존 행은 gender = NULL이 되고 그 외에는 아무 영향이 없다. 재실행해도 안전하다(idempotent).
alter table customers add column if not exists gender text check (gender in ('male', 'female'));

-- ---------- 상품판매 계약서 서명 (contract_signatures) ----------
-- "상품판매" 화면에서 PT 상품을 신규/재등록 판매하며 함께 받는 계약서 서명 1건당 1행.
-- 새 테이블만 추가하며 기존 테이블(customers/products/reservations)은 전혀 건드리지 않는다.
create table if not exists contract_signatures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  customer_id uuid not null references customers(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  is_new_customer boolean not null default false,
  signature_url text not null,
  contract_version text not null default 'v1',
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_signatures_owner on contract_signatures(owner_id);
create index if not exists idx_contract_signatures_customer on contract_signatures(customer_id);
create index if not exists idx_contract_signatures_product on contract_signatures(product_id);

alter table contract_signatures enable row level security;

create policy "contract_signatures_owner_all" on contract_signatures
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.contract_signatures to authenticated;

-- ---------- catalog_items 카테고리 (이용권 관리 화면 카테고리 탭용) ----------
-- 기존 테이블/데이터는 전혀 건드리지 않는다: not null default 컬럼 추가라 기존 행도 즉시
-- 'daily_pt' / 'month'로 백필되고, 그 외에는 아무 영향이 없다. 재실행해도 안전하다(idempotent).
alter table catalog_items add column if not exists category text not null default 'daily_pt'
  check (category in ('daily_pt', 'premium', 'membership', 'locker'));
alter table catalog_items add column if not exists period_unit text not null default 'month'
  check (period_unit in ('month', 'day'));

-- 데이터 마이그레이션: 기존 "PT n회" 이용권은 위 컬럼 추가 시 이미 기본값 'daily_pt'로 채워지므로
-- 그대로 두고, "Premium Conditioning" 이용권만 'premium'으로 재분류한다.
update catalog_items set category = 'premium' where name ilike 'premium%' and category = 'daily_pt';

-- ---------- 회원용 마이페이지 (customers <-> auth.users 연결) ----------
-- 회원이 매직링크(OTP)로 로그인했을 때, 어떤 auth 계정이 어떤 customers 행 본인인지 연결하는 컬럼.
-- nullable 컬럼 추가(no default)만 하므로 기존 행은 auth_user_id = NULL이 되고, 그 외에는 아무 영향이
-- 없다. 재실행해도 안전하다(idempotent). 트레이너 계정은 이 컬럼과 무관하다(항상 NULL).
alter table customers add column if not exists auth_user_id uuid references auth.users(id);

-- 한 auth 계정이 여러 customers 행에 동시에 연결되는 것을 방지 (NULL은 여러 개 허용되므로 기존 행엔 영향 없음).
create unique index if not exists idx_customers_auth_user_id on customers(auth_user_id) where auth_user_id is not null;

-- 회원 본인 데이터 조회용 RLS: 기존 "owner_id = auth.uid()" 정책(트레이너용)은 그대로 두고,
-- customers.auth_user_id로 본인이 연결된 회원 계정에 한해 SELECT만 추가로 허용한다.
-- 같은 테이블에 여러 permissive 정책이 있으면 OR로 결합되므로 트레이너용 정책과 서로 간섭하지 않고,
-- insert/update/delete는 이 정책들에 없으므로 회원 계정은 읽기만 가능하다.
-- ※ 2026-09-29부터 이 3개 정책은 사용하지 않는다 — 파일 맨 아래 "회원 계정의 직접 조회 권한 제거"에서
--   다시 삭제된다(트레이너 메모 노출 차단). 마이페이지는 서버에서 필요한 컬럼만 읽는다.
drop policy if exists "customers_member_select_own" on customers;
create policy "customers_member_select_own" on customers
  for select to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists "products_member_select_own" on products;
create policy "products_member_select_own" on products
  for select to authenticated
  using (exists (
    select 1 from customers c where c.id = products.customer_id and c.auth_user_id = auth.uid()
  ));

drop policy if exists "reservations_member_select_own" on reservations;
create policy "reservations_member_select_own" on reservations
  for select to authenticated
  using (exists (
    select 1 from customers c where c.id = reservations.customer_id and c.auth_user_id = auth.uid()
  ));

-- ---------- service_role(관리자 클라이언트, createAdminClient) 테이블 권한 ----------
-- service_role은 RLS는 우회하지만, 테이블 단위 권한(GRANT)은 RLS와 별개라 이것도 명시적으로
-- 필요하다. authenticated에게 준 것과 동일한 권한을 service_role에도 부여한다. 이미 있어도
-- GRANT는 재실행해도 안전하다(에러 없이 그대로 재적용됨).
grant usage on schema public to service_role;
grant select, insert, update, delete on public.customers to service_role;
grant select, insert, update, delete on public.catalog_items to service_role;
grant select, insert, update, delete on public.products to service_role;
grant select, insert, update, delete on public.reservations to service_role;
grant select, insert, update, delete on public.payroll_settings to service_role;
grant select, insert, update, delete on public.renewal_forecasts to service_role;
grant select, insert, update, delete on public.contract_signatures to service_role;
grant execute on function adjust_used_sessions(uuid, int) to service_role;

-- ---------- 이용권 양도(pass_transfers) ----------
-- 한 이용권의 잔여 횟수를 여러 고객에게 나눠서 넘기는 기능의 이력 테이블.
-- source_product_id/recipient_product_id로 "이 이용권에서 양도된 내역"과
-- "이 이용권이 양도로 받은 것"을 둘 다 조회할 수 있어 products 테이블 자체는 건드리지 않는다.
create table if not exists pass_transfers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  source_product_id uuid not null references products(id) on delete cascade,
  source_customer_id uuid not null references customers(id) on delete cascade,
  recipient_customer_id uuid not null references customers(id) on delete cascade,
  recipient_product_id uuid not null references products(id) on delete cascade,
  sessions_transferred int not null check (sessions_transferred > 0),
  amount numeric not null default 0,
  payment_method text not null default 'card' check (payment_method in ('card', 'cash', 'transfer')),
  created_at timestamptz not null default now()
);
alter table pass_transfers enable row level security;
drop policy if exists "pass_transfers_owner_all" on pass_transfers;
create policy "pass_transfers_owner_all" on pass_transfers
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on pass_transfers to authenticated;
grant select, insert, update, delete on pass_transfers to service_role;

-- 원본 이용권의 잔여 횟수 검증, 수령인별 고객/이용권 생성, 이력 기록, 원본 차감을
-- 하나의 트랜잭션으로 처리한다(중간에 실패하면 전부 롤백). p_recipients는
-- [{customer_id, new_customer_name, new_customer_phone, sessions, amount, payment_method}, ...] 배열.
create or replace function transfer_pass(p_source_product_id uuid, p_recipients jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_product products%rowtype;
  v_remaining int;
  v_total_requested int := 0;
  v_recipient jsonb;
  v_customer_id uuid;
  v_new_product products%rowtype;
  v_results jsonb := '[]'::jsonb;
begin
  select * into v_product from products
    where id = p_source_product_id and owner_id = v_owner
    for update;
  if not found then raise exception '이용권을 찾을 수 없습니다'; end if;
  if v_product.type <> 'session' then raise exception '횟수제 이용권만 양도할 수 있습니다'; end if;

  v_remaining := v_product.total_sessions - v_product.used_sessions;
  select coalesce(sum((r->>'sessions')::int), 0) into v_total_requested
    from jsonb_array_elements(p_recipients) r;

  if v_total_requested <= 0 then raise exception '양도할 횟수를 입력해주세요'; end if;
  if v_total_requested > v_remaining then
    raise exception '배분한 횟수(%)가 잔여 횟수(%)를 초과합니다', v_total_requested, v_remaining;
  end if;

  for v_recipient in select * from jsonb_array_elements(p_recipients) loop
    if (v_recipient->>'sessions')::int <= 0 then raise exception '양도 횟수는 1 이상이어야 합니다'; end if;

    if (v_recipient->>'customer_id') is not null then
      v_customer_id := (v_recipient->>'customer_id')::uuid;
      perform 1 from customers where id = v_customer_id and owner_id = v_owner;
      if not found then raise exception '수령인 고객을 찾을 수 없습니다'; end if;
    else
      insert into customers (owner_id, name, phone)
        values (v_owner, v_recipient->>'new_customer_name', v_recipient->>'new_customer_phone')
        returning id into v_customer_id;
    end if;

    insert into products (owner_id, customer_id, name, type, total_sessions, used_sessions,
      start_date, end_date, session_duration, list_price, price, paid_amount, payment_method)
    values (v_owner, v_customer_id, v_product.name, 'session', (v_recipient->>'sessions')::int, 0,
      current_date, null, v_product.session_duration,
      coalesce((v_recipient->>'amount')::numeric, 0), coalesce((v_recipient->>'amount')::numeric, 0),
      coalesce((v_recipient->>'amount')::numeric, 0), coalesce(v_recipient->>'payment_method', 'card'))
    returning * into v_new_product;

    insert into pass_transfers (owner_id, source_product_id, source_customer_id, recipient_customer_id,
      recipient_product_id, sessions_transferred, amount, payment_method)
    values (v_owner, p_source_product_id, v_product.customer_id, v_customer_id, v_new_product.id,
      (v_recipient->>'sessions')::int, coalesce((v_recipient->>'amount')::numeric, 0), coalesce(v_recipient->>'payment_method', 'card'));

    v_results := v_results || jsonb_build_object('product', to_jsonb(v_new_product), 'customerId', v_customer_id);
  end loop;

  update products set used_sessions = used_sessions + v_total_requested where id = p_source_product_id;

  return jsonb_build_object('recipients', v_results, 'totalTransferred', v_total_requested);
end;
$$;
grant execute on function transfer_pass(uuid, jsonb) to authenticated;
grant execute on function transfer_pass(uuid, jsonb) to service_role;

-- ---------- 예약 상태 변경/삭제 + 세션 차감을 한 번에 (원자적 처리) ----------
-- (2026-09-29 운영 DB에 SQL Editor로 적용됨)
-- 예전엔 "예약 상태 저장"과 "세션 차감(adjust_used_sessions)"을 앱이 두 번 따로 요청해서, 통신이 중간에
-- 끊기면 예약만 완료되고 차감은 빠지는 반쪽 저장이 생길 수 있었다. 두 작업을 한 트랜잭션으로 묶어
-- 둘 다 되거나 둘 다 안 되게 한다. 차감 규칙은 앱과 동일하다: 완료/노쇼로 "새로" 바뀌면 +1, 완료/노쇼에서
-- 다른 상태로 바뀌면 -1, 사용횟수는 0~총횟수 범위로 제한, 횟수권(session)만 차감.
-- for update로 예약 행을 잠가, 같은 예약을 동시에 두 번 처리해도(더블탭/여러 기기) 중복 차감되지 않는다.
-- 새 함수만 추가하며 기존 테이블/데이터는 건드리지 않는다. 재실행해도 안전하다(create or replace).
-- 앱은 이 함수가 없으면(PGRST202) 예전 방식(두 번 요청)으로 자동으로 되돌아간다.
create or replace function set_reservation_status(
  p_reservation_id uuid, p_status text, p_product_id uuid, p_extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_res reservations%rowtype;
  v_delta int := 0;
  v_product products%rowtype;
  v_has_product boolean := false;
begin
  select * into v_res from reservations
    where id = p_reservation_id and owner_id = v_owner
    for update;
  if not found then raise exception '예약을 찾을 수 없습니다'; end if;

  if p_status in ('done', 'noshow') and v_res.status not in ('done', 'noshow') then v_delta := 1;
  elsif v_res.status in ('done', 'noshow') and p_status not in ('done', 'noshow') then v_delta := -1;
  end if;

  update reservations set
    status = p_status,
    product_id = p_product_id,
    signature_url = case when p_extra ? 'signature_url' then p_extra->>'signature_url' else signature_url end,
    workout_note = case when p_extra ? 'workout_note' then p_extra->>'workout_note' else workout_note end
  where id = p_reservation_id
  returning * into v_res;

  if v_delta <> 0 and p_product_id is not null then
    update products
      set used_sessions = greatest(0, least(total_sessions, used_sessions + v_delta))
      where id = p_product_id and owner_id = v_owner and type = 'session'
      returning * into v_product;
    v_has_product := found;
  end if;

  return jsonb_build_object(
    'reservation', to_jsonb(v_res),
    'product', case when v_has_product then to_jsonb(v_product) else null end
  );
end;
$$;
grant execute on function set_reservation_status(uuid, text, uuid, jsonb) to authenticated;
grant execute on function set_reservation_status(uuid, text, uuid, jsonb) to service_role;

create or replace function delete_reservation(p_reservation_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_res reservations%rowtype;
  v_product products%rowtype;
  v_has_product boolean := false;
begin
  select * into v_res from reservations
    where id = p_reservation_id and owner_id = v_owner
    for update;
  if not found then raise exception '예약을 찾을 수 없습니다'; end if;

  delete from reservations where id = p_reservation_id;

  if v_res.status in ('done', 'noshow') and v_res.product_id is not null then
    update products
      set used_sessions = greatest(0, least(total_sessions, used_sessions - 1))
      where id = v_res.product_id and owner_id = v_owner and type = 'session'
      returning * into v_product;
    v_has_product := found;
  end if;

  return jsonb_build_object('product', case when v_has_product then to_jsonb(v_product) else null end);
end;
$$;
grant execute on function delete_reservation(uuid) to authenticated;
grant execute on function delete_reservation(uuid) to service_role;

-- ---------- 회원 계정의 직접 조회 권한 제거 (트레이너 메모 노출 차단) ----------
-- (2026-09-29 운영 DB에 SQL Editor로 적용됨)
-- 위쪽 "회원용 마이페이지" 섹션에서 만든 *_member_select_own 정책은 회원이 앱을 거치지 않고 API로
-- customers.memo / reservations.memo 같은 트레이너 전용 컬럼까지 읽을 수 있게 했다. 마이페이지는 이제
-- 서버(service_role)에서 로그인한 본인 데이터의 필요한 컬럼만 골라 읽으므로 이 정책들이 필요 없다.
-- 파일 전체를 처음부터 다시 실행해도 최종 상태가 같도록, 위에서 만든 정책을 여기서 제거한다.
-- 트레이너용 *_owner_all 정책과 데이터는 건드리지 않는다.
drop policy if exists "customers_member_select_own" on customers;
drop policy if exists "products_member_select_own" on products;
drop policy if exists "reservations_member_select_own" on reservations;

-- ---------- 매출 계획 상태 관리: 실패 / 다음달로 미루기(연기) ----------
-- 예상했던 재등록이 불발되면 항목을 지우지 않고 status로 남긴다: 'missed' = 실패(기존 값 재사용),
-- 'postponed' = 다음달로 연기(새로 허용). '달성'은 앱이 실제 등록금액으로 자동 판정하므로 저장하지 않는다.
-- 기존 행은 전부 'pending'이라 제약조건을 바꿔도 영향이 없고, carried_from_id는 nullable 컬럼 추가라
-- 기존 행은 NULL로 남는다. 이용권/예약/결제 테이블은 전혀 건드리지 않는다. 재실행해도 안전하다.
-- status 체크 제약조건은 이름이 환경마다 다를 수 있어, status를 검사하는 체크 제약조건을 찾아 교체한다.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.renewal_forecasts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table renewal_forecasts drop constraint %I', c.conname);
  end loop;
end $$;
alter table renewal_forecasts add constraint renewal_forecasts_status_check
  check (status in ('pending', 'done', 'missed', 'postponed'));

-- 다음달로 미뤄서 새로 만들어진 항목이 "어느 항목에서 이월됐는지" 가리킨다(원본이 지워지면 NULL).
alter table renewal_forecasts add column if not exists carried_from_id uuid references renewal_forecasts(id) on delete set null;

-- 다음달로 미루기: 같은 고객/예상세션/예상금액/메모로 다음달 'pending' 항목을 만들고 원본은 'postponed'로
-- 바꾸는 것을 한 트랜잭션으로 처리한다(중간에 끊겨도 반쪽 저장이 없음). 다음달에 이미 그 고객의 계획이
-- 있으면 덮어쓰거나 중복 생성하지 않고 에러로 알린다.
create or replace function postpone_forecast(p_forecast_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_f renewal_forecasts%rowtype;
  v_next text;
  v_new renewal_forecasts%rowtype;
begin
  select * into v_f from renewal_forecasts
    where id = p_forecast_id and owner_id = v_owner
    for update;
  if not found then raise exception '매출 계획 항목을 찾을 수 없습니다'; end if;
  if v_f.status <> 'pending' then raise exception '대기중인 항목만 다음달로 미룰 수 있습니다'; end if;

  v_next := to_char(to_date(v_f.target_month || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
  if v_f.customer_id is not null and exists (
    select 1 from renewal_forecasts
      where owner_id = v_owner and customer_id = v_f.customer_id and target_month = v_next
  ) then
    raise exception '다음달에 이미 이 고객의 계획이 있어요. 다음달 화면에서 수정해주세요';
  end if;

  insert into renewal_forecasts (owner_id, customer_id, prospect_name, target_month, expected_sessions,
    expected_amount, note, status, carried_from_id)
  values (v_owner, v_f.customer_id, v_f.prospect_name, v_next, v_f.expected_sessions,
    v_f.expected_amount, v_f.note, 'pending', v_f.id)
  returning * into v_new;

  update renewal_forecasts set status = 'postponed' where id = v_f.id returning * into v_f;

  return jsonb_build_object('original', to_jsonb(v_f), 'created', to_jsonb(v_new));
end;
$$;
grant execute on function postpone_forecast(uuid) to authenticated;
grant execute on function postpone_forecast(uuid) to service_role;

-- ---------- 고객 링크 서명: 서명 대기 판매(pending_sales) ----------
-- 상품판매에서 "링크 복사"를 누르면 이용권을 바로 만들지 않고 여기에 "서명 대기"로 저장한 뒤, 고객이 링크
-- (/sign/<token>)에서 서명하는 순간 confirm_pending_sale이 고객/이용권/계약서 서명 기록을 한 번에 만든다.
-- 그 전까지는 products에 아무것도 없으므로 횟수/매출/통계/매출계획 어디에도 잡히지 않는다.
-- 새 테이블만 추가하며 기존 테이블/데이터는 건드리지 않는다. 재실행해도 안전하다.
create table if not exists pending_sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  customer_id uuid references customers(id) on delete cascade, -- 기존 고객 재등록이면 연결
  new_customer jsonb,            -- 신규 고객이면 {name, gender, phone, birthdate} (고객 행은 서명 시점에 생성)
  product jsonb not null,        -- 판매 입력값 스냅샷 {name, type, totalSessions, startDate, endDate, sessionDuration, listPrice, price, paidAmount, paymentMethod}
  contract_version text not null default 'v1',
  -- 링크 토큰: gen_random_uuid() 두 개(각 122비트 랜덤)를 이은 64자 16진수 — 추측 불가능
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  expires_at timestamptz not null default now() + interval '7 days',
  status text not null default 'pending' check (status in ('pending', 'signed', 'cancelled')),
  signed_at timestamptz,
  result_customer_id uuid references customers(id) on delete set null,
  result_product_id uuid references products(id) on delete set null,
  signature_url text,
  created_at timestamptz not null default now(),
  check (customer_id is not null or new_customer is not null)
);
create index if not exists idx_pending_sales_owner on pending_sales(owner_id);
create index if not exists idx_pending_sales_customer on pending_sales(customer_id);

-- 트레이너 본인 것만 조회/생성/수정 가능. anon(로그인 안 한 고객)에게는 어떤 권한도 주지 않는다 —
-- 고객 링크 화면은 서버(service_role)가 토큰을 검증한 뒤 그 한 건만 골라 읽는다.
alter table pending_sales enable row level security;
drop policy if exists "pending_sales_owner_all" on pending_sales;
create policy "pending_sales_owner_all" on pending_sales
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on pending_sales to authenticated;
grant select, insert, update, delete on pending_sales to service_role;

-- 서명 전 금액/횟수 수정 또는 만료된 링크 재발급: 새 토큰 + 새 만료일로 바꿔 옛 링크를 즉시 무효화한다.
-- (p_product를 주면 판매 입력값도 함께 교체) 대기 상태일 때만 가능하다.
create or replace function reissue_pending_sale(p_id uuid, p_product jsonb default null)
returns pending_sales
language plpgsql
security invoker
as $$
declare
  v_row pending_sales%rowtype;
begin
  update pending_sales set
    token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    expires_at = now() + interval '7 days',
    product = coalesce(p_product, product)
  where id = p_id and owner_id = auth.uid() and status = 'pending'
  returning * into v_row;
  if not found then raise exception '서명 대기 중인 건이 아니에요(이미 서명됐거나 취소됨)'; end if;
  return v_row;
end;
$$;
grant execute on function reissue_pending_sale(uuid, jsonb) to authenticated;
grant execute on function reissue_pending_sale(uuid, jsonb) to service_role;

-- 고객 서명 확정: 토큰 검증(대기 상태 + 만료 전) → (신규면) 고객 생성 → 이용권 생성 → 계약서 서명 기록 →
-- 서명완료 표시를 한 트랜잭션으로 처리한다. 하나라도 실패하면 전부 롤백되어 반쪽 저장이 없다.
-- for update로 행을 잠가, 같은 링크로 동시에 두 번 서명하거나 서명과 취소가 겹쳐도 한쪽만 인정된다.
-- 로그인 없는 고객 요청을 받는 서버(service_role)만 호출할 수 있다 — anon/authenticated 실행 권한은 회수한다.
create or replace function confirm_pending_sale(p_token text, p_signature_url text)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_ps pending_sales%rowtype;
  v_customer_id uuid;
  v_product products%rowtype;
  v_p jsonb;
begin
  select * into v_ps from pending_sales where token = p_token for update;
  if not found then raise exception 'invalid_token'; end if;
  if v_ps.status <> 'pending' then raise exception 'not_pending'; end if;
  if v_ps.expires_at < now() then raise exception 'expired'; end if;

  if v_ps.customer_id is not null then
    -- 다른 트레이너의 고객 id가 섞여 들어와도 그 고객에게 이용권이 생기지 않도록 소유자를 다시 확인한다.
    perform 1 from customers where id = v_ps.customer_id and owner_id = v_ps.owner_id;
    if not found then raise exception 'invalid_customer'; end if;
    v_customer_id := v_ps.customer_id;
  else
    insert into customers (owner_id, name, gender, phone, birthdate)
    values (
      v_ps.owner_id,
      v_ps.new_customer->>'name',
      nullif(v_ps.new_customer->>'gender', ''),
      v_ps.new_customer->>'phone',
      nullif(v_ps.new_customer->>'birthdate', '')::date
    )
    returning id into v_customer_id;
  end if;

  v_p := v_ps.product;
  insert into products (owner_id, customer_id, name, type, total_sessions, used_sessions, start_date, end_date,
    session_duration, list_price, price, paid_amount, payment_method)
  values (
    v_ps.owner_id, v_customer_id, v_p->>'name', v_p->>'type',
    coalesce((v_p->>'totalSessions')::int, 0), 0,
    coalesce(nullif(v_p->>'startDate', '')::date, current_date),
    nullif(v_p->>'endDate', '')::date,
    coalesce((v_p->>'sessionDuration')::int, 50),
    coalesce((v_p->>'listPrice')::numeric, 0),
    coalesce((v_p->>'price')::numeric, 0),
    coalesce((v_p->>'paidAmount')::numeric, 0),
    coalesce(v_p->>'paymentMethod', 'card')
  )
  returning * into v_product;

  insert into contract_signatures (owner_id, customer_id, product_id, is_new_customer, signature_url, contract_version, signed_at)
  values (v_ps.owner_id, v_customer_id, v_product.id, v_ps.customer_id is null, p_signature_url, v_ps.contract_version, now());

  update pending_sales set
    status = 'signed', signed_at = now(), signature_url = p_signature_url,
    result_customer_id = v_customer_id, result_product_id = v_product.id
  where id = v_ps.id;

  return jsonb_build_object('customerId', v_customer_id, 'productId', v_product.id, 'signedAt', now());
end;
$$;
revoke execute on function confirm_pending_sale(text, text) from public, anon, authenticated;
grant execute on function confirm_pending_sale(text, text) to service_role;

-- ---------- 대리 레슨 권한 (lesson_delegations) ----------
-- 다른 트레이너가 지정된 고객의 레슨만 대신 진행할 수 있게 하는 기능. 대리 트레이너 계정(app_metadata.role =
-- 'delegate')에게는 어떤 테이블도 직접 열지 않는다 — 기존 owner_id = auth.uid() 정책만 있으므로 직접 조회하면
-- 빈 결과다. 대신 아래 proxy_* 함수(security definer)만 쓸 수 있고, 함수마다 "이 계정에 연결된 + 해제되지 않은 +
-- 오늘(한국 날짜)이 기간 안인 + 그 고객이 지정 대상인" 지정이 있는지 매번 확인한다. 해제/기간 종료 즉시 막힌다.
-- 새 테이블/컬럼/함수만 추가하며 기존 데이터와 기존 함수는 건드리지 않는다. 재실행해도 안전하다.
create table if not exists lesson_delegations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  delegate_name text not null,
  delegate_email text not null,
  customer_ids uuid[] not null check (cardinality(customer_ids) > 0),
  starts_on date not null,
  ends_on date not null,
  revoked_at timestamptz,
  delegate_user_id uuid references auth.users(id), -- "로그인 링크 복사" 시 서버가 대리 계정과 연결
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists idx_lesson_delegations_owner on lesson_delegations(owner_id);
create index if not exists idx_lesson_delegations_delegate on lesson_delegations(delegate_user_id);

alter table lesson_delegations enable row level security;
drop policy if exists "lesson_delegations_owner_all" on lesson_delegations;
create policy "lesson_delegations_owner_all" on lesson_delegations
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on lesson_delegations to authenticated;
grant select, insert, update, delete on lesson_delegations to service_role;

-- 대리로 진행한 예약/완료 기록: 어느 지정(누가)으로 처리했는지. 기존 행은 NULL로 남는다(nullable 컬럼 추가만).
alter table reservations add column if not exists delegation_id uuid references lesson_delegations(id) on delete set null;
alter table reservations add column if not exists delegate_name text;

create or replace function kst_today() returns date
language sql stable
as $$ select (now() at time zone 'Asia/Seoul')::date $$;

-- 현재 로그인한 대리 트레이너가 "지금" 이 고객을 맡고 있는 유효한 지정 1건(없으면 모든 필드가 NULL).
create or replace function proxy_delegation_for(p_customer_id uuid) returns lesson_delegations
language sql stable security definer set search_path = public
as $$
  select * from lesson_delegations
  where delegate_user_id = auth.uid() and revoked_at is null
    and kst_today() between starts_on and ends_on
    and p_customer_id = any(customer_ids)
  order by created_at desc
  limit 1
$$;

-- 대리 화면 데이터: 지정 고객(이름, 가린 연락처), 그 고객들의 이용권 잔여(금액 없음), 예약/운동일지, 그리고
-- 빈 시간 확인용 "다른 예약"(날짜/시간/길이만 — 이름/고객 정보 없음). 유효한 지정이 없으면 고객/예약은 비어 있다.
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
  where d.delegate_user_id = v_uid and d.revoked_at is null and kst_today() between d.starts_on and d.ends_on;

  return jsonb_build_object(
    'today', kst_today(),
    'delegations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', d.delegate_name, 'startsOn', d.starts_on, 'endsOn', d.ends_on,
        'active', d.revoked_at is null and kst_today() between d.starts_on and d.ends_on,
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
      from products p where p.customer_id = any(v_customer_ids)
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

-- 예약 등록: 지정 고객 + 그 고객의 소진되지 않은 이용권 + 대리 기간 안의 날짜만 허용(관리자 화면과 같은 규칙:
-- 소진된 이용권으로는 예약 불가). 여러 날짜면 같은 반복 묶음(series_id)으로 만든다.
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

  select * into v_p from products where id = p_product_id and customer_id = p_customer_id and owner_id = v_d.owner_id;
  if not found then raise exception '이용권을 찾을 수 없어요'; end if;
  if (v_p.type = 'session' and v_p.total_sessions - v_p.used_sessions <= 0)
     or (v_p.type = 'period' and v_p.end_date is not null and v_p.end_date < kst_today()) then
    raise exception '소진된 이용권으로는 예약할 수 없어요';
  end if;

  if cardinality(p_dates) > 1 then v_series := gen_random_uuid(); end if;
  foreach v_date in array p_dates loop
    if v_date < v_d.starts_on or v_date > v_d.ends_on then raise exception '대리 기간 밖의 날짜는 예약할 수 없어요'; end if;
    insert into reservations (owner_id, customer_id, product_id, series_id, date, time, duration, memo, status, type, delegation_id, delegate_name)
    values (v_d.owner_id, p_customer_id, p_product_id, v_series, v_date, p_time, p_duration, '', 'scheduled', 'pt', v_d.id, v_d.delegate_name);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 상태 변경(완료/노쇼/취소/예약됨) + 세션 차감을 한 트랜잭션으로. 관리자 화면과 같은 규칙: 완료/노쇼로 새로 바뀌면 +1,
-- 되돌리면 -1, 사용횟수 0~총횟수 제한, 차감할 이용권이 소진됐으면 그 고객의 가장 먼저 등록한 유효 이용권으로 자동
-- 전환하고 그것도 없으면 거절. 처리한 대리 트레이너를 기록한다.
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
    if found and v_p.type = 'session' and v_p.total_sessions - v_p.used_sessions <= 0 then
      select id into v_alt from products
        where customer_id = v_r.customer_id and owner_id = v_r.owner_id and type = 'session'
          and total_sessions - used_sessions > 0
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

-- 예약 시간 변경(예약됨 상태만, 대리 기간 안의 날짜로만)
create or replace function proxy_move_reservation(p_reservation_id uuid, p_date date, p_time text, p_duration int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_r reservations%rowtype;
  v_d lesson_delegations%rowtype;
begin
  select * into v_r from reservations where id = p_reservation_id for update;
  if not found or v_r.type <> 'pt' or v_r.customer_id is null then raise exception 'not_delegated'; end if;
  v_d := proxy_delegation_for(v_r.customer_id);
  if v_d.id is null or v_d.owner_id <> v_r.owner_id then raise exception 'not_delegated'; end if;
  if v_r.status <> 'scheduled' then raise exception '예약됨 상태의 예약만 시간을 바꿀 수 있어요'; end if;
  if p_time !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception '시간 형식이 올바르지 않아요'; end if;
  if p_duration is null or p_duration < 10 or p_duration > 240 then raise exception '레슨 시간이 올바르지 않아요'; end if;
  if p_date < v_d.starts_on or p_date > v_d.ends_on then raise exception '대리 기간 밖의 날짜로는 옮길 수 없어요'; end if;
  update reservations set date = p_date, time = p_time, duration = p_duration,
    delegation_id = v_d.id, delegate_name = v_d.delegate_name
  where id = v_r.id;
end;
$$;

-- 운동일지 작성/수정(상태/차감과 무관하게 메모만)
create or replace function proxy_save_workout_note(p_reservation_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_r reservations%rowtype;
  v_d lesson_delegations%rowtype;
begin
  select * into v_r from reservations where id = p_reservation_id for update;
  if not found or v_r.type <> 'pt' or v_r.customer_id is null then raise exception 'not_delegated'; end if;
  v_d := proxy_delegation_for(v_r.customer_id);
  if v_d.id is null or v_d.owner_id <> v_r.owner_id then raise exception 'not_delegated'; end if;
  update reservations set workout_note = nullif(btrim(coalesce(p_note, '')), '') where id = v_r.id;
end;
$$;

-- 서명 이미지 업로드 전 확인용: 이 예약을 지금 대리로 처리할 수 있으면 원래 트레이너(owner)의 id를 돌려준다
-- (서버가 그 트레이너의 서명 폴더에 대신 올린다).
create or replace function proxy_reservation_owner(p_reservation_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  v_r reservations%rowtype;
  v_d lesson_delegations%rowtype;
begin
  select * into v_r from reservations where id = p_reservation_id;
  if not found or v_r.type <> 'pt' or v_r.customer_id is null then raise exception 'not_delegated'; end if;
  v_d := proxy_delegation_for(v_r.customer_id);
  if v_d.id is null or v_d.owner_id <> v_r.owner_id then raise exception 'not_delegated'; end if;
  return v_r.owner_id;
end;
$$;

-- 로그인 안 한 사용자(anon)는 대리 함수를 아예 호출할 수 없다. 로그인 계정이라도 유효한 지정이 없으면 거절/빈 결과.
revoke execute on function proxy_delegation_for(uuid) from public, anon;
revoke execute on function proxy_context() from public, anon;
revoke execute on function proxy_add_reservations(uuid, uuid, date[], text, int) from public, anon;
revoke execute on function proxy_set_reservation_status(uuid, text, text, text) from public, anon;
revoke execute on function proxy_move_reservation(uuid, date, text, int) from public, anon;
revoke execute on function proxy_save_workout_note(uuid, text) from public, anon;
revoke execute on function proxy_reservation_owner(uuid) from public, anon;
grant execute on function proxy_delegation_for(uuid) to authenticated;
grant execute on function proxy_context() to authenticated;
grant execute on function proxy_add_reservations(uuid, uuid, date[], text, int) to authenticated;
grant execute on function proxy_set_reservation_status(uuid, text, text, text) to authenticated;
grant execute on function proxy_move_reservation(uuid, date, text, int) to authenticated;
grant execute on function proxy_save_workout_note(uuid, text) to authenticated;
grant execute on function proxy_reservation_owner(uuid) to authenticated;

-- ---------- 대리 레슨: "세션 다 쓸 때까지" 기간 옵션 ----------
-- 종료일(ends_on)을 비워두면 날짜 제한 없이, 그 고객의 잔여 세션(횟수권 잔여 > 0 또는 만료 전 기간권)이 남아 있는
-- 동안만 대리 권한이 유효하다. 마지막 세션이 완료되는 순간 그 고객에 대한 대리 권한도 끝난다. 고객마다 따로 판단한다.
-- 기존 지정 건은 모두 종료일이 있어 동작이 그대로다(nullable로만 바꾸며 데이터는 건드리지 않는다).
alter table lesson_delegations alter column ends_on drop not null;

create or replace function proxy_customer_has_sessions(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from products p
    where p.customer_id = p_customer_id
      and ((p.type = 'session' and p.total_sessions - p.used_sessions > 0)
        or (p.type = 'period' and (p.end_date is null or p.end_date >= kst_today())))
  )
$$;

-- 지정 1건이 "오늘, 이 고객에 대해" 유효한지(해제 안 됨 + 시작일 지남 + 종료일 전 또는 종료일 없음이면 세션 남음)
create or replace function proxy_delegation_valid_for(d lesson_delegations, p_customer_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select d.revoked_at is null
    and kst_today() >= d.starts_on
    and p_customer_id = any(d.customer_ids)
    and (case when d.ends_on is null then proxy_customer_has_sessions(p_customer_id) else kst_today() <= d.ends_on end)
$$;

create or replace function proxy_delegation_for(p_customer_id uuid) returns lesson_delegations
language sql stable security definer set search_path = public
as $$
  select * from lesson_delegations d
  where d.delegate_user_id = auth.uid() and proxy_delegation_valid_for(d, p_customer_id)
  order by d.created_at desc
  limit 1
$$;

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
  where d.delegate_user_id = v_uid and proxy_delegation_valid_for(d, c);

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
      from products p where p.customer_id = any(v_customer_ids)
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

  select * into v_p from products where id = p_product_id and customer_id = p_customer_id and owner_id = v_d.owner_id;
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

create or replace function proxy_move_reservation(p_reservation_id uuid, p_date date, p_time text, p_duration int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_r reservations%rowtype;
  v_d lesson_delegations%rowtype;
begin
  select * into v_r from reservations where id = p_reservation_id for update;
  if not found or v_r.type <> 'pt' or v_r.customer_id is null then raise exception 'not_delegated'; end if;
  v_d := proxy_delegation_for(v_r.customer_id);
  if v_d.id is null or v_d.owner_id <> v_r.owner_id then raise exception 'not_delegated'; end if;
  if v_r.status <> 'scheduled' then raise exception '예약됨 상태의 예약만 시간을 바꿀 수 있어요'; end if;
  if p_time !~ '^[0-2][0-9]:[0-5][0-9]$' then raise exception '시간 형식이 올바르지 않아요'; end if;
  if p_duration is null or p_duration < 10 or p_duration > 240 then raise exception '레슨 시간이 올바르지 않아요'; end if;
  if p_date < v_d.starts_on or (v_d.ends_on is not null and p_date > v_d.ends_on) then
    raise exception '대리 기간 밖의 날짜로는 옮길 수 없어요';
  end if;
  update reservations set date = p_date, time = p_time, duration = p_duration,
    delegation_id = v_d.id, delegate_name = v_d.delegate_name
  where id = v_r.id;
end;
$$;

-- 아래 두 함수는 다른 proxy_* 함수 안에서만 쓰는 내부 확인용이라 누구도 직접 호출할 수 없게 한다
-- (security definer 함수 안에서는 함수 소유자 권한으로 실행되므로 그대로 동작한다).
revoke execute on function proxy_customer_has_sessions(uuid) from public, anon, authenticated;
revoke execute on function proxy_delegation_valid_for(lesson_delegations, uuid) from public, anon, authenticated;

-- 앱(PostgREST)이 새 함수를 바로 인식하도록 스키마 캐시 새로고침
notify pgrst, 'reload schema';
