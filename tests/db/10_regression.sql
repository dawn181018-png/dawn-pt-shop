-- 자동 점검: 핵심 기능 회귀 시험(시험용 빈 DB 전용 — 운영 DB에는 절대 실행하지 않는다).
-- 빈 DB에 00_mock_supabase.sql → supabase/schema.sql(전체 구조)을 설치한 뒤 이 파일을 실행한다(tests/db/run.sh).
-- 모든 확인은 실패하면 바로 오류로 멈추고(psql ON_ERROR_STOP), 통과하면 "PASS ..."를 남긴다.
-- 새 기능을 만들 때마다 그 기능의 시험을 여기에 더한다(docs/CHECKLIST.md 참고).
\set ON_ERROR_STOP 1
\set QUIET 1
\pset format unaligned
\pset tuples_only on

-- ---------- 시험 도우미 ----------
create or replace function public.t_login(uid text, approle text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid, false),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', json_build_object('role', approle))::text, false);
$$;
create or replace function public.t_ok(cond boolean, label text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  return 'PASS ' || label;
end $$;
create or replace function public.t_err(sql text, needle text, label text) returns text language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(needle in sqlerrm) > 0 then return 'PASS ' || label; end if;
    raise exception 'FAIL: % (다른 오류: %)', label, sqlerrm;
  end;
  raise exception 'FAIL: % (막혀야 하는데 통과됨)', label;
end $$;
grant execute on function public.t_login(text, text), public.t_ok(boolean, text), public.t_err(text, text, text) to authenticated, anon;

-- ---------- 시험 데이터(가짜) ----------
-- A = 관리자, B = 다른 관리자, M = 회원(c1에 연결), D = 대리 트레이너 장재혁, E = 대리 트레이너 박코치
insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-00000000000a','a@test'),('00000000-0000-0000-0000-00000000000b','b@test'),
 ('00000000-0000-0000-0000-0000000000aa','m@test'),('00000000-0000-0000-0000-0000000000dd','d@test'),
 ('00000000-0000-0000-0000-0000000000ee','e@test');
insert into customers(id, owner_id, name, auth_user_id) values
 ('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','회원1','00000000-0000-0000-0000-0000000000aa'),
 ('c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','회원2',null),
 ('c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000a','가족',null);
insert into products(id, owner_id, customer_id, name, type, total_sessions, used_sessions, price, paid_amount, created_at) values
 ('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','PT 10회','session',10,0,1000000,1000000,'2026-01-01 00:00+09'),
 ('a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000002','PT 10회(먼저)','session',10,9,1000000,1000000,'2026-02-01 00:00+09'),
 ('a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000002','PT 10회(나중·중복)','session',10,0,1000000,1000000,'2026-02-02 00:00+09'),
 ('a0000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003','PT 10회(가족)','session',10,4,2000000,1000000,'2026-03-01 00:00+09');
insert into lesson_delegations(id, owner_id, delegate_name, delegate_email, customer_ids, starts_on, ends_on, delegate_user_id) values
 ('d0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','장재혁','jang@test.com',
   array['c0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003']::uuid[],'2020-01-01',null,'00000000-0000-0000-0000-0000000000dd'),
 ('d0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','박코치','park@test.com',
   array['c0000000-0000-0000-0000-000000000003']::uuid[],'2020-01-01',null,'00000000-0000-0000-0000-0000000000ee');

\echo '== 1. 관리자 완료·노쇼·되돌리기 차감'
select t_login('00000000-0000-0000-0000-00000000000a', '');
insert into reservations(id, owner_id, customer_id, product_id, date, time, duration, status, type) values
 ('b0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001', current_date + 1,'10:00',50,'scheduled','pt');
set role authenticated;
select (set_reservation_status('b0000000-0000-0000-0000-000000000001','done','a0000000-0000-0000-0000-000000000001','{}'::jsonb)) is not null;
reset role;
select t_ok((select used_sessions from products where id = 'a0000000-0000-0000-0000-000000000001') = 1, '완료 → 1회 차감');
set role authenticated;
select (set_reservation_status('b0000000-0000-0000-0000-000000000001','scheduled','a0000000-0000-0000-0000-000000000001','{}'::jsonb)) is not null;
reset role;
select t_ok((select used_sessions from products where id = 'a0000000-0000-0000-0000-000000000001') = 0, '완료 되돌리기 → 1회 복구');
set role authenticated;
select (set_reservation_status('b0000000-0000-0000-0000-000000000001','noshow','a0000000-0000-0000-0000-000000000001','{}'::jsonb)) is not null;
reset role;
select t_ok((select used_sessions from products where id = 'a0000000-0000-0000-0000-000000000001') = 1, '노쇼 → 1회 차감');
select t_ok((select actor_role from reservation_status_logs where reservation_id = 'b0000000-0000-0000-0000-000000000001' order by changed_at desc limit 1) = 'owner', '처리자 기록: 관리자');

\echo '== 2. 먼저 등록한 이용권부터 차감(대리 완료)'
select t_login('00000000-0000-0000-0000-00000000000a', '');
insert into reservations(id, owner_id, customer_id, product_id, date, time, duration, status, type) values
 ('b0000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003', current_date + 1,'10:00',50,'scheduled','pt'),
 ('b0000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003', current_date + 2,'10:00',50,'scheduled','pt');
set role authenticated;
select t_login('00000000-0000-0000-0000-0000000000dd', 'delegate');
select (proxy_set_reservation_status('b0000000-0000-0000-0000-000000000021','done','x/delegated/1.png',null)) is not null;
select (proxy_set_reservation_status('b0000000-0000-0000-0000-000000000022','done','x/delegated/2.png',null)) is not null;
reset role;
select t_ok((select used_sessions from products where id = 'a0000000-0000-0000-0000-000000000002') = 10, '나중 이용권에 묶인 레슨도 먼저 이용권에서 차감(9→10)');
select t_ok((select used_sessions from products where id = 'a0000000-0000-0000-0000-000000000003') = 1, '먼저 이용권을 다 쓰면 다음 이용권(0→1)');
select t_ok((select actor_role from reservation_status_logs where reservation_id = 'b0000000-0000-0000-0000-000000000021' order by changed_at desc limit 1) = 'delegate', '처리자 기록: 대리');

\echo '== 3. 반복 예약이 남은 횟수를 다 잡은 고객: 마지막 회차 취소하고 등록'
select t_login('00000000-0000-0000-0000-00000000000a', '');
insert into reservation_series(id, owner_id, customer_id, weekdays, time, duration, skip_holidays)
 values ('e0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003', array[0,1,2,3,4,5,6], '10:00', 50, false);
insert into reservations(owner_id, customer_id, product_id, series_id, date, time, duration, status, type, trainer_email)
 select '00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000001', current_date + g, '10:00', 50, 'scheduled', 'pt', 'owner'
 from generate_series(3, 8) g;
select t_ok(customer_unbooked_sessions('00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003') = 0, '준비: 더 잡을 수 있는 예약 0회');
set role authenticated;
select t_login('00000000-0000-0000-0000-0000000000dd', 'delegate');
select t_err($$select proxy_add_reservations('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004', array[current_date + 1], '15:00', 50)$$, '남은 횟수보다 많이', '대리: 남은 횟수 초과 예약은 막힘');
reset role;
select id as last_id from reservations where series_id = 'e0000000-0000-0000-0000-000000000001' and status = 'scheduled' order by date desc limit 1 \gset
set role authenticated;
select t_login('00000000-0000-0000-0000-0000000000dd', 'delegate');
select t_ok((proxy_add_lesson_replacing_last('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004', current_date + 1, '15:00', 50, :'last_id')) ? 'createdId',
  '대리: 대표 담당 반복의 마지막 회차 취소하고 등록(2026-11-11 오류 재발 방지)');
reset role;
select t_ok((select status from reservations where id = :'last_id') = 'cancelled', '마지막 회차는 취소됨');
select t_ok((select count(*) from reservations where customer_id = 'c0000000-0000-0000-0000-000000000003' and status = 'scheduled') = 6, '예약 수는 남은 횟수(6) 그대로');
select t_ok((select trainer_email from reservations where customer_id = 'c0000000-0000-0000-0000-000000000003' and date = current_date + 1) = 'jang@test.com', '대리가 만든 레슨은 대리 본인 담당');
select id as last2 from reservations where series_id = 'e0000000-0000-0000-0000-000000000001' and status = 'scheduled' order by date desc limit 1 \gset
set role authenticated;
select t_login('00000000-0000-0000-0000-00000000000a', '');
select t_ok((add_lesson_replacing_last('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004', current_date + 1, '18:00', 50, '', :'last2')) ? 'created', '관리자: 마지막 회차 취소하고 등록');
reset role;

\echo '== 4. 담당자와 대리 트레이너 권한'
select id as own_lesson from reservations where series_id = 'e0000000-0000-0000-0000-000000000001' and status = 'scheduled' order by date limit 1 \gset
select id as park_lesson from reservations where series_id = 'e0000000-0000-0000-0000-000000000001' and status = 'scheduled' order by date limit 1 offset 1 \gset
select t_login('00000000-0000-0000-0000-00000000000a', '');
update reservations set trainer_email = 'park@test.com' where id = :'park_lesson';
select t_err($$update reservations set trainer_email = 'nobody@x.com' where id = '$$ || :'own_lesson' || $$'$$, '목록에 없어요', '관리자: 없는 트레이너는 담당자로 못 정함');
set role authenticated;
select t_login('00000000-0000-0000-0000-0000000000dd', 'delegate');
select t_err($$select proxy_set_reservation_status('$$ || :'park_lesson' || $$','done',null,null)$$, 'not_your_lesson', '대리: 다른 강사 담당 레슨 완료 막힘');
select t_err($$select proxy_move_reservation('$$ || :'park_lesson' || $$', current_date + 20, '09:00', 50)$$, 'not_your_lesson', '대리: 다른 강사 담당 레슨 이동 막힘');
select (proxy_set_reservation_status(:'own_lesson','done','x/delegated/3.png',null)) is not null;
reset role;
select t_ok((select trainer_email from reservations where id = :'own_lesson') = 'jang@test.com', '대리: 대표 담당 레슨 완료 가능 → 담당자가 대리로 기록');
select t_ok((select used_sessions from products where id = 'a0000000-0000-0000-0000-000000000004') = 5, '대리 완료도 1회 차감(4→5)');

\echo '== 5. 미수금 결제(잔금)'
set role authenticated;
select t_login('00000000-0000-0000-0000-00000000000a', '');
select t_err($$select collect_unpaid_payment('a0000000-0000-0000-0000-000000000004', 1000001, current_date, 'card', gen_random_uuid())$$, '남은 미수금', '남은 미수금보다 많이 못 받음');
select t_err($$select collect_unpaid_payment('a0000000-0000-0000-0000-000000000004', 0, current_date, 'card', gen_random_uuid())$$, '0원보다', '0원 못 받음');
select (collect_unpaid_payment('a0000000-0000-0000-0000-000000000004', 400000, current_date, 'card', 'f0000000-0000-0000-0000-000000000001'))->>'id' as col1 \gset
select t_ok((collect_unpaid_payment('a0000000-0000-0000-0000-000000000004', 400000, current_date, 'card', 'f0000000-0000-0000-0000-000000000001'))->>'id' = :'col1', '같은 요청 두 번 → 기록 1건');
select t_ok((select count(*) from payment_collections) = 1, '잔금 기록 1건');
select t_err($$update products set paid_amount = 2000000 where id = 'a0000000-0000-0000-0000-000000000004'$$, '미수금 결제', '처음 결제 + 잔금이 판매가를 넘게 못 고침');
select (cancel_payment_collection(:'col1', '시험 취소')) is not null;
select t_ok((select cancelled_at is not null from payment_collections where id = :'col1'), '결제 취소: 기록은 남고 취소 표시');
reset role;

\echo '== 6. 판매 건 삭제(보관)'
set role authenticated;
select t_login('00000000-0000-0000-0000-00000000000a', '');
select t_err($$select delete_product('a0000000-0000-0000-0000-000000000004', '환불')$$, '사용된', '사용된 판매 건은 삭제 막힘');
reset role;

\echo '== 7. 계정별 접근 권한'
set role authenticated;
select t_login('00000000-0000-0000-0000-0000000000aa', 'member');
select t_ok((select count(*) from reservations) = 0, '회원: 예약 표 직접 조회 0건');
select t_ok((select count(*) from payment_collections) = 0, '회원: 잔금 기록 0건');
select t_ok((select count(*) from reservation_status_logs) = 0, '회원: 처리자 기록 0건');
select t_ok((select count(*) from delegate_settlements) = 0, '회원: 정산 기록 0건');
select t_login('00000000-0000-0000-0000-0000000000dd', 'delegate');
select t_ok((select count(*) from reservations) = 0, '대리: 예약 표 직접 조회 0건');
select t_ok((select count(*) from payment_collections) = 0, '대리: 잔금 기록 0건');
select t_ok((select count(*) from products) = 0, '대리: 판매 건 직접 조회 0건');
select t_err($$select collect_unpaid_payment('a0000000-0000-0000-0000-000000000004', 1000, current_date, 'card', gen_random_uuid())$$, 'not_allowed', '대리: 잔금 받기 막힘');
select t_login('00000000-0000-0000-0000-00000000000b', '');
select t_ok((select count(*) from reservations) = 0, '다른 관리자: 남의 예약 0건');
select t_login('00000000-0000-0000-0000-00000000000a', '');
select t_err($$delete from reservation_status_logs$$, 'permission denied', '관리자도 처리자 기록 삭제 불가');
select t_err($$update delegate_settlements set total_amount = 1$$, 'permission denied', '관리자도 정산 기록 수정 불가');
reset role;
set role anon;
select t_err($$select * from payment_collections$$, 'permission denied', '비로그인: 잔금 기록 조회 막힘');
reset role;

\echo '== 모든 DB 시험 통과'
