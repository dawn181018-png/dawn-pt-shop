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

-- 앱(PostgREST)이 새 함수를 바로 인식하도록 스키마 캐시 새로고침
notify pgrst, 'reload schema';
