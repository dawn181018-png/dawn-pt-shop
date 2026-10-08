import type { Metadata } from "next";
import { confirmDelegateLogin } from "./actions";
import "@/components/ptm.css";

export const metadata: Metadata = { title: "던휘트니스 · 대리 레슨 로그인", robots: { index: false, follow: false } };

// 대리 트레이너가 받은 1회용 로그인 링크가 여는 화면. 링크를 여는 것만으로는 로그인하지 않고(=토큰을 쓰지 않고),
// 사람이 "로그인" 버튼을 눌러야 서버에서 토큰을 확인한다 — 메신저 미리보기가 토큰을 먼저 써버리는 문제 방지.
export default async function DelegateLoginPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; error?: string }> }) {
  const { token_hash: tokenHash, error } = await searchParams;
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
            <div className="ptm-sign-muted" style={{ marginBottom: 12 }}>아래 버튼을 누르면 대리 레슨 화면으로 들어가요.</div>
            <button className="ptm-save-btn" type="submit">로그인</button>
          </form>
        )}
      </div>
    </div>
  );
}
