-- 2026-11-05 대리 레슨 월 정산 기록 — 새 표 하나만 추가하는 마이그레이션. 기존 표·데이터·함수는 건드리지 않는다.
-- 정산 화면에서 "정산 확정 / 확정 해제 / 지급 완료 / 지급 취소"를 누를 때마다 한 줄씩 쌓는다(추가만, 고치거나 지울 수 없음).
-- 확정 줄에는 그 순간의 레슨 목록·금액 입력값·조정·합계를 통째로(snapshot) 저장한다 → 나중에 예약이나 단가가 바뀌어도
-- 확정된 숫자는 그대로다. 지금 상태는 같은 달·같은 트레이너의 가장 마지막 줄로 판단한다.
-- 이 표는 기존 페이롤(급여)·회계관리·매출 계획 계산에 쓰이지 않는다(별도 정산 기록).
-- 관리자(트레이너) 계정만 보고 쓸 수 있다. 회원(member)·대리 트레이너(delegate) 계정은 조회도 입력도 못 한다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 다시 실행해도 안전하다.

create table if not exists delegate_settlements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- 'YYYY-MM' (한국 날짜 기준 그 달)
  delegate_email text not null,                                       -- 대리 트레이너 구분(지정이 여러 건이어도 이메일로 묶음)
  delegate_name text not null,
  action text not null check (action in ('confirm', 'unconfirm', 'paid', 'unpaid')),
  lesson_count int not null default 0 check (lesson_count >= 0),      -- 정산 대상 횟수(확정 줄)
  total_amount bigint not null default 0,                             -- 합계(원, 확정 줄)
  snapshot jsonb,                                                     -- 확정 줄: 레슨 목록·계산 근거·조정 전체
  paid_on date,                                                       -- 지급 완료 줄: 지급일
  memo text,                                                          -- 확정 해제 사유, 지급 메모 등
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_delegate_settlements_owner on delegate_settlements(owner_id, month, delegate_email, created_at);

alter table delegate_settlements enable row level security;
drop policy if exists "delegate_settlements_owner_select" on delegate_settlements;
create policy "delegate_settlements_owner_select" on delegate_settlements for select
  using (owner_id = auth.uid() and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('member', 'delegate'));
drop policy if exists "delegate_settlements_owner_insert" on delegate_settlements;
create policy "delegate_settlements_owner_insert" on delegate_settlements for insert
  with check (owner_id = auth.uid() and created_by = auth.uid()
              and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('member', 'delegate'));
-- 추가(insert)와 조회(select)만 — 고치기(update)·지우기(delete) 권한은 아무에게도 주지 않는다.
revoke all on delegate_settlements from anon, authenticated;
grant select, insert on delegate_settlements to authenticated;
grant select on delegate_settlements to service_role;

notify pgrst, 'reload schema';
