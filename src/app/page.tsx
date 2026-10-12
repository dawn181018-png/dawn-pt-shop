import PTMemberManager from "@/components/PTMemberManager";
import { logout } from "./login/actions";

const topButtonStyle = {
  background: "#ffffff", border: "1px solid #dde3ee", borderRadius: 8,
  padding: "6px 12px", fontSize: 12.5, color: "#6b7684", cursor: "pointer", textDecoration: "none",
};

export default function HomePage() {
  return (
    <>
      <form
        action={logout}
        style={{ position: "fixed", top: 12, right: 12, zIndex: 100, display: "flex", gap: 6 }}
      >
        {/* 전체 데이터를 JSON 파일로 내려받는다(읽기 전용, 본인 데이터만) — 일회성 백업용 */}
        <a href="/api/backup/download" style={topButtonStyle} title="전체 데이터를 파일로 내려받기">백업 받기</a>
        <button type="submit" style={topButtonStyle}>
          로그아웃
        </button>
      </form>
      <PTMemberManager />
    </>
  );
}
