-- 월별 판매·결제·미수금 합계 (읽기 전용). 매출에 손대는 작업 전/후로 같은 쿼리를 돌려 숫자가 1원도 바뀌지
-- 않았는지 비교한다. Supabase 대시보드 > SQL Editor에 붙여넣고 Run. 데이터를 바꾸는 문장은 없다.

-- 1) 판매 건(이용권) 기준 — 판매일(= 처음 결제일) 달에 묶는다. 2025년까지는 연도별, 그 뒤는 월별.
--    "결제금액"은 판매할 때 처음 받은 금액이다(나중에 받은 미수금 결제는 2)에 따로 나온다).
--    "미수금(처음 기준)"은 판매가 − 처음 결제금액이라, 미수금 결제를 받아도 이 표의 숫자는 그대로다.
select
  case when created_at at time zone 'Asia/Seoul' < '2026-01-01'
       then to_char(created_at at time zone 'Asia/Seoul', 'YYYY') || '년 전체'
       else to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM') end as 기간,
  count(*)                              as 판매건수,
  sum(price)                            as 판매금액,
  sum(paid_amount)                      as 결제금액,
  sum(greatest(price - paid_amount, 0)) as 미수금,
  sum(used_sessions)                    as 사용횟수합계
from products
where archived_at is null
group by 1
order by 1;

-- 2) 미수금 결제(잔금) 기준 — 결제일 달에 묶는다. payment_collections 표를 만든 뒤에만 돌릴 수 있다.
--    삭제(보관)된 판매 건의 잔금과 취소된 잔금은 매출에서 빠지므로 여기서도 뺀다.
-- select to_char(c.paid_date, 'YYYY-MM') as 결제월, count(*) as 잔금건수, sum(c.amount) as 잔금합계
-- from payment_collections c join products p on p.id = c.product_id
-- where c.cancelled_at is null and p.archived_at is null
-- group by 1 order by 1;
