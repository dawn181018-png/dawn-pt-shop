// 로그아웃 버튼 — 실수로 눌러도 바로 나가지 않게 "로그아웃 하시겠습니까?"를 먼저 묻는다(확인을 눌러야 로그아웃).
"use client";

import type { CSSProperties } from "react";

export default function LogoutButton({ style }: { style: CSSProperties }) {
  return (
    <button
      type="submit"
      style={style}
      onClick={(e) => { if (!window.confirm("로그아웃 하시겠습니까?")) e.preventDefault(); }}
    >
      로그아웃
    </button>
  );
}
