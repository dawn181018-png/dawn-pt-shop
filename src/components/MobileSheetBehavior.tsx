// 휴대폰(640px 이하)에서 모든 창(ptm-overlay > ptm-sheet)에 공통으로 붙는 동작 — 화면에는 아무것도 그리지 않는다.
// 1) 끌어서 닫기: 창 맨 위 손잡이 막대(ptm.css의 .ptm-sheet::before)나 제목 줄을 아래로 끌면 창이 따라 내려오고,
//    충분히 내리면 그 창의 바깥(어두운 배경)을 누른 것과 같은 방법으로 닫는다. 창 안쪽 내용은 끌어도 스크롤만 된다.
// 2) 실수로 닫힘 방지: 창 안에서 글자를 입력했거나 서명 칸에 그렸거나(data-dirty), 창이 직접 잠가 둔 경우(data-lock)에는
//    바깥 터치·끌어서 닫기를 막고 닫기(X) 버튼으로만 닫히게 한다(살짝 흔들어 알려 준다).
// 3) 창이 열려 있는 동안 뒤 화면은 스크롤되지 않고, 닫으면 원래 보던 위치로 돌아간다.
// PC 폭에서는 아무 일도 하지 않는다. 저장·차감 같은 처리 로직과는 관계없다.
"use client";

import { useEffect } from "react";

const MOBILE_QUERY = "(max-width: 640px)";
const GRIP_HEIGHT = 26; // 손잡이 막대 영역(위에서부터 px) — 이 안이나 제목 줄에서 시작한 끌기만 닫기로 본다
const CLOSE_DISTANCE = 90; // 이만큼 아래로 끌면 닫힘
const TEXT_INPUT_TYPES = new Set(["", "text", "search", "tel", "email", "number", "password", "url", "date", "time", "datetime-local", "month"]);

const isMobile = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;
const isLocked = (sheet: Element | null) => !!sheet && (sheet.hasAttribute("data-dirty") || sheet.getAttribute("data-lock") === "1");

function nudge(sheet: HTMLElement) {
  sheet.animate?.(
    [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
    { duration: 220, easing: "ease-out" },
  );
}

export default function MobileSheetBehavior() {
  useEffect(() => {
    // ---- 2) 입력·서명 표시(창이 닫힐 때까지 유지) ----
    const markDirty = (e: Event) => {
      if (!isMobile()) return;
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest) return;
      const sheet = t.closest(".ptm-overlay .ptm-sheet");
      if (!sheet) return;
      const isText = t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && TEXT_INPUT_TYPES.has(((t as HTMLInputElement).type || "").toLowerCase()));
      if (isText) sheet.setAttribute("data-dirty", "1");
    };
    const markDrawing = (e: Event) => {
      if (!isMobile()) return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "CANVAS") t.closest(".ptm-overlay .ptm-sheet")?.setAttribute("data-dirty", "1");
    };
    // 바깥(어두운 배경) 터치: 잠긴 창이면 닫지 않는다(React보다 먼저 가로챈다)
    const blockOutside = (e: MouseEvent) => {
      if (!isMobile()) return;
      const t = e.target as HTMLElement | null;
      if (!t || !t.classList?.contains("ptm-overlay")) return;
      const sheet = t.querySelector<HTMLElement>(":scope > .ptm-sheet");
      if (sheet && isLocked(sheet) && !(e as MouseEvent & { __sheetDragClose?: boolean }).__sheetDragClose) {
        e.stopPropagation();
        e.preventDefault();
        nudge(sheet);
      }
    };

    // ---- 1) 손잡이·제목 줄을 끌어서 닫기 ----
    let drag: { sheet: HTMLElement; overlay: HTMLElement; y0: number; t0: number; dy: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      if (!isMobile() || e.touches.length !== 1) return;
      const t = e.target as HTMLElement | null;
      const sheet = t?.closest?.(".ptm-overlay > .ptm-sheet") as HTMLElement | null;
      if (!t || !sheet) return;
      if (t.closest("button, a, input, select, textarea, canvas, label")) return; // 제목 줄의 버튼 등은 원래대로
      const y = e.touches[0].clientY;
      const inGrip = y - sheet.getBoundingClientRect().top <= GRIP_HEIGHT;
      const inHead = !!t.closest(".ptm-sheet-head");
      if (!inGrip && !inHead) return; // 창 안쪽 내용 → 평소처럼 스크롤
      drag = { sheet, overlay: sheet.parentElement as HTMLElement, y0: y, t0: Date.now(), dy: 0 };
      sheet.style.transition = "none";
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!drag) return;
      const dy = Math.max(0, e.touches[0].clientY - drag.y0);
      drag.dy = dy;
      if (dy > 0) e.preventDefault(); // 끄는 동안 창·화면이 같이 스크롤되지 않게
      const locked = isLocked(drag.sheet);
      drag.sheet.style.transform = `translateY(${locked ? Math.min(dy, 24) * 0.5 : dy}px)`;
    };
    const reset = (sheet: HTMLElement) => {
      sheet.style.transition = "transform 0.18s ease-out";
      sheet.style.transform = "";
    };
    const onTouchEnd = () => {
      if (!drag) return;
      const { sheet, overlay, dy, t0 } = drag;
      drag = null;
      const fast = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6;
      if (dy < CLOSE_DISTANCE && !fast) { reset(sheet); return; }
      if (isLocked(sheet)) { reset(sheet); nudge(sheet); return; }
      sheet.style.transition = "transform 0.16s ease-in";
      sheet.style.transform = "translateY(110vh)";
      window.setTimeout(() => {
        // 그 창의 바깥을 누른 것과 같은 방법으로 닫는다(각 창의 닫기 규칙을 그대로 따름)
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true }) as MouseEvent & { __sheetDragClose?: boolean };
        ev.__sheetDragClose = true;
        overlay.dispatchEvent(ev);
        window.setTimeout(() => { if (sheet.isConnected) reset(sheet); }, 60); // 닫히지 않는 창이면 제자리로
      }, 150);
    };

    // ---- 3) 창이 열려 있는 동안 뒤 화면 고정 ----
    let lockedY: number | null = null;
    const body = document.body;
    const syncScrollLock = () => {
      const open = isMobile() && !!document.querySelector(".ptm-overlay");
      if (open && lockedY === null) {
        lockedY = window.scrollY;
        body.style.position = "fixed";
        body.style.top = `-${lockedY}px`;
        body.style.left = "0";
        body.style.right = "0";
        body.style.width = "100%";
      } else if (!open && lockedY !== null) {
        const y = lockedY;
        lockedY = null;
        body.style.position = "";
        body.style.top = "";
        body.style.left = "";
        body.style.right = "";
        body.style.width = "";
        window.scrollTo(0, y);
      }
    };
    const mo = new MutationObserver(syncScrollLock);
    mo.observe(body, { childList: true, subtree: true });

    document.addEventListener("input", markDirty, true);
    document.addEventListener("pointerdown", markDrawing, true);
    window.addEventListener("click", blockOutside, true);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    return () => {
      mo.disconnect();
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("pointerdown", markDrawing, true);
      window.removeEventListener("click", blockOutside, true);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      if (lockedY !== null) { lockedY = null; body.style.position = ""; body.style.top = ""; body.style.left = ""; body.style.right = ""; body.style.width = ""; }
    };
  }, []);
  return null;
}
