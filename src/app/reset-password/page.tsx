"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 해요");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 1500);
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
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 20px" }}>새 비밀번호 설정</h1>

        {done ? (
          <p style={{ fontSize: 13.5, color: "#1aa35a", lineHeight: 1.6 }}>
            비밀번호가 변경됐어요. 로그인 화면으로 이동합니다...
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontSize: 12.5, color: "#6b7684", marginBottom: 5 }}>새 비밀번호</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6자 이상"
              style={{
                width: "100%", background: "#f3f5fa", border: "1px solid #dde3ee", color: "#1f2937",
                borderRadius: 8, padding: "9px 10px", fontSize: 14, marginBottom: 16,
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
              {loading ? "저장 중..." : "비밀번호 변경"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
