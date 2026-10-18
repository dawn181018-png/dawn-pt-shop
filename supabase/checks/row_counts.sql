-- 테이블별 행 개수 (읽기 전용). 점검 전/후로 같은 쿼리를 돌려 개수가 줄어든 표가 없는지 비교한다.
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run.
select 'customers' as table_name, count(*) as rows from customers
union all select 'catalog_items', count(*) from catalog_items
union all select 'products', count(*) from products
union all select 'reservations', count(*) from reservations
union all select 'payroll_settings', count(*) from payroll_settings
union all select 'renewal_forecasts', count(*) from renewal_forecasts
union all select 'contract_signatures', count(*) from contract_signatures
union all select 'pass_transfers', count(*) from pass_transfers
union all select 'pending_sales', count(*) from pending_sales
union all select 'lesson_delegations', count(*) from lesson_delegations
union all select 'reservation_series', count(*) from reservation_series
union all select 'payment_edit_logs', count(*) from payment_edit_logs
union all select 'product_delete_logs', count(*) from product_delete_logs
union all select 'reservations: 취소', count(*) from reservations where status = 'cancelled'
union all select 'reservations: 완료+노쇼', count(*) from reservations where status in ('done','noshow')
union all select 'products: 사용 횟수 합계', coalesce(sum(used_sessions),0) from products
union all select 'storage: signatures 파일', count(*) from storage.objects where bucket_id = 'signatures'
order by 1;
