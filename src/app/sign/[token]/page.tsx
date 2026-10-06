import type { Metadata } from "next";
import { loadSignView } from "@/lib/supabase/pendingSaleServer";
import SignView from "./SignView";

// 고객이 로그인 없이 여는 링크 서명 화면. 검색엔진 수집 대상에서 제외한다.
export const metadata: Metadata = {
  title: "DAWN FITNESS 계약서 서명",
  robots: { index: false, follow: false },
};

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await loadSignView(token);
  return <SignView token={token} initialView={view} />;
}
