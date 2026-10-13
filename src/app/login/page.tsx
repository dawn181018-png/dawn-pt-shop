import { login } from "./actions";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  // 대리 트레이너·회원 계정으로 로그인된 기기에서 이 화면에 온 경우(관리자로 돌아가려는 경우) 안내를 보여준다.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const otherRole = user?.app_metadata?.role === "delegate" ? "대리 트레이너" : user?.app_metadata?.role === "member" ? "회원" : null;

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#eef1f7",
        fontFamily: "Inter, sans-serif",
        padding: 16,
      }}
    >
      <form
        action={login}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#ffffff",
          border: "1px solid #dde3ee",
          borderRadius: 14,
          padding: 28,
        }}
      >
        <p style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#3b6fe0", margin: "0 0 4px" }}>
          던휘트니스 삼성점
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 20px" }}>회원 관리 로그인</h1>
        {otherRole && (
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "#1f2937", background: "rgba(59,111,224,0.08)", borderRadius: 8, padding: "8px 10px", margin: "-8px 0 14px" }}>
            지금 이 기기는 {otherRole} 계정으로 로그인돼 있어요. 아래에 관리자 이메일과 비밀번호로 로그인하면 관리자 계정으로 바뀌어요.
          </p>
        )}

        <label style={{ display: "block", fontSize: 12.5, color: "#6b7684", marginBottom: 5 }}>이메일</label>
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          style={{
            width: "100%", background: "#f3f5fa", border: "1px solid #dde3ee", color: "#1f2937",
            borderRadius: 8, padding: "9px 10px", fontSize: 14, marginBottom: 12,
          }}
        />

        <label style={{ display: "block", fontSize: 12.5, color: "#6b7684", marginBottom: 5 }}>비밀번호</label>
        <input
          name="password"
          type="password"
          required
          placeholder="••••••••"
          style={{
            width: "100%", background: "#f3f5fa", border: "1px solid #dde3ee",
            borderRadius: 8, padding: "9px 10px", fontSize: 14, marginBottom: 16,
          }}
        />

        {error && (
          <p style={{ color: "#e0433f", fontSize: 12.5, marginBottom: 12 }}>{error}</p>
        )}

        <button
          type="submit"
          style={{
            width: "100%", background: "#3b6fe0", color: "#fff", border: "none",
            borderRadius: 9, padding: 12, fontWeight: 700, fontSize: 15, cursor: "pointer",
          }}
        >
          로그인
        </button>

        <a href="/forgot-password" style={{ display: "block", marginTop: 14, fontSize: 12.5, color: "#6b7684", textAlign: "center" }}>
          비밀번호를 잊으셨나요?
        </a>
      </form>
    </div>
  );
}
