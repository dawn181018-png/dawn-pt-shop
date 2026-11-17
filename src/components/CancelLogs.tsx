// 예약 "취소 내역" 화면 — 관리자(대표) 화면에서만 쓴다. 기록은 DB가 취소·삭제와 같은 처리 안에서 남기고(추가만 가능),
// 여기서는 보여주기만 한다: 고객 상세의 "취소 내역" 구역과, 기간·이름·담당 강사로 걸러 보는 전체 목록.
"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { addDays } from "@/lib/formatUtils";
import { cancelActorLabel, cancelKindLabel, cancelSummary, filterCancelLogs, type ReservationCancelLog } from "@/lib/cancelLogs";
import type { TrainerOption } from "@/lib/trainers";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const koDateShort = (d: string | null) => {
  if (!d) return "-";
  const dow = WEEK[new Date(`${d}T00:00:00`).getDay()];
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${dow})`;
};
const cancelledAtShort = (iso: string) => {
  const t = new Date(iso);
  return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

// 한 줄 요약: "11/20(목) 10:00 · 김철수 · PT 30회" / "취소 11/16 14:02 · 담당 대표 · 한 건 취소 · 처리 대리 장재혁 · 사유"
function CancelLogRow({ log, showCustomer }: { log: ReservationCancelLog; showCustomer: boolean }) {
  const actor = cancelActorLabel(log);
  return (
    <div className="ptm-cl-row">
      <div className="ptm-cl-main">
        <span className="ptm-cl-when">{koDateShort(log.reservationDate)} {log.reservationTime || ""}</span>
        {showCustomer && <span className="ptm-cl-name">{log.customerName || "(이름 없음)"}</span>}
        {log.productName && <span className="ptm-cl-prod">{log.productName}</span>}
      </div>
      <div className="ptm-cl-sub">
        <span>취소 {cancelledAtShort(log.cancelledAt)}</span>
        <span>담당 {log.trainerName || "대표"}</span>
        <span className={`ptm-cl-kind k-${log.cancelKind}`}>{cancelKindLabel(log)}</span>
        {log.fromSeries && log.cancelKind !== "series" && <span>반복</span>}
        {actor !== "대표" && <span>처리 {actor}</span>}
      </div>
      {log.memo && <div className="ptm-cl-memo">사유: {log.memo}</div>}
    </div>
  );
}

// 고객 상세 > 최근 예약 아래 "취소 내역" 구역
export function CustomerCancelLogs({ logs, customerId, todayStr }: { logs: ReservationCancelLog[] | null; customerId: string; todayStr: string }) {
  const [showAll, setShowAll] = useState(false);
  const mine = useMemo(() => filterCancelLogs((logs || []).filter((l) => l.customerId === customerId), {}), [logs, customerId]);
  const sum = cancelSummary(mine, todayStr);
  return (
    <>
      <div className="ptm-detail-section-title" style={{ marginTop: 14 }}>
        취소 내역 <span className="ptm-cl-count">이번 달 취소 {sum.month}건 / 전체 {sum.total}건</span>
      </div>
      {logs === null ? (
        <div className="ptm-res-empty">취소 내역 기능은 DB 변경 파일 실행 후 기록이 시작돼요</div>
      ) : mine.length === 0 ? (
        <div className="ptm-res-empty">취소 내역이 없어요</div>
      ) : (
        <div className="ptm-cl-list">
          {(showAll ? mine : mine.slice(0, 5)).map((l) => <CancelLogRow key={l.id} log={l} showCustomer={false} />)}
          {mine.length > 5 && (
            <button className="ptm-cl-more" onClick={() => setShowAll((v) => !v)}>{showAll ? "접기" : `${mine.length - 5}건 더 보기`}</button>
          )}
        </div>
      )}
    </>
  );
}

// 전체 취소 내역(고객관리 화면에서 열기): 기간(취소한 날짜) · 회원 이름 · 담당 강사로 걸러 보기
export function CancelLogsSheet({ logs, trainerOpts, todayStr, onClose }: {
  logs: ReservationCancelLog[] | null; trainerOpts: TrainerOption[]; todayStr: string; onClose: () => void;
}) {
  const [from, setFrom] = useState(`${todayStr.slice(0, 7)}-01`);
  const [to, setTo] = useState(todayStr);
  const [name, setName] = useState("");
  const [trainer, setTrainer] = useState("all");
  const list = useMemo(() => filterCancelLogs(logs || [], { from, to, name, trainer }), [logs, from, to, name, trainer]);
  const sum = cancelSummary(logs || [], todayStr);
  const preset = (days: number | "month") => {
    if (days === "month") { setFrom(`${todayStr.slice(0, 7)}-01`); setTo(todayStr); return; }
    setFrom(addDays(todayStr, -days + 1)); setTo(todayStr);
  };
  return (
    <div className="ptm-overlay" onClick={onClose}>
      <div className="ptm-sheet ptm-cl-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ptm-sheet-head">
          <span className="ptm-sheet-title">취소 내역</span>
          <button className="ptm-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ptm-cl-summary">이번 달 취소 {sum.month}건 / 전체 {sum.total}건</div>
        <div className="ptm-cl-filters">
          <div className="ptm-cl-range">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="시작일" />
            <span>~</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="종료일" />
          </div>
          <div className="ptm-cl-presets">
            <button onClick={() => preset("month")}>이번 달</button>
            <button onClick={() => preset(7)}>최근 7일</button>
            <button onClick={() => preset(30)}>최근 30일</button>
            <button onClick={() => { setFrom(""); setTo(""); }}>전체 기간</button>
          </div>
          <div className="ptm-cl-range">
            <input placeholder="회원 이름 검색" value={name} onChange={(e) => setName(e.target.value)} />
            <select value={trainer} onChange={(e) => setTrainer(e.target.value)} aria-label="담당 강사">
              <option value="all">담당 전체</option>
              {trainerOpts.map((o) => <option key={o.key} value={o.key}>{o.key === "owner" ? "대표" : o.name}</option>)}
            </select>
          </div>
        </div>
        <div className="ptm-cl-result">{list.length}건</div>
        {logs === null ? (
          <div className="ptm-res-empty">취소 내역 기능은 DB 변경 파일 실행 후 기록이 시작돼요</div>
        ) : list.length === 0 ? (
          <div className="ptm-res-empty">조건에 맞는 취소 내역이 없어요</div>
        ) : (
          <div className="ptm-cl-list">{list.map((l) => <CancelLogRow key={l.id} log={l} showCustomer />)}</div>
        )}
      </div>
    </div>
  );
}
