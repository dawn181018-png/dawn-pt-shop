import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  // RLS(customers_member_select_own)가 auth_user_id = auth.uid()인 본인 행만 돌려주므로
  // 다른 회원의 고객 레코드는 여기서 절대 조회되지 않는다.
  const { data: custRow } = await supabase.from("customers").select("*").eq("auth_user_id", user.id).maybeSingle();

  if (!custRow) {
    // 매직링크 발송 이후 연결이 안 된 예외 상황(예: 링크 발송 뒤 회원 정보가 삭제된 경우) - 안내 후 로그아웃.
    await supabase.auth.signOut();
    redirect(`/mypage/login?error=${encodeURIComponent("등록된 회원 정보가 없습니다")}`);
  }

  const customer = toCamel<Customer>(custRow);

  const [{ data: productRows }, { data: reservationRows }] = await Promise.all([
    supabase.from("products").select("*").eq("customer_id", customer.id).order("created_at", { ascending: true }),
    supabase.from("reservations").select("*").eq("customer_id", customer.id).order("date", { ascending: true }).order("time", { ascending: true }),
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
