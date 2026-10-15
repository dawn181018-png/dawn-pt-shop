// 휴대폰 너비에서만 쓰는 스케줄 화면: 월 달력 + 선택한 날의 시간표. 보여주는 방식만 다르고,
// 데이터는 부모(PTMemberManager)가 이미 들고 있는 예약 목록을 그대로 받아 그 날 것만 골라 그린다.
// 일정을 누르면 부모가 PC 그리드에서 블록을 누를 때와 같은 기존 예약 메뉴(완료·서명/노쇼/취소/시간 수정 등)를
// 열고, 빈 시간을 누르면 PC 그리드의 빈 칸 클릭과 같은 예약 등록 화면을 그 날짜·시간으로 연다 —
// 예약 생성/수정/세션 차감 로직은 이 파일에 없다.
"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  isNewCustomer: boolean; // 신규 고객 레슨(초록색 + NEW) — 판단은 productUtils.isNewCustomer
  locked?: boolean; // 대리 화면의 다른 고객 예약: "예약됨" 시간만 보이고 눌러도 열리지 않는다
  delegateName?: string | null; // 관리자 화면에서 대리 트레이너가 맡은 레슨(노란색 + "대리 이름")
};

type MobileMonthScheduleProps = {
  items: MobileScheduleItem[];
  holidays: HolidayMap;
  todayStr: string;
  onMonthChange: (ym: string) => void; // 공휴일 데이터 준비용
  onSelect: (id: string, x: number, y: number) => void;
  onAdd: (date: string, time?: string) => void; // time이 있으면 빈 시간 터치(그 시간으로 예약)
};

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
// 시간표 범위/단위는 PC 스케줄 그리드와 같게: 06:00~23:00, 빈 칸 터치는 30분 단위.
// 그 범위 밖 레슨이 있는 날만 범위를 넓힌다.
const DAY_START = 6 * 60, DAY_END = 23 * 60, SLOT_MIN = 30, PX_PER_MIN = 1.3;
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const shiftYm = (ym: string, delta: number) => {
  const total = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
};
const lastDayOf = (ym: string) => addDays(`${shiftYm(ym, 1)}-01`, -1);
const dowOf = (d: string) => new Date(`${d}T00:00:00`).getDay();
// 현재 시각(하루 중 분). 30초마다 다시 확인해 "지금" 선을 옮긴다. 서버에서 그릴 땐 -1(표시 안 함).
const subscribeClock = (onChange: () => void) => { const id = setInterval(onChange, 30000); return () => clearInterval(id); };
const nowMinute = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const useNowMinute = () => useSyncExternalStore(subscribeClock, nowMinute, () => -1);

// 같은 시간에 겹치는 일정을 나란히 놓기 위한 열 배치(시작 시각 순으로 비어 있는 가장 왼쪽 열에 넣고,
// 서로 겹치는 묶음 안에서 열 수를 맞춘다).
type Placed = MobileScheduleItem & { start: number; end: number; col: number; cols: number };
function layoutDay(list: MobileScheduleItem[]): Placed[] {
  const sorted = list
    .map((r) => ({ ...r, start: toMin(r.time), end: toMin(r.time) + (r.duration || 50), col: 0, cols: 1 }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => { const n = Math.max(1, ...group.map((g) => g.col + 1)); group.forEach((g) => { g.cols = n; }); group = []; };
  for (const r of sorted) {
    if (group.length && r.start >= groupEnd) flush();
    const used = new Set(group.filter((g) => g.end > r.start).map((g) => g.col));
    let col = 0;
    while (used.has(col)) col++;
    r.col = col;
    group.push(r);
    groupEnd = Math.max(groupEnd, r.end);
  }
  if (group.length) flush();
  return sorted;
}

export default function MobileMonthSchedule({ items, holidays, todayStr, onMonthChange, onSelect, onAdd }: MobileMonthScheduleProps) {
  const [month, setMonth] = useState(todayStr.slice(0, 7));
  const [selected, setSelected] = useState(todayStr);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const now = useNowMinute();

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

  // 선택한 하루치만 배치해서 그린다.
  const placed = useMemo(() => layoutDay(items.filter((r) => r.date === selected)), [items, selected]);
  const range = useMemo(() => {
    let start = DAY_START, end = DAY_END;
    placed.forEach((r) => {
      start = Math.min(start, Math.floor(r.start / SLOT_MIN) * SLOT_MIN);
      end = Math.max(end, Math.min(24 * 60, Math.ceil(r.end / SLOT_MIN) * SLOT_MIN));
    });
    return { start, end };
  }, [placed]);
  const slots = useMemo(() => {
    const list: number[] = [];
    for (let m = range.start; m < range.end; m += SLOT_MIN) list.push(m);
    return list;
  }, [range]);

  const isToday = selected === todayStr && now >= 0;
  const isPastDay = selected < todayStr;
  const topOf = (min: number) => (min - range.start) * PX_PER_MIN;

  // 날짜를 바꿀 때마다 한 번: 오늘이면 지금 시각 조금 위, 다른 날은 첫 일정 조금 위, 일정이 없으면 오전 9시 근처.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || scrolledFor.current === selected) return;
    scrolledFor.current = selected;
    const firstActive = placed.find((r) => r.status !== "cancelled") || placed[0];
    const target = selected === todayStr && now >= 0 ? now - 60 : firstActive ? firstActive.start - 30 : 9 * 60;
    el.scrollTop = Math.max(0, topOf(target));
  });

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

      {/* 시간표: 30분 빈 칸(누르면 그 시간으로 예약) 위에 일정 카드를 시작 시각·길이대로 겹쳐 그린다. */}
      <div className="ptm-mtl-scroll" ref={scrollRef}>
        <div className="ptm-mtl" style={{ height: (range.end - range.start) * PX_PER_MIN }}>
          {slots.map((m) => {
            const past = isPastDay || (isToday && m + SLOT_MIN <= now);
            return (
              <div
                key={m}
                className={`ptm-mtl-slot${m % 60 === 0 ? " hour" : ""}${past ? " past" : ""}`}
                style={{ top: topOf(m), height: SLOT_MIN * PX_PER_MIN }}
                onClick={() => onAdd(selected, fromMin(m))}
              >
                {m % 60 === 0 && <span className="ptm-mtl-hour">{m / 60}시</span>}
              </div>
            );
          })}

          {placed.map((r) => {
            const inProgress = isToday && r.status === "scheduled" && r.start <= now && now < r.end;
            const overdue = r.status === "scheduled" && (isPastDay || (isToday && r.end <= now));
            const finished = r.status !== "scheduled";
            const isNew = r.type === "pt" && r.isNewCustomer;
            const height = Math.max(26, (r.end - r.start) * PX_PER_MIN - 2);
            const classes = [
              "ptm-mtl-item", r.status, r.type,
              isNew ? "new-customer" : "",
              finished ? "finished" : "",
              inProgress ? "in-progress" : "",
              height < 50 ? "compact" : "",
              r.locked ? "locked" : "",
              r.delegateName ? "delegated" : "",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={r.id}
                className={classes}
                style={{
                  top: topOf(r.start) + 1,
                  height,
                  left: `calc(var(--mtl-gutter) + (100% - var(--mtl-gutter)) * ${r.col / r.cols})`,
                  width: `calc((100% - var(--mtl-gutter)) / ${r.cols} - 3px)`,
                }}
                onClick={(e) => onSelect(r.id, e.clientX, e.clientY)}
              >
                <span className="ptm-mtl-item-head">
                  <span className="ptm-mtl-item-title">{r.title}</span>
                  {isNew && <span className="ptm-mtl-new">NEW</span>}
                  {r.delegateName && <span className="ptm-mtl-delegate">대리 {r.delegateName}</span>}
                  {r.type === "misc" && !r.locked && <span className="ptm-mcal-kind">기타</span>}
                  <span className="ptm-mtl-item-time">{r.time}–{fromMin(r.end)}</span>
                </span>
                <span className="ptm-mcal-item-sub">
                  {inProgress && <span className="ptm-mcal-live">진행 중</span>}
                  {overdue && r.type !== "misc" && <span className="ptm-mcal-overdue">처리 전</span>}
                  {r.status === "done" && <span className="ptm-mcal-done"><Check size={12} /> 완료{r.signed ? " · 서명" : ""}</span>}
                  {r.status === "noshow" && <span className="ptm-noshow-mark" style={{ fontSize: 11.5 }}>NO SHOW</span>}
                  {r.status === "cancelled" && <span>취소</span>}
                  {r.status === "scheduled" && r.subtitle && <span>{r.subtitle}</span>}
                  {r.hasNote && <span className="ptm-mcal-note"><NotebookPen size={12} /> 운동일지</span>}
                </span>
              </button>
            );
          })}

          {isToday && now >= range.start && now < range.end && (
            <div className="ptm-mtl-now" style={{ top: topOf(now) }}><span>{fromMin(now)}</span></div>
          )}
        </div>
      </div>
    </div>
  );
}
