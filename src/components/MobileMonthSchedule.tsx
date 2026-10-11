// 휴대폰 너비에서만 쓰는 스케줄 화면: 월 달력 + 선택한 날의 일정 목록. 보여주는 방식만 다르고,
// 데이터는 부모(PTMemberManager)가 이미 들고 있는 예약 목록을 그대로 받아 그 달 것만 골라 그린다.
// 일정을 누르면 부모가 PC 그리드에서 블록을 누를 때와 같은 기존 예약 메뉴(완료·서명/노쇼/취소/시간 수정 등)를
// 연다 — 예약 생성/수정/세션 차감 로직은 이 파일에 없다.
"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Check, NotebookPen } from "lucide-react";
import { addDays } from "@/lib/formatUtils";
import type { HolidayMap } from "@/lib/holidays";
import type { ReservationStatus, ReservationType } from "@/lib/types";

export type MobileScheduleItem = {
  id: string;
  date: string;
  time: string;
  duration: number;
  status: ReservationStatus;
  type: ReservationType;
  title: string; // 고객 이름(PT) 또는 기타 일정 제목
  subtitle: string; // 이용권 이름 등
  signed: boolean;
  hasNote: boolean;
};

type MobileMonthScheduleProps = {
  items: MobileScheduleItem[];
  holidays: HolidayMap;
  todayStr: string;
  onMonthChange: (ym: string) => void; // 공휴일 데이터 준비용
  onSelect: (id: string, x: number, y: number) => void;
  onAdd: (date: string) => void;
};

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const shiftYm = (ym: string, delta: number) => {
  const total = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
};
const lastDayOf = (ym: string) => addDays(`${shiftYm(ym, 1)}-01`, -1);
const dowOf = (d: string) => new Date(`${d}T00:00:00`).getDay();

export default function MobileMonthSchedule({ items, holidays, todayStr, onMonthChange, onSelect, onAdd }: MobileMonthScheduleProps) {
  const [month, setMonth] = useState(todayStr.slice(0, 7));
  const [selected, setSelected] = useState(todayStr);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const goMonth = (ym: string) => {
    setMonth(ym);
    setSelected(ym === todayStr.slice(0, 7) ? todayStr : `${ym}-01`);
    onMonthChange(ym);
  };

  // 이 달의 날짜 칸(일요일 시작). 달 밖의 앞뒤 칸은 비워 둔다.
  const cells = useMemo(() => {
    const first = `${month}-01`;
    const last = lastDayOf(month);
    const lead = dowOf(first);
    const days: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [month]);

  // 그 달의 날짜별 "취소되지 않은 예약 수"(막대 길이 기준)
  const countByDate = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((r) => {
      if (r.status !== "cancelled" && r.date.startsWith(month)) map[r.date] = (map[r.date] || 0) + 1;
    });
    return map;
  }, [items, month]);

  const dayItems = useMemo(
    () => items.filter((r) => r.date === selected).sort((a, b) => a.time.localeCompare(b.time)),
    [items, selected],
  );

  const onTouchStart = (e: React.TouchEvent) => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 40) goMonth(shiftYm(month, dx < 0 ? 1 : -1));
  };

  const selDow = dowOf(selected);
  const selHoliday = holidays[selected];

  return (
    <div className="ptm-mcal">
      <div className="ptm-mcal-top">
        <div>
          <div className="ptm-mcal-year">{month.slice(0, 4)}년</div>
          <div className="ptm-mcal-month">{Number(month.slice(5, 7))}월</div>
        </div>
        <div className="ptm-mcal-actions">
          <button className="ptm-nav-btn" onClick={() => goMonth(shiftYm(month, -1))}><ChevronLeft size={18} /></button>
          <button className="ptm-nav-today" onClick={() => { setMonth(todayStr.slice(0, 7)); setSelected(todayStr); onMonthChange(todayStr.slice(0, 7)); }}>오늘</button>
          <button className="ptm-nav-btn" onClick={() => goMonth(shiftYm(month, 1))}><ChevronRight size={18} /></button>
          <button className="ptm-nav-btn ptm-mcal-add" onClick={() => onAdd(selected)} title="선택한 날짜에 예약 추가"><Plus size={18} /></button>
        </div>
      </div>

      <div className="ptm-mcal-grid" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {WEEK.map((w, i) => <div key={w} className={`ptm-mcal-head${i === 0 || i === 6 ? " weekend" : ""}`}>{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`empty-${i}`} className="ptm-mcal-cell empty" />;
          const n = countByDate[d] || 0;
          const dow = i % 7;
          const classes = [
            "ptm-mcal-cell",
            holidays[d] ? "holiday" : dow === 0 || dow === 6 ? "weekend" : "",
            d === todayStr ? "today" : "",
            d === selected ? "selected" : "",
          ].filter(Boolean).join(" ");
          return (
            <button key={d} className={classes} onClick={() => setSelected(d)}>
              <span className="ptm-mcal-num">{Number(d.slice(8, 10))}</span>
              <span className={`ptm-mcal-bar${n === 0 ? " none" : n === 1 ? " dot" : n <= 3 ? " short" : " long"}`} />
            </button>
          );
        })}
      </div>

      <div className="ptm-mcal-dayhead">
        {Number(selected.slice(5, 7))}월 {Number(selected.slice(8, 10))}일 {WEEK[selDow]}요일
        {selHoliday && <span className="ptm-mcal-holiday-name"> · {selHoliday.join(", ")}</span>}
      </div>

      {dayItems.length === 0 ? (
        <div className="ptm-mcal-empty">일정이 없어요</div>
      ) : (
        dayItems.map((r) => (
          <button key={r.id} className={`ptm-mcal-item ${r.status} ${r.type}`} onClick={(e) => onSelect(r.id, e.clientX, e.clientY)}>
            <span className="ptm-mcal-item-bar" />
            <span className="ptm-mcal-item-main">
              <span className="ptm-mcal-item-title">
                {r.title}
                <span className="ptm-mcal-kind">{r.type === "misc" ? "기타" : "PT"}</span>
              </span>
              <span className="ptm-mcal-item-sub">
                {r.status === "done" && <span className="ptm-mcal-done"><Check size={12} /> 완료{r.signed ? " · 서명" : ""}</span>}
                {r.status === "noshow" && <span className="ptm-noshow-mark" style={{ fontSize: 11.5 }}>NO SHOW</span>}
                {r.status === "cancelled" && <span>취소</span>}
                {r.status === "scheduled" && r.subtitle && <span>{r.subtitle}</span>}
                {r.hasNote && <span className="ptm-mcal-note"><NotebookPen size={12} /> 운동일지</span>}
              </span>
            </span>
            <span className="ptm-mcal-item-time">
              <span>{r.time}</span>
              <span className="ptm-mcal-item-end">{fromMin(toMin(r.time) + (r.duration || 50))}</span>
            </span>
          </button>
        ))
      )}
    </div>
  );
}
