import PTMemberManager from "@/components/PTMemberManager";
import { logout } from "./login/actions";

export default function HomePage() {
  return (
    <>
      <form
        action={logout}
        style={{ position: "fixed", top: 12, right: 12, zIndex: 100 }}
      >
        <button
          type="submit"
          style={{
            background: "#ffffff", border: "1px solid #dde3ee", borderRadius: 8,
            padding: "6px 12px", fontSize: 12.5, color: "#6b7684", cursor: "pointer",
          }}
        >
          로그아웃
        </button>
      </form>
      <PTMemberManager />
    </>
  );
}
