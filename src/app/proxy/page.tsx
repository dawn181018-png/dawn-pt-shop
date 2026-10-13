import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PTMemberManager from "@/components/PTMemberManager";
import { logoutProxy } from "./actions";

export const metadata: Metadata = { title: "던휘트니스 · 대리 레슨", robots: { index: false, follow: false } };

const topButtonStyle = {
  background: "#ffffff", border: "1px solid #dde3ee", borderRadius: 8,
  padding: "6px 12px", fontSize: 12.5, color: "#6b7684", cursor: "pointer",
};

// 대리 레슨 화면: 관리자와 같은 스케줄 화면(PTMemberManager)을 "대리 모드"로 쓴다 — 메뉴는 스케줄만이고,
// 데이터와 동작은 전부 DB의 proxy_* 함수(지정 고객 + 유효 기간)를 거친다. 앱 입구(미들웨어)에서도 막지만,
// 여기서도 대리 계정이 아니면 들여보내지 않는다.
export default async function ProxyPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.role !== "delegate") redirect(user.app_metadata?.role === "member" ? "/mypage" : "/");
  return (
    <>
      <form action={logoutProxy} style={{ position: "fixed", top: 12, right: 12, zIndex: 100 }}>
        <button type="submit" style={topButtonStyle}>로그아웃</button>
      </form>
      {from === "admin" && (
        // 관리자 주소(즐겨찾기)로 들어왔는데 이 기기가 대리 계정으로 로그인돼 있는 경우 — 사장님이 테스트 링크를 열어본 기기 등.
        <div style={{ maxWidth: 1240, margin: "64px auto 0", padding: "0 16px" }}>
          <form action={logoutProxy} className="ptm-unpaid-note" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", lineHeight: 1.5 }}>
            <span>지금 이 기기는 <b>대리 트레이너 계정</b>으로 로그인돼 있어서 관리자 주소로 들어와도 대리 화면이 보여요.</span>
            <button type="submit" className="ptm-res-btn">로그아웃하고 관리자로 로그인</button>
          </form>
        </div>
      )}
      <PTMemberManager mode="delegate" />
    </>
  );
}
