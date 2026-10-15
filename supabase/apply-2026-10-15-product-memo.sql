-- 2026-10-15 이용권 메모: 왜 이 횟수·금액인지 등을 적어두는 트레이너용 칸을 추가한다(추가만, 기존 데이터 변경 없음).
-- 회원 마이페이지와 대리 화면은 이 칸을 읽지 않는다(필요한 칸만 골라서 읽음). 다시 실행해도 안전하다.
alter table products add column if not exists memo text;
notify pgrst, 'reload schema';
