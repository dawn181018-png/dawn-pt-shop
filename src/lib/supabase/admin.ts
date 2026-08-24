import { createClient } from "@supabase/supabase-js";

// service_role 키로 RLS를 우회하는 관리자 클라이언트.
// 절대 클라이언트(브라우저) 코드에서 import하면 안 되며, 서버 전용 코드(Route Handler 등)에서만 사용한다.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
