// 잔여 횟수 기준 반복예약 창. 요일(여러 개)·시간·시작일을 고르면 "아직 예약 안 된 횟수"만큼 회차 날짜를 계산해
// 미리보기(총 회차, 첫/마지막 회차, 월별 회차 수, 건너뛴 공휴일)를 보여주고, 확정해야 저장한다.
// 재등록으로 잔여가 늘었을 때 기존 반복을 이어서 연장하는 데도 같은 창을 쓴다(mode="extend": 규칙은 고정).
// 이용권 만료일은 전혀 보지 않는다 — 만료 여부는 사장님이 직접 판단해 필요한 회차를 취소한다.
"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { loadHolidays, type HolidayMap } from "@/lib/holidays";
import { generateSlotDates, monthBreakdown, weekdaysLabel, WEEKDAY_LABELS, WEEKDAY_ORDER } from "@/lib/recurring";

export type RecurringRule = { weekdays: number[]; time: string; duration: number; skipHolidays: boolean };

type RecurringBookingSheetProps = {
  mode: "new" | "extend";
  customerName: string;
  remaining: number;
  scheduled: number;
  unbooked: number;
  initialStartDate: string;
  initialRule: RecurringRule;
  intro?: string;
  onConfirm: (rule: RecurringRule, dates: string[]) => Promise<boolean>;
  onClose: () => void;
};

const hourOptions = Array.from({ length: 18 }, (_, i) => String(5 + i).padStart(2, "0"));
const minuteOptions = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
const fmtDate = (d: string) => { const x = new Date(`${d}T00:00:00`); return `${x.getMonth() + 1}/${x.getDate()}(${WEEKDAY_LABELS[x.getDay()]})`; };
const fmtYm = (ym: string) => `${Number(ym.slice(5, 7))}월`;

export default function RecurringBookingSheet({
  mode, customerName, remaining, scheduled, unbooked, initialStartDate, initialRule, intro, onConfirm, onClose,
}: RecurringBookingSheetProps) {
  const [startDate, setStartDate] = useState(initialStartDate);
  const [weekdays, setWeekdays] = useState<number[]>(initialRule.weekdays);
  const [hour, setHour] = useState(initialRule.time.slice(0, 2));
  const [minute, setMinute] = useState(initialRule.time.slice(3, 5));
  const [duration, setDuration] = useState(initialRule.duration);
  const [skipHolidays, setSkipHolidays] = useState(initialRule.skipHolidays);
  // 잔여가 있으면 "아직 예약 안 된 횟수"가 기본값이고 그보다 적게만 줄일 수 있다. 이용권이 없거나 잔여가 0이면 직접 입력.
  const [count, setCount] = useState<number>(unbooked > 0 ? unbooked : 4);
  const [holidays, setHolidays] = useState<HolidayMap>({});
  const [saving, setSaving] = useState(false);
  const locked = mode === "extend";
  const maxCount = unbooked > 0 ? unbooked : 200;

  // 공휴일은 스케줄표 주황색 표시와 같은 데이터. 회차가 몇 년에 걸칠 수 있어 시작 연도부터 5년치를 불러둔다.
  useEffect(() => {
    if (!startDate) return;
    const y = Number(startDate.slice(0, 4));
    loadHolidays([0, 1, 2, 3, 4].map((i) => String(y + i))).then(setHolidays);
  }, [startDate]);

  const safeCount = Math.max(0, Math.min(maxCount, Number(count) || 0));
  const preview = useMemo(
    () => generateSlotDates({ startDate, weekdays, count: safeCount, skipHolidays, holidays }),
    [startDate, weekdays, safeCount, skipHolidays, holidays],
  );
  const months = monthBreakdown(preview.dates);

  const toggleWeekday = (w: number) =>
    setWeekdays((cur) => (cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w]));

  const confirm = async () => {
    if (saving || preview.dates.length === 0) return;
    setSaving(true);
    const ok = await onConfirm({ weekdays, time: `${hour}:${minute}`, duration: Number(duration) || 50, skipHolidays }, preview.dates);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="ptm-overlay" onClick={() => !saving && onClose()}>
      <div className="ptm-sheet" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="ptm-sheet-head">
          <span className="ptm-sheet-title">{locked ? "반복 일정 이어서 잡기" : "반복 예약 (잔여 횟수만큼)"}</span>
          <button className="ptm-icon-btn" onClick={onClose} disabled={saving}><X size={16} /></button>
        </div>
        {intro && <div className="ptm-discount-note" style={{ marginTop: -4 }}>{intro}</div>}
        <div className="ptm-rec-summary">
          <b>{customerName}</b> · 잔여 {remaining}회 − 예약됨 {scheduled}회 = <b>아직 예약 안 된 {unbooked}회</b>
        </div>

        {locked ? (
          <div className="ptm-rec-rule">반복: 매주 {weekdaysLabel(weekdays)} {hour}:{minute} ({duration}분){skipHolidays ? " · 공휴일 건너뜀" : ""}</div>
        ) : (
          <>
            <div className="ptm-field"><label>요일 (여러 개 선택)</label>
              <div className="ptm-rec-weekdays">
                {WEEKDAY_ORDER.map((w) => (
                  <button key={w} className={`ptm-rec-day${weekdays.includes(w) ? " active" : ""}${w === 0 || w === 6 ? " weekend" : ""}`} onClick={() => toggleWeekday(w)}>
                    {WEEKDAY_LABELS[w]}
                  </button>
                ))}
              </div>
            </div>
            <div className="ptm-row3">
              <div className="ptm-field"><label>시</label>
                <select value={hour} onChange={(e) => setHour(e.target.value)}>{hourOptions.map((h) => <option key={h} value={h}>{h}시</option>)}</select>
              </div>
              <div className="ptm-field"><label>분</label>
                <select value={minute} onChange={(e) => setMinute(e.target.value)}>{minuteOptions.map((m) => <option key={m} value={m}>{m}분</option>)}</select>
              </div>
              <div className="ptm-field"><label>레슨(분)</label>
                <input type="number" onFocus={(e) => e.target.select()} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
              </div>
            </div>
            <div className="ptm-field"><label>공휴일에 걸리는 회차</label>
              <div className="ptm-type-toggle">
                <button className={`ptm-type-btn ${skipHolidays ? "active" : ""}`} onClick={() => setSkipHolidays(true)}>건너뛰고 이어가기</button>
                <button className={`ptm-type-btn ${!skipHolidays ? "active" : ""}`} onClick={() => setSkipHolidays(false)}>그대로 잡기</button>
              </div>
            </div>
          </>
        )}

        <div className="ptm-row2">
          <div className="ptm-field"><label>{locked ? "이어서 시작할 날" : "시작일"}</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="ptm-field"><label>{unbooked > 0 ? `만들 회차 (최대 ${unbooked}회)` : "만들 회차 (직접 입력)"}</label>
            <input type="number" min={1} max={maxCount} onFocus={(e) => e.target.select()} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
        </div>
        {unbooked === 0 && (
          <div className="ptm-no-product-msg" style={{ marginTop: -6 }}>
            남은 횟수권 잔여가 없어서(또는 이미 모두 예약돼 있어서) 회차 수를 직접 정해야 해요.
          </div>
        )}

        <div className="ptm-rec-preview">
          {weekdays.length === 0 ? (
            <div>요일을 하나 이상 골라주세요</div>
          ) : preview.dates.length === 0 ? (
            <div>만들 회차가 없어요</div>
          ) : (
            <>
              <div className="ptm-rec-preview-main">총 <b>{preview.dates.length}회</b> · 매주 {weekdaysLabel(weekdays)} {hour}:{minute}</div>
              <div>첫 회차 <b>{fmtDate(preview.dates[0])}</b> → 마지막 회차 <b>{fmtDate(preview.dates[preview.dates.length - 1])}</b></div>
              <div>{months.map((m) => `${fmtYm(m.ym)} ${m.count}회`).join(" · ")}</div>
              {preview.skipped.length > 0 && (
                <div className="ptm-rec-skipped">건너뛴 공휴일: {preview.skipped.map((s) => `${fmtDate(s.date)} ${s.names[0]}`).join(", ")}</div>
              )}
            </>
          )}
        </div>

        <button className="ptm-save-btn" disabled={saving || preview.dates.length === 0} onClick={confirm}>
          {saving ? "저장 중..." : `${preview.dates.length}회 예약 확정`}
        </button>
      </div>
    </div>
  );
}
