-- 이미 어긋난 데이터가 있는지 찾는 점검 쿼리 (읽기 전용 — 아무것도 고치지 않는다).
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 결과의 "문제" 열이 무엇이 이상한지 알려준다.
-- 결과가 0행이면 그 항목은 문제가 없다는 뜻. 마지막 "비교값" 열: 1번은 잔여, 2번은 (완료·노쇼 수 + 양도 횟수).

-- 1) 횟수권 사용 횟수가 0 미만이거나 총 횟수보다 많음 (잔여가 음수)
select '1. 잔여 음수/사용 횟수 이상' as 문제, c.name as 고객, p.name as 이용권,
       p.total_sessions as 총횟수, p.used_sessions as 사용, p.total_sessions - p.used_sessions as 비교값
from products p join customers c on c.id = p.customer_id
where p.type = 'session' and (p.used_sessions < 0 or p.used_sessions > p.total_sessions)

union all
-- 2) 차감 누락 의심: 이 이용권으로 완료/노쇼된 예약 수 + 양도로 넘긴 횟수가 사용 횟수보다 많음
--    (사용 횟수가 더 많은 건 수기/수동조정분이라 정상일 수 있어 제외)
select '2. 차감 누락 의심(완료·노쇼+양도 > 사용)', c.name, p.name, p.total_sessions, p.used_sessions,
       (select count(*) from reservations r where r.product_id = p.id and r.status in ('done','noshow'))::int
         + coalesce((select sum(t.sessions_transferred) from pass_transfers t where t.source_product_id = p.id), 0)::int
from products p join customers c on c.id = p.customer_id
where p.type = 'session'
  and (select count(*) from reservations r where r.product_id = p.id and r.status in ('done','noshow'))
      + coalesce((select sum(t.sessions_transferred) from pass_transfers t where t.source_product_id = p.id), 0)
      > p.used_sessions

union all
-- 3) 결제(입금) 금액이 판매가보다 많거나 음수
select '3. 결제금액 이상(판매가 초과/음수)', c.name, p.name, p.price::int, p.paid_amount::int, null
from products p join customers c on c.id = p.customer_id
where p.paid_amount > p.price or p.paid_amount < 0 or p.price < 0

union all
-- 4) 이용권 연결 없이 완료/노쇼 처리된 PT 예약 (차감이 안 된 레슨)
select '4. 이용권 없이 완료·노쇼된 PT 예약', coalesce(c.name, '(고객 없음)'), r.date::text || ' ' || r.time, null, null, null
from reservations r left join customers c on c.id = r.customer_id
where r.type = 'pt' and r.status in ('done','noshow') and r.product_id is null

union all
-- 5) 이미 소진된 횟수권에 아직 묶여 있는 "예약됨" 예약 (앱을 열면 자동 재연결되지만 남아 있으면 확인 필요)
select '5. 소진된 이용권에 묶인 예약됨', c.name, p.name || ' / ' || r.date::text || ' ' || r.time, p.total_sessions, p.used_sessions, null
from reservations r join products p on p.id = r.product_id join customers c on c.id = r.customer_id
where r.status = 'scheduled' and p.type = 'session' and p.total_sessions - p.used_sessions <= 0

union all
-- 6) 고객 없이 남아 있는 PT 예약
select '6. 고객 없는 PT 예약', '(없음)', r.date::text || ' ' || r.time, null, null, null
from reservations r
where r.type = 'pt' and r.customer_id is null

union all
-- 7) 서명 완료로 표시됐는데 만들어진 이용권 연결이 없는 링크 서명 건
select '7. 링크 서명 완료인데 이용권 없음', coalesce(c.name, ps.new_customer->>'name'), ps.product->>'name', null, null, null
from pending_sales ps left join customers c on c.id = ps.customer_id
where ps.status = 'signed' and ps.result_product_id is null

union all
-- 8) 판매가 0원인 이용권 (무료/양도 0원 등 — 의도한 것이면 정상, 매출에 0으로 잡힘)
select '8. 판매가 0원 이용권(확인용)', c.name, p.name, p.total_sessions, p.used_sessions, null
from products p join customers c on c.id = p.customer_id
where p.price = 0

order by 1, 2;
