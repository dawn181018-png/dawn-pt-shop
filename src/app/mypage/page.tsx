import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toCamel, withEpochCreatedAt } from "@/lib/caseConvert";
import { getCustomerWorkoutLogs } from "@/lib/workoutLog";
import type { Customer, Product, Reservation } from "@/lib/types";
import MyPageView from "./MyPageView";

export default async function MyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/mypage/login");

  // 회원 계정에는 테이블을 직접 읽는 권한을 주지 않는다 — 권한을 주면 회원이 앱을 거치지 않고 API로
  // 트레이너 메모(customers.memo, reservations.memo) 같은 컬럼까지 읽을 수 있기 때문이다. 대신 서버에서
  // 로그인한 본인(getUser로 검증된 user.id)에 연결된 고객 1명의 데이터만, 화면에 필요한 컬럼만 골라 읽는다.
  const admin = createAdminClient();
  const { data: custRow } = await admin.from("customers").select("id, name").eq("auth_user_id", user.id).maybeSingle();

  if (!custRow) {
    // 매직링크 발송 이후 연결이 안 된 예외 상황(예: 링크 발송 뒤 회원 정보가 삭제된 경우) - 안내 후 로그아웃.
    await supabase.auth.signOut();
    redirect(`/mypage/login?error=${encodeURIComponent("등록된 회원 정보가 없습니다")}`);
  }

  const customer = toCamel<Customer>(custRow);

  const [{ data: productRows }, { data: reservationRows }] = await Promise.all([
    admin
      .from("products")
      .select("id, customer_id, name, type, total_sessions, used_sessions, start_date, end_date, session_duration, created_at")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: true }),
    admin
      .from("reservations")
      .select("id, customer_id, product_id, series_id, date, time, duration, status, type, workout_note")
      .eq("customer_id", customer.id)
      .order("date", { ascending: true })
      .order("time", { ascending: true }),
  ]);

  const products = (productRows ?? []).map((row) => withEpochCreatedAt(toCamel<Product>(row)));
  const reservations = (reservationRows ?? []).map((row) => toCamel<Reservation>(row));
  const workoutLogs = getCustomerWorkoutLogs(reservations, customer.id);

  return (
    <MyPageView
      customerName={customer.name}
      products={products}
      reservations={reservations}
      workoutLogs={workoutLogs}
    />
  );
}
