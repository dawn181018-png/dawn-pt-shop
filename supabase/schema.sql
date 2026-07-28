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
  created_at timestamptz not null default now()
);

-- ---------- catalog_items (이용권 템플릿) ----------
create table if not exists catalog_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  name text not null,
  sessions int not null default 10,
  months int not null default 1,
  price numeric not null default 0,
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
create table if not exists renewal_forecasts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  customer_id uuid not null references customers(id) on delete cascade,
  target_month text not null, -- 'YYYY-MM'
  expected_sessions int,
  expected_amount numeric not null default 0,
  note text,
  status text not null default 'pending' check (status in ('pending', 'done', 'missed')),
  actual_amount numeric,
  actual_product_id uuid references products(id) on delete set null,
  created_at timestamptz not null default now()
);

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
