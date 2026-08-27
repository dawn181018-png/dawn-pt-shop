"use client";

import { useState, type FormEvent } from "react";
import { requestMypageLink } from "./actions";

export default function MypageLoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
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
      setSent(true);
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

        {sent ? (
          <p style={{ fontSize: 13.5, color: "#1aa35a", lineHeight: 1.6 }}>
            입력하신 이메일로 로그인 링크를 보냈어요. 받은편지함(스팸함도 확인)에서 링크를 눌러주세요.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
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
              {loading ? "전송 중..." : "로그인 링크 받기"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
