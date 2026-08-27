"use client";

import { useState, type FormEvent } from "react";
import { sendResetLink } from "./actions";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const fd = new FormData();
    fd.set("email", email);
    await sendResetLink(fd);
    setLoading(false);
    setSent(true);
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
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 20px" }}>비밀번호 재설정</h1>

        {sent ? (
          <p style={{ fontSize: 13.5, color: "#6b7684", lineHeight: 1.6 }}>
            입력하신 이메일로 재설정 링크를 보냈어요. 받은편지함(스팸함도 확인)에서 링크를 눌러 새 비밀번호를 설정해주세요.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontSize: 12.5, color: "#6b7684", marginBottom: 5 }}>이메일</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%", background: "#f3f5fa", border: "1px solid #dde3ee", color: "#1f2937",
                borderRadius: 8, padding: "9px 10px", fontSize: 14, marginBottom: 16,
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%", background: "#3b6fe0", color: "#fff", border: "none",
                borderRadius: 9, padding: 12, fontWeight: 700, fontSize: 15,
                cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "전송 중..." : "재설정 링크 보내기"}
            </button>
          </form>
        )}

        <a href="/login" style={{ display: "block", marginTop: 16, fontSize: 12.5, color: "#3b6fe0", textAlign: "center" }}>
          로그인으로 돌아가기
        </a>
      </div>
    </div>
  );
}
