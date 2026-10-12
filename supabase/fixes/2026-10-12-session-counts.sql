-- 2026-10-12 데이터 맞추기 (사장님 승인: 1번 차감 누락 맞추기, 2번 이용권 없이 완료된 레슨 연결+차감).
-- 고치기 전 원래 값을 data_fix_backup_2026_10_12 표에 먼저 저장한다(새 표 추가만, 기존 표 구조 변경 없음).
-- 한 트랜잭션: 중간에 실패하면 아무것도 바뀌지 않는다.
--
-- A) 횟수권 사용 횟수 < (이 이용권으로 완료·노쇼된 예약 수 + 양도로 넘긴 횟수) 인 이용권만,
--    사용 횟수를 그 합으로 올린다(총 횟수를 넘지 않게). 사용 횟수가 더 많은 이용권(수기 조정분)은 건드리지 않는다.
-- B) 이용권 없이 완료/노쇼된 PT 예약을, 그 레슨 날짜(한국 날짜) 이전에 산 잔여 있는 횟수권 중 가장 먼저 산 것에
--    연결하고 1회 차감한다. 레슨 날짜보다 뒤에 산 이용권밖에 없으면(등록 전 체험) 그대로 둔다.
--
-- 되돌리기(필요할 때만):
--   update products p set used_sessions = b.old_used from data_fix_backup_2026_10_12 b
--     where b.kind = 'product_used' and b.row_id = p.id;
--   update products p set used_sessions = greatest(0, p.used_sessions - n.cnt)
--     from (select product_id, count(*) cnt from data_fix_backup_2026_10_12 where kind = 'reservation_link' group by product_id) n
--     where p.id = n.product_id;
--   update reservations r set product_id = null from data_fix_backup_2026_10_12 b
--     where b.kind = 'reservation_link' and b.row_id = r.id;
--   (A를 먼저 되돌리면 B 차감분도 원래 값으로 돌아가므로, B 되돌리기는 A를 되돌리지 않을 때만 쓴다.)

begin;

create table if not exists data_fix_backup_2026_10_12 (
  kind text not null,
  row_id uuid not null,
  product_id uuid,
  old_used int,
  note text,
  fixed_at timestamptz not null default now()
);
alter table data_fix_backup_2026_10_12 enable row level security;

-- A) 차감 누락 맞추기
with target as (
  select p.id, p.used_sessions as old_used,
    least(p.total_sessions,
      (select count(*) from reservations r where r.product_id = p.id and r.status in ('done','noshow'))
      + coalesce((select sum(t.sessions_transferred) from pass_transfers t where t.source_product_id = p.id), 0))::int as new_used
  from products p where p.type = 'session'
), changed as (
  select * from target where new_used > old_used
), saved as (
  insert into data_fix_backup_2026_10_12 (kind, row_id, product_id, old_used, note)
  select 'product_used', id, id, old_used, '사용 ' || old_used || ' → ' || new_used from changed
  returning row_id
)
update products p set used_sessions = c.new_used from changed c where p.id = c.id;

-- B) 이용권 없이 완료된 레슨 연결 + 차감
with lonely as (
  select r.id as res_id,
    (select p.id from products p
      where p.customer_id = r.customer_id and p.owner_id = r.owner_id and p.type = 'session' and p.archived_at is null
        and (p.created_at at time zone 'Asia/Seoul')::date <= r.date
        and p.total_sessions - p.used_sessions > 0
      order by p.created_at asc limit 1) as product_id
  from reservations r
  where r.type = 'pt' and r.status in ('done','noshow') and r.product_id is null
), picked as (
  select * from lonely where product_id is not null
), saved as (
  insert into data_fix_backup_2026_10_12 (kind, row_id, product_id, note)
  select 'reservation_link', res_id, product_id, '이용권 연결 + 1회 차감' from picked
  returning row_id
), linked as (
  update reservations r set product_id = k.product_id from picked k where r.id = k.res_id
  returning k.product_id
)
update products p set used_sessions = least(p.total_sessions, p.used_sessions + n.cnt)
from (select product_id, count(*) cnt from linked group by product_id) n
where p.id = n.product_id;

commit;

-- 결과 보기
select case b.kind when 'product_used' then '1. 차감 맞춤' else '2. 레슨 연결' end as 작업,
       c.name as 고객, p.name as 이용권, b.note as 내용,
       p.total_sessions - p.used_sessions as 지금잔여
from data_fix_backup_2026_10_12 b
join products p on p.id = b.product_id
join customers c on c.id = p.customer_id
order by 1, 2;
