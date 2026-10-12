-- 2026-10-12 데이터 맞추기 전 자세히 보기 (읽기 전용 — 아무것도 고치지 않는다).
-- A: 차감 누락 의심 고객의 "모든" 횟수권 — 다른 이용권에 대신 차감됐는지(옮겨 붙은 건지) 확인용
-- B: 이용권 없이 완료/노쇼된 PT — 첫 이용권 구매일보다 앞이면 등록 전 체험 레슨
-- C: 링크 서명 완료인데 이용권 연결이 비어 있는 건 — 지금 그 고객의 이용권 목록
with flagged as (
  select distinct p.customer_id from products p
  where p.type = 'session'
    and (select count(*) from reservations r where r.product_id = p.id and r.status in ('done','noshow'))
        + coalesce((select sum(t.sessions_transferred) from pass_transfers t where t.source_product_id = p.id), 0)
        > p.used_sessions
)
select 'A 차감 누락 의심' as 구분, c.name as 고객,
       p.name || case when p.archived_at is not null then ' (보관)' else '' end as 내용,
       p.created_at::date::text as 날짜,
       p.total_sessions as 총횟수, p.used_sessions as 사용,
       (select count(*) from reservations r where r.product_id = p.id and r.status = 'done')::int as 완료,
       (select count(*) from reservations r where r.product_id = p.id and r.status = 'noshow')::int as 노쇼,
       coalesce((select sum(t.sessions_transferred) from pass_transfers t where t.source_product_id = p.id), 0)::int as 양도
from products p join customers c on c.id = p.customer_id
where p.type = 'session' and p.customer_id in (select customer_id from flagged)

union all
select 'B 이용권 없이 완료', c.name,
       r.date::text || ' ' || r.time || ' ' || r.status,
       coalesce((select min(p.created_at)::date::text from products p where p.customer_id = r.customer_id), '이용권 없음'),
       null, null, null, null, null
from reservations r left join customers c on c.id = r.customer_id
where r.type = 'pt' and r.status in ('done','noshow') and r.product_id is null

union all
select 'C 링크 서명 이용권 없음', coalesce(c.name, ps.new_customer->>'name'),
       '서명일 ' || ps.signed_at::date::text || ' / 현재 이용권: ' ||
       coalesce((select string_agg(p.name || '(' || p.created_at::date::text || ')', ', ')
                 from products p where p.customer_id = coalesce(ps.result_customer_id, ps.customer_id)), '없음'),
       case when coalesce(ps.result_customer_id, ps.customer_id) is null then '고객 연결 없음' else '고객 있음' end,
       null, null, null, null, null
from pending_sales ps left join customers c on c.id = coalesce(ps.result_customer_id, ps.customer_id)
where ps.status = 'signed' and ps.result_product_id is null

order by 1, 2, 4;
