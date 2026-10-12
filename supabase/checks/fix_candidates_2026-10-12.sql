-- 2026-10-12 데이터 맞추기 전 자세히 보기 (읽기 전용 — 아무것도 고치지 않는다).
-- A: 차감 누락 의심 이용권만 — "구매전기록"은 이 이용권 등록일보다 앞선 날짜의 완료/노쇼 수
--    (앞선 기록은 예전 이용권에서 이미 차감됐거나 등록 전 체험일 수 있어 그대로 더하면 두 번 차감될 수 있다)
-- B: 이용권 없이 완료/노쇼된 PT — 첫 이용권 등록일보다 앞이면 등록 전 체험 레슨
-- C: 링크 서명 완료인데 이용권 연결이 비어 있는 건 — 지금 그 고객의 이용권 목록
select 'A 차감 누락 의심' as 구분, c.name as 고객, p.name as 내용,
       p.created_at::date::text as 날짜,
       p.total_sessions as 총횟수, p.used_sessions as 사용,
       count(r.id) filter (where r.status = 'done')::int as 완료,
       count(r.id) filter (where r.status = 'noshow')::int as 노쇼,
       count(r.id) filter (where r.date < p.created_at::date)::int as 구매전기록,
       min(r.date)::text || ' ~ ' || max(r.date)::text as 기록기간
from products p join customers c on c.id = p.customer_id
join reservations r on r.product_id = p.id and r.status in ('done','noshow')
where p.type = 'session'
group by c.name, p.id, p.name, p.created_at, p.total_sessions, p.used_sessions
having count(r.id) + coalesce((select sum(t.sessions_transferred) from pass_transfers t where t.source_product_id = p.id), 0) > p.used_sessions

union all
select 'B 이용권 없이 완료', c.name,
       r.date::text || ' ' || r.time || ' ' || r.status,
       '첫 이용권 ' || coalesce((select min(p.created_at)::date::text from products p where p.customer_id = r.customer_id), '없음'),
       null, null, null, null, null, null
from reservations r left join customers c on c.id = r.customer_id
where r.type = 'pt' and r.status in ('done','noshow') and r.product_id is null

union all
select 'C 링크 서명 이용권 없음', coalesce(c.name, ps.new_customer->>'name'),
       '현재 이용권: ' ||
       coalesce((select string_agg(p.name || '(' || p.created_at::date::text || ')', ', ')
                 from products p where p.customer_id = coalesce(ps.result_customer_id, ps.customer_id)), '없음'),
       '서명일 ' || ps.signed_at::date::text,
       null, null, null, null, null,
       case when coalesce(ps.result_customer_id, ps.customer_id) is null then '고객 연결 없음' else '고객 있음' end
from pending_sales ps left join customers c on c.id = coalesce(ps.result_customer_id, ps.customer_id)
where ps.status = 'signed' and ps.result_product_id is null

order by 1, 2;
