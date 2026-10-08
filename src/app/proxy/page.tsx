import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ProxyLessonView from "@/components/ProxyLessonView";

export const metadata: Metadata = { title: "던휘트니스 · 대리 레슨", robots: { index: false, follow: false } };

// 대리 레슨 전용 화면. 앱 입구(미들웨어)에서도 막지만, 여기서도 대리 계정이 아니면 들여보내지 않는다.
// 실제 데이터 접근 제한은 DB의 proxy_* 함수가 한다(지정 고객 + 유효 기간).
export default async function ProxyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.role !== "delegate") redirect(user.app_metadata?.role === "member" ? "/mypage" : "/");
  return <ProxyLessonView />;
}
