-- 2026-10-13 이용권 완전 삭제 막기: 앱 계정(로그인 사용자)은 이용권 행을 DB에서 지울 수 없게 한다.
-- 앱은 이미 완전 삭제를 쓰지 않는다 — 판매내역의 "삭제(복구 가능)"는 delete_product 함수로 표시만 바꾼다.
-- 데이터는 바꾸지 않는 권한 변경이다. 다시 실행해도 안전하다.
revoke delete on public.products from anon, authenticated;
