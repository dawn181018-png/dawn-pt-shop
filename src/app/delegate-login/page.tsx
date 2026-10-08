import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { confirmDelegateLogin } from "./actions";
import "@/components/ptm.css";

export const metadata: Metadata = { title: "던휘트니스 · 대리 레슨 로그인", robots: { index: false, follow: false } };

// 대리 트레이너가 받은 1회용 로그인 링크가 여는 화면. 링크를 여는 것만으로는 로그인하지 않고(=토큰을 쓰지 않고),
// 사람이 "로그인" 버튼을 눌러야 서버에서 토큰을 확인한다 — 메신저 미리보기가 토큰을 먼저 써버리는 문제 방지.
export default async function DelegateLoginPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; error?: string }> }) {
  const { token_hash: tokenHash, error } = await searchParams;
  // 관리자(트레이너) 계정으로 로그인된 기기에서 이 링크로 로그인하면 그 기기의 관리자 로그인이 대리 계정으로
  // 바뀌어 관리자 화면이 텅 빈 것처럼 보인다. 그래서 그 경우엔 먼저 분명하게 경고한다.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isTrainerSession = !!user && !user.app_metadata?.role;
  return (
    <div className="ptm-root ptm-sign-root">
      <div className="ptm-sign-card" style={{ textAlign: "center" }}>
        <div className="ptm-eyebrow">던휘트니스 삼성점</div>
        <div className="ptm-sign-title">대리 레슨 로그인</div>
        {error || !tokenHash ? (
          <div className="ptm-sign-muted">로그인 링크가 만료됐거나 이미 사용됐어요. 담당 트레이너에게 새 링크를 요청해주세요.</div>
        ) : (
          <form action={confirmDelegateLogin}>
            <input type="hidden" name="token_hash" value={tokenHash} />
            {isTrainerSession ? (
              <>
                <div className="ptm-unpaid-note" style={{ textAlign: "left", lineHeight: 1.6 }}>
                  지금 이 기기는 <b>관리자(사장님) 계정</b>으로 로그인돼 있어요. 여기서 로그인하면 이 기기의 관리자 로그인이
                  대리 트레이너 계정으로 바뀌어 관리자 화면을 쓸 수 없게 돼요. 이 링크는 <b>대리 트레이너의 휴대폰</b>에서 열어주세요.
                </div>
                <Link className="ptm-save-btn" href="/" style={{ display: "block", textDecoration: "none", marginBottom: 8 }}>관리자 화면으로 돌아가기</Link>
                <button className="ptm-res-btn" type="submit" style={{ width: "100%" }}>그래도 대리 트레이너로 로그인</button>
              </>
            ) : (
              <>
                <div className="ptm-sign-muted" style={{ marginBottom: 12 }}>아래 버튼을 누르면 대리 레슨 화면으로 들어가요.</div>
                <button className="ptm-save-btn" type="submit">로그인</button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
