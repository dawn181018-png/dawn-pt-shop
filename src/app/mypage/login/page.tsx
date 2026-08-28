"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestMypageLink, verifyMypageCode } from "./actions";

export default function MypageLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRequestCode = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set("email", email);
      const result = await requestMypageLink(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep("code");
    } catch {
      setError("네트워크 오류가 발생했어요. 다시 시도해주세요");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set("email", email);
      fd.set("code", code);
      const result = await verifyMypageCode(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/mypage");
    } catch {
      setError("네트워크 오류가 발생했어요. 다시 시도해주세요");
    } finally {
      setLoading(false);
    }
  };

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
      <div
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
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 20px" }}>회원 마이페이지</h1>

        {step === "email" ? (
          <form onSubmit={handleRequestCode}>
            <label style={{ display: "block", fontSize: 12.5, color: "#6b7684", marginBottom: 5 }}>등록하신 이메일</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%", background: "#f3f5fa", border: "1px solid #dde3ee", color: "#1f2937",
                borderRadius: 8, padding: "9px 10px", fontSize: 14, marginBottom: 12,
              }}
            />
            {error && <p style={{ color: "#e0433f", fontSize: 12.5, marginBottom: 12 }}>{error}</p>}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%", background: "#3b6fe0", color: "#fff", border: "none",
                borderRadius: 9, padding: 12, fontWeight: 700, fontSize: 15,
                cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "전송 중..." : "인증 코드 받기"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode}>
            <p style={{ fontSize: 13, color: "#6b7684", lineHeight: 1.6, marginBottom: 14 }}>
              <b>{email}</b>로 인증 코드를 보냈어요. 받은편지함(스팸함도 확인)에서 코드를 확인해 아래에 입력해주세요.
            </p>
            <label style={{ display: "block", fontSize: 12.5, color: "#6b7684", marginBottom: 5 }}>인증 코드</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="숫자 코드 입력"
              style={{
                width: "100%", background: "#f3f5fa", border: "1px solid #dde3ee", color: "#1f2937",
                borderRadius: 8, padding: "9px 10px", fontSize: 20, letterSpacing: "0.3em", textAlign: "center",
                marginBottom: 12,
              }}
            />
            {error && <p style={{ color: "#e0433f", fontSize: 12.5, marginBottom: 12 }}>{error}</p>}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%", background: "#3b6fe0", color: "#fff", border: "none",
                borderRadius: 9, padding: 12, fontWeight: 700, fontSize: 15,
                cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "확인 중..." : "로그인"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("email"); setCode(""); setError(""); }}
              style={{
                width: "100%", background: "transparent", border: "none", color: "#6b7684",
                fontSize: 12.5, marginTop: 12, cursor: "pointer", textAlign: "center",
              }}
            >
              이메일 다시 입력하기
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
