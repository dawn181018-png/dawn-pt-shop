"use client";

import { useState } from "react";
import type { Product, Reservation } from "@/lib/types";
import type { WorkoutLogEntry } from "@/lib/workoutLog";
import { matchBodyPartTags } from "@/lib/workoutLog";
import { logoutMember } from "./actions";
import "@/components/ptm.css";

const toLocalDateStr = (d: Date) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const today = () => toLocalDateStr(new Date());
const koDate = (dateStr: string) => { const d = new Date(dateStr); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
const daysUntil = (dateStr: string) => Math.ceil((new Date(dateStr).getTime() - new Date(today()).getTime()) / 86400000);

function urgency(p: Product): "ok" | "warn" | "critical" {
  if (p.type === "session") {
    const remain = p.totalSessions - p.usedSessions;
    if (remain <= 1) return "critical";
    if (remain <= 3) return "warn";
    return "ok";
  }
  const remain = daysUntil(p.endDate || today());
  if (remain <= 3) return "critical";
  if (remain <= 10) return "warn";
  return "ok";
}
function remainLabel(p: Product) {
  if (p.type === "session") return `${p.totalSessions - p.usedSessions}회 남음 / 총 ${p.totalSessions}회`;
  const remain = daysUntil(p.endDate || today());
  return remain < 0 ? `만료 ${Math.abs(remain)}일 지남` : `${remain}일 남음`;
}
function progressPct(p: Product) {
  if (p.type === "session") return Math.max(0, Math.min(100, (p.usedSessions / p.totalSessions) * 100));
  const total = Math.ceil((new Date(p.endDate || today()).getTime() - new Date(p.startDate).getTime()) / 86400000) || 1;
  const used = Math.ceil((new Date(today()).getTime() - new Date(p.startDate).getTime()) / 86400000);
  return Math.max(0, Math.min(100, (used / total) * 100));
}
function isDepleted(p: Product): boolean {
  if (p.type === "session") return p.totalSessions - p.usedSessions <= 0;
  return daysUntil(p.endDate || today()) < 0;
}
function sortProductsByUsage(list: Product[]): Product[] {
  return [...list].sort((a, b) => Number(isDepleted(a)) - Number(isDepleted(b)));
}

const statusLabel: Record<string, string> = { scheduled: "예약됨", done: "완료", noshow: "노쇼", cancelled: "취소" };

const NOTE_PREVIEW_LEN = 80;

export default function MyPageView({
  customerName,
  products,
  reservations,
  workoutLogs,
}: {
  customerName: string;
  products: Product[];
  reservations: Reservation[];
  workoutLogs: WorkoutLogEntry[];
}) {
  const [tab, setTab] = useState<"products" | "reservations" | "workoutLog">("products");
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});

  const upcoming = reservations.filter((r) => r.status === "scheduled" && r.date >= today());
  const past = reservations
    .filter((r) => !(r.status === "scheduled" && r.date >= today()))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  return (
    <div className="ptm-root">
      <form action={logoutMember} style={{ position: "fixed", top: 12, right: 12, zIndex: 100 }}>
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

      <p className="ptm-eyebrow">던휘트니스 삼성점 · 마이페이지</p>
      <h1 className="ptm-title">{customerName}님</h1>

      <div className="ptm-detail-tabs" style={{ marginTop: 16 }}>
        <button className={`ptm-detail-tab ${tab === "products" ? "active" : ""}`} onClick={() => setTab("products")}>이용권</button>
        <button className={`ptm-detail-tab ${tab === "reservations" ? "active" : ""}`} onClick={() => setTab("reservations")}>예약내역</button>
        <button className={`ptm-detail-tab ${tab === "workoutLog" ? "active" : ""}`} onClick={() => setTab("workoutLog")}>운동일지</button>
      </div>

      {tab === "products" && (
        <div className="ptm-prod-list">
          {products.length === 0 ? (
            <div className="ptm-no-product-msg">등록된 이용권이 없어요</div>
          ) : (
            sortProductsByUsage(products).map((p) => {
              const u = urgency(p);
              const depleted = isDepleted(p);
              return (
                <div className={`ptm-prod-row${depleted ? " depleted" : ""}`} key={p.id}>
                  <div className="ptm-prod-top">
                    <span className="ptm-prod-name">{p.name}</span>{" "}
                    <span className="ptm-badge">{p.type === "session" ? "횟수권" : "기간권"}</span>
                  </div>
                  <div className="ptm-gauge-row">
                    <div className="ptm-gauge-track"><div className={`ptm-gauge-fill ${u}`} style={{ width: `${progressPct(p)}%` }} /></div>
                    <div className="ptm-gauge-label">{remainLabel(p)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === "reservations" && (
        <>
          <div className="ptm-detail-section-title">예정된 예약</div>
          {upcoming.length === 0 ? (
            <div className="ptm-res-empty">예정된 예약이 없어요</div>
          ) : (
            upcoming.map((r) => (
              <div className="ptm-res-item" key={r.id}>
                <div className="ptm-res-item-top">
                  <span className="ptm-res-date">{koDate(r.date)} {r.time}</span>
                  <span className="ptm-res-badge">{statusLabel[r.status]}</span>
                </div>
              </div>
            ))
          )}

          <div className="ptm-detail-section-title" style={{ marginTop: 16 }}>지난 예약</div>
          {past.length === 0 ? (
            <div className="ptm-res-empty">지난 예약 내역이 없어요</div>
          ) : (
            past.map((r) => (
              <div className="ptm-res-item" key={r.id}>
                <div className="ptm-res-item-top">
                  <span className="ptm-res-date">{koDate(r.date)} {r.time}</span>
                  <span className={`ptm-res-badge ${r.status}`}>{statusLabel[r.status]}</span>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {tab === "workoutLog" && (
        <div className="ptm-prod-list" style={{ marginTop: 0 }}>
          {workoutLogs.length === 0 ? (
            <div className="ptm-no-product-msg">기록된 운동 내용이 없어요</div>
          ) : (
            workoutLogs.map((log) => {
              const tags = matchBodyPartTags(log.note);
              const isLong = log.note.length > NOTE_PREVIEW_LEN;
              const expanded = !!expandedNotes[log.reservationId];
              const shownNote = isLong && !expanded ? `${log.note.slice(0, NOTE_PREVIEW_LEN)}…` : log.note;
              return (
                <div className="ptm-prod-row" key={log.reservationId}>
                  <div className="ptm-prod-top">
                    <span className="ptm-prod-name">{koDate(log.date)} {log.time}</span>
                    {tags.length > 0 && (
                      <div className="ptm-actions">
                        {tags.map((tag) => <span className="ptm-badge" key={tag}>{tag}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="ptm-res-memo" style={{ whiteSpace: "pre-wrap" }}>{shownNote}</div>
                  {isLong && (
                    <button
                      className="ptm-icon-btn"
                      style={{ width: "auto", padding: "2px 0", fontSize: 12, color: "var(--ink-dim)" }}
                      onClick={() => setExpandedNotes((prev) => ({ ...prev, [log.reservationId]: !expanded }))}
                    >
                      {expanded ? "접기" : "더보기"}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
