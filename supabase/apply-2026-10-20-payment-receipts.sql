-- 2026-10-20 결제 영수증(카드 영수증 사진 등) 첨부 — 새 표 추가만 하는 마이그레이션(기존 데이터 변경 없음). 다시 실행해도 안전하다.
-- 사진 파일은 서명과 같은 저장소(signatures 버킷)의 "트레이너 uid/receipts/" 폴더에 저장한다(기존 폴더 권한 그대로 —
-- 본인 폴더만 올리고 볼 수 있다). 이 표에는 어느 판매(이용권)에 어떤 사진이 붙었는지만 기록한다.
create table if not exists payment_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  product_id uuid references products(id) on delete set null,
  path text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_payment_receipts_owner on payment_receipts(owner_id, product_id);
alter table payment_receipts enable row level security;
drop policy if exists "payment_receipts_owner_all" on payment_receipts;
create policy "payment_receipts_owner_all" on payment_receipts for all
  using (owner_id = auth.uid() and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('member', 'delegate'))
  with check (owner_id = auth.uid() and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('member', 'delegate'));
revoke all on payment_receipts from anon;
grant select, insert, delete on payment_receipts to authenticated;
grant select, insert, delete on payment_receipts to service_role;
notify pgrst, 'reload schema';
