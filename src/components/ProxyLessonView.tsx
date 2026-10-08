// 대리 레슨 전용 화면(/proxy) — 휴대폰으로 쓰는 화면이라 하루 단위 목록으로 단순하게 보여준다.
// 대리 트레이너는 지정된 고객의 레슨(예약/완료·서명/노쇼/시간 변경/취소/운동일지)만 할 수 있다. 화면에 보이는
// 데이터는 전부 DB의 proxy_* 함수가 "지정 고객 + 유효 기간"으로 걸러서 내려준 것이고, 다른 고객의 예약은 이름
// 없이 시간대만 온다. 결제/매출/급여/연락처 전체는 애초에 받지 않는다.
"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X, Check, LogOut, Plus } from "lucide-react";
import SignatureModal from "@/components/SignatureModal";
import { today, addDays } from "@/lib/formatUtils";
import {
  loadProxyContext, addProxyReservations, setProxyReservationStatus, moveProxyReservation, saveProxyWorkoutNote,
  type ProxyContext, type ProxyProduct, type ProxyReservation,
} from "@/lib/proxyDb";
import { proxyCompleteWithSignature, logoutProxy } from "@/app/proxy/actions";
import "@/components/ptm.css";

const weekdayFull = ["일", "월", "화", "수", "목", "금", "토"];
const dayTitle = (dateStr: string) => { const d = new Date(`${dateStr}T00:00:00`); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdayFull[d.getDay()]})`; };
const shortDate = (dateStr: string) => { const d = new Date(`${dateStr}T00:00:00`); return `${d.getMonth() + 1}/${d.getDate()}(${weekdayFull[d.getDay()]})`; };
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const timeRange = (time: string, duration: number) => `${time} – ${fromMin(toMin(time) + (duration || 50))}`;
const hourOptions = Array.from({ length: 17 }, (_, i) => String(6 + i).padStart(2, "0"));
const minuteOptions = ["00", "10", "20", "30", "40", "50"];
const statusLabel: Record<string, string> = { scheduled: "예약됨", done: "완료", noshow: "노쇼", cancelled: "취소" };

// 달력: 그 달 1일이 속한 주의 월요일부터 6주(42칸)를 그린다.
const monthGridDates = (ym: string): string[] => {
  const first = `${ym}-01`;
  const dow = new Date(`${first}T00:00:00`).getDay();
  const start = addDays(first, dow === 0 ? -6 : 1 - dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
};
const shiftYm = (ym: string, delta: number): string => {
  const total = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
};

const remainingOf = (p: ProxyProduct) => p.totalSessions - p.usedSessions;
const isDepleted = (p: ProxyProduct, todayStr: string) =>
  p.type === "session" ? remainingOf(p) <= 0 : !!p.endDate && p.endDate < todayStr;
const productLabel = (p: ProxyProduct) =>
  p.type === "session" ? `${p.name} · 잔여 ${remainingOf(p)}/${p.totalSessions}회` : `${p.name} · ~${p.endDate || "-"}`;

type BookingForm = { customerId: string; productId: string; date: string; hour: string; minute: string; duration: number; weeks: number };

export default function ProxyLessonView() {
  const [ctx, setCtx] = useState<ProxyContext | null>(null);
  const [loadError, setLoadError] = useState("");
  const [day, setDay] = useState(today());
  const [mode, setMode] = useState<"day" | "month">("day");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState<{ msg: string; seq: number } | null>(null);
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingForm | null>(null);
  const [moveForm, setMoveForm] = useState<{ id: string; date: string; hour: string; minute: string; duration: number } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ id: string; text: string } | null>(null);
  const [signResId, setSignResId] = useState<string | null>(null);

  const flash = (msg: string) => setToast((t) => ({ msg, seq: (t?.seq ?? 0) + 1 }));
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const reload = () =>
    loadProxyContext()
      .then((data) => { setCtx(data); setLoadError(""); })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "불러오지 못했어요"));
  useEffect(() => { reload(); }, []);

  // 처리 중 다시 누르는 것을 막고(더블탭), 끝나면 DB 기준으로 화면을 다시 불러온다.
  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    if (working) return false;
    setWorking(true);
    try {
      await fn();
      flash(okMsg);
      await reload();
      return true;
    } catch (e) {
      flash(e instanceof Error ? e.message : "처리 실패, 다시 시도해주세요");
      await reload();
      return false;
    } finally {
      setWorking(false);
    }
  };

  const todayStr = ctx?.today ?? today();
  const activeDelegations = (ctx?.delegations ?? []).filter((d) => d.active);
  const customers = ctx?.customers ?? [];
  const products = ctx?.products ?? [];
  const reservations = ctx?.reservations ?? [];
  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name || "고객";
  const productOf = (id: string | null) => products.find((p) => p.id === id);
  const availableProducts = (customerId: string) => products.filter((p) => p.customerId === customerId && !isDepleted(p, todayStr));
  const remainSummary = (customerId: string) => {
    const usable = availableProducts(customerId).filter((p) => p.type === "session");
    return usable.length ? `잔여 ${usable.reduce((s, p) => s + remainingOf(p), 0)}회` : "잔여 없음";
  };
  // 관리자 화면과 같은 규칙: 잔여가 남은 이용권 중 가장 먼저 등록한 것부터 사용
  const defaultProductId = (customerId: string) => {
    const list = availableProducts(customerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return (list.find((p) => p.type === "session") || list[0])?.id || "";
  };
  const busyOn = (date: string) => (ctx?.busy ?? []).filter((b) => b.date === date).sort((a, b) => a.time.localeCompare(b.time));

  const openBooking = () => {
    const firstCustomer = customers[0]?.id || "";
    setBooking({ customerId: firstCustomer, productId: firstCustomer ? defaultProductId(firstCustomer) : "", date: day < todayStr ? todayStr : day, hour: "18", minute: "00", duration: 50, weeks: 1 });
  };
  const submitBooking = async () => {
    if (!booking) return;
    if (!booking.customerId) { flash("고객을 선택해주세요"); return; }
    if (!booking.productId) { flash("예약할 수 있는 이용권이 없어요. 담당 트레이너에게 문의해주세요"); return; }
    const dates = Array.from({ length: Math.max(1, booking.weeks) }, (_, i) => addDays(booking.date, i * 7));
    const ok = await act(
      () => addProxyReservations(booking.customerId, booking.productId, dates, `${booking.hour}:${booking.minute}`, Number(booking.duration) || 50),
      dates.length > 1 ? `예약 ${dates.length}건 등록됨` : "예약 등록됨",
    );
    if (ok) { setDay(booking.date); setBooking(null); }
  };

  const completeWithSignature = async (blob: Blob, workoutNote: string) => {
    if (!signResId) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("서명 이미지를 읽지 못했어요"));
      reader.readAsDataURL(blob);
    });
    const ok = await act(async () => {
      const result = await proxyCompleteWithSignature(signResId, dataUrl, workoutNote);
      if (!result.ok) throw new Error(result.error);
    }, "완료 처리 · 세션 1회 차감");
    if (ok) setSignResId(null);
  };

  const topBar = (
    <div className="ptm-px-top">
      <div>
        <div className="ptm-px-title">대리 레슨</div>
        {activeDelegations.length > 0 && <div className="ptm-px-sub">{activeDelegations[0].name} 트레이너님</div>}
      </div>
      <form action={logoutProxy}><button className="ptm-icon-btn" type="submit" title="로그아웃"><LogOut size={16} /></button></form>
    </div>
  );

  if (!ctx) {
    return <div className="ptm-root ptm-px-root">{topBar}<div className="ptm-px-empty">{loadError || "불러오는 중..."}</div></div>;
  }

  if (activeDelegations.length === 0) {
    const upcoming = ctx.delegations.filter((d) => !d.revoked && d.startsOn > todayStr);
    return (
      <div className="ptm-root ptm-px-root">
        {topBar}
        <div className="ptm-px-empty">
          <b>지금은 대리 레슨 기간이 아니에요</b>
          <div>{upcoming.length > 0 ? `${upcoming[0].startsOn}부터 이용할 수 있어요.` : "기간이 끝났거나 해제됐어요. 담당 트레이너에게 문의해주세요."}</div>
        </div>
      </div>
    );
  }

  const dayLessons = reservations.filter((r) => r.date === day && r.status !== "cancelled").sort((a, b) => a.time.localeCompare(b.time));
  const dayBusy = busyOn(day);

  const lessonCard = (r: ProxyReservation) => {
    const p = productOf(r.productId);
    return (
      <div key={r.id} className={`ptm-px-card ${r.status}`}>
        <div className="ptm-px-card-head">
          <span className="ptm-px-time">{timeRange(r.time, r.duration)}</span>
          <span className={`ptm-res-badge ${r.status}`}>{statusLabel[r.status]}</span>
        </div>
        <div className="ptm-px-name" onClick={() => setDetailCustomerId(r.customerId)}>{nameOf(r.customerId)}</div>
        <div className="ptm-px-meta">{p ? productLabel(p) : "이용권 없음"}{r.signed ? " · 서명 완료" : ""}</div>
        {r.status === "done" && r.workoutNote && <div className="ptm-px-note">{r.workoutNote}</div>}

        {(r.status === "scheduled" || r.status === "noshow") && (
          <button className="ptm-save-btn ptm-px-primary" disabled={working} onClick={() => setSignResId(r.id)}><Check size={16} /> 완료 · 서명받기</button>
        )}
        {r.status === "done" && (
          <button className="ptm-save-btn ptm-px-primary ptm-px-secondary" disabled={working} onClick={() => setNoteEdit({ id: r.id, text: r.workoutNote || "" })}>운동일지 {r.workoutNote ? "수정" : "작성"}</button>
        )}
        <div className="ptm-px-subactions">
          {r.status === "scheduled" && (
            <>
              <button disabled={working} onClick={() => act(() => setProxyReservationStatus(r.id, "noshow"), "노쇼 처리 · 세션 1회 차감")}>노쇼</button>
              <button disabled={working} onClick={() => { const [hour, minute] = r.time.split(":"); setMoveForm({ id: r.id, date: r.date, hour, minute, duration: r.duration }); }}>시간 변경</button>
              <button disabled={working} className="danger" onClick={() => act(() => setProxyReservationStatus(r.id, "cancelled"), "예약 취소됨")}>예약 취소</button>
            </>
          )}
          {(r.status === "done" || r.status === "noshow") && (
            <button disabled={working} onClick={() => act(() => setProxyReservationStatus(r.id, "scheduled"), "예약됨으로 되돌림")}>예약됨으로 되돌리기</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="ptm-root ptm-px-root">
      {topBar}

      {/* 담당 고객: 누르면 이용권·예약·운동일지 */}
      <div className="ptm-px-customers">
        {customers.map((c) => (
          <button key={c.id} className="ptm-px-chip" onClick={() => setDetailCustomerId(c.id)}>
            <b>{c.name}</b><span>{remainSummary(c.id)}</span>
          </button>
        ))}
      </div>

      <div className="ptm-type-toggle ptm-px-mode">
        <button className={`ptm-type-btn ${mode === "day" ? "active" : ""}`} onClick={() => setMode("day")}>하루</button>
        <button className={`ptm-type-btn ${mode === "month" ? "active" : ""}`} onClick={() => { setMonth(day.slice(0, 7)); setMode("month"); }}>달력</button>
      </div>

      {mode === "month" && (() => {
        const cells = monthGridDates(month);
        return (
          <div className="ptm-px-cal">
            <div className="ptm-px-daybar" style={{ marginBottom: 8 }}>
              <button className="ptm-nav-btn" onClick={() => setMonth(shiftYm(month, -1))}><ChevronLeft size={18} /></button>
              <div className="ptm-px-day">{Number(month.slice(0, 4))}년 {Number(month.slice(5, 7))}월</div>
              <button className="ptm-nav-btn" onClick={() => setMonth(shiftYm(month, 1))}><ChevronRight size={18} /></button>
            </div>
            <div className="ptm-px-cal-grid">
              {["월", "화", "수", "목", "금", "토", "일"].map((w, i) => (
                <div key={w} className={`ptm-px-cal-head${i >= 5 ? " weekend" : ""}`}>{w}</div>
              ))}
              {cells.map((d, i) => {
                const lessons = reservations.filter((r) => r.date === d && r.status !== "cancelled");
                const scheduled = lessons.filter((r) => r.status === "scheduled").length;
                const finished = lessons.length - scheduled;
                const classes = [
                  "ptm-px-cal-cell",
                  d.slice(0, 7) !== month ? "other" : "",
                  d === todayStr ? "today" : "",
                  d === day ? "selected" : "",
                  i % 7 >= 5 ? "weekend" : "",
                ].filter(Boolean).join(" ");
                return (
                  <button key={d} className={classes} onClick={() => { setDay(d); setMode("day"); }}>
                    <span className="ptm-px-cal-num">{Number(d.slice(8, 10))}</span>
                    {scheduled > 0 && <span className="ptm-px-cal-dot scheduled">{scheduled}</span>}
                    {finished > 0 && <span className="ptm-px-cal-dot done">{finished}</span>}
                  </button>
                );
              })}
            </div>
            <div className="ptm-px-cal-legend">
              <span><i className="scheduled" /> 예약</span><span><i className="done" /> 완료·노쇼</span>
              <span>날짜를 누르면 그날 레슨으로 이동해요</span>
            </div>
          </div>
        );
      })()}

      {mode === "day" && (<>
      {/* 날짜 이동 */}
      <div className="ptm-px-daybar">
        <button className="ptm-nav-btn" onClick={() => setDay(addDays(day, -1))}><ChevronLeft size={18} /></button>
        <div className="ptm-px-day">
          <div>{dayTitle(day)}</div>
          {day !== todayStr ? <button className="ptm-px-today" onClick={() => setDay(todayStr)}>오늘로</button> : <span className="ptm-px-today-label">오늘</span>}
        </div>
        <button className="ptm-nav-btn" onClick={() => setDay(addDays(day, 1))}><ChevronRight size={18} /></button>
      </div>

      {dayLessons.length === 0 && <div className="ptm-px-empty">이 날 담당 고객 레슨이 없어요</div>}
      {dayLessons.map(lessonCard)}

      {dayBusy.length > 0 && (
        <div className="ptm-px-busy">
          <div className="ptm-px-busy-title">다른 예약이 있는 시간</div>
          {dayBusy.map((b, i) => <span key={i} className="ptm-px-busy-chip">{timeRange(b.time, b.duration)}</span>)}
        </div>
      )}
      </>)}

      <div className="ptm-px-bottom">
        <button className="ptm-save-btn" onClick={openBooking}><Plus size={17} /> 예약 추가</button>
      </div>

      {/* 고객 상세: 이용권 잔여, 다가오는 예약, 운동일지 */}
      {detailCustomerId && (() => {
        const custRes = reservations.filter((r) => r.customerId === detailCustomerId);
        const upcoming = custRes.filter((r) => r.status === "scheduled" && r.date >= todayStr).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        const logs = custRes.filter((r) => (r.workoutNote || "").trim()).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
        const cust = customers.find((c) => c.id === detailCustomerId);
        return (
          <div className="ptm-overlay" onClick={() => setDetailCustomerId(null)}>
            <div className="ptm-sheet ptm-px-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="ptm-sheet-head">
                <span className="ptm-sheet-title">{cust?.name}{cust?.phoneMasked ? ` · ${cust.phoneMasked}` : ""}</span>
                <button className="ptm-icon-btn" onClick={() => setDetailCustomerId(null)}><X size={16} /></button>
              </div>
              <div className="ptm-px-section">이용권</div>
              {products.filter((p) => p.customerId === detailCustomerId).map((p) => (
                <div key={p.id} className="ptm-px-line">{productLabel(p)}{isDepleted(p, todayStr) ? " (사용완료)" : ""}</div>
              ))}
              <div className="ptm-px-section">다가오는 예약</div>
              {upcoming.length === 0 && <div className="ptm-px-line">없음</div>}
              {upcoming.slice(0, 10).map((r) => (
                <div key={r.id} className="ptm-px-line ptm-px-link" onClick={() => { setDay(r.date); setDetailCustomerId(null); }}>{shortDate(r.date)} {r.time}</div>
              ))}
              <div className="ptm-px-section">운동일지</div>
              {logs.length === 0 && <div className="ptm-px-line">작성된 운동일지가 없어요</div>}
              {logs.map((r) => (
                <div key={r.id} className="ptm-px-log">
                  <div className="ptm-px-meta">{shortDate(r.date)} {r.time}{r.delegateName ? ` · 대리 ${r.delegateName}` : ""}</div>
                  <div className="ptm-px-note" style={{ marginTop: 2 }}>{r.workoutNote}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {booking && (
        <div className="ptm-overlay" onClick={() => !working && setBooking(null)}>
          <div className="ptm-sheet ptm-px-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">예약 추가</span>
              <button className="ptm-icon-btn" onClick={() => setBooking(null)}><X size={16} /></button>
            </div>
            {customers.length > 1 && (
              <div className="ptm-field"><label>고객</label>
                <select value={booking.customerId} onChange={(e) => setBooking({ ...booking, customerId: e.target.value, productId: defaultProductId(e.target.value) })}>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {customers.length === 1 && <div className="ptm-px-meta" style={{ marginBottom: 8 }}>고객: <b>{customers[0].name}</b></div>}
            <div className="ptm-field"><label>이용권</label>
              <select value={booking.productId} onChange={(e) => setBooking({ ...booking, productId: e.target.value })}>
                {availableProducts(booking.customerId).length === 0 && <option value="">예약 가능한 이용권 없음</option>}
                {availableProducts(booking.customerId).map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
              </select>
            </div>
            <div className="ptm-field"><label>날짜</label>
              <input type="date" value={booking.date} onChange={(e) => setBooking({ ...booking, date: e.target.value })} />
            </div>
            {busyOn(booking.date).length > 0 && (
              <div className="ptm-px-busy" style={{ marginTop: -4, marginBottom: 10 }}>
                <div className="ptm-px-busy-title">이 날 다른 예약 시간</div>
                {busyOn(booking.date).map((b, i) => <span key={i} className="ptm-px-busy-chip">{timeRange(b.time, b.duration)}</span>)}
              </div>
            )}
            <div className="ptm-row2">
              <div className="ptm-field"><label>시</label>
                <select value={booking.hour} onChange={(e) => setBooking({ ...booking, hour: e.target.value })}>{hourOptions.map((h) => <option key={h} value={h}>{h}시</option>)}</select>
              </div>
              <div className="ptm-field"><label>분</label>
                <select value={booking.minute} onChange={(e) => setBooking({ ...booking, minute: e.target.value })}>{minuteOptions.map((m) => <option key={m} value={m}>{m}분</option>)}</select>
              </div>
            </div>
            <div className="ptm-row2">
              <div className="ptm-field"><label>레슨 시간</label>
                <select value={booking.duration} onChange={(e) => setBooking({ ...booking, duration: Number(e.target.value) })}>
                  {[30, 40, 50, 60, 90].map((m) => <option key={m} value={m}>{m}분</option>)}
                </select>
              </div>
              <div className="ptm-field"><label>매주 반복</label>
                <select value={booking.weeks} onChange={(e) => setBooking({ ...booking, weeks: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n === 1 ? "안 함" : `${n}주`}</option>)}
                </select>
              </div>
            </div>
            <button className="ptm-save-btn" disabled={working} onClick={submitBooking}>{working ? "저장 중..." : "예약하기"}</button>
          </div>
        </div>
      )}

      {moveForm && (
        <div className="ptm-overlay" onClick={() => !working && setMoveForm(null)}>
          <div className="ptm-sheet ptm-px-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">시간 변경</span>
              <button className="ptm-icon-btn" onClick={() => setMoveForm(null)}><X size={16} /></button>
            </div>
            <div className="ptm-field"><label>날짜</label>
              <input type="date" value={moveForm.date} onChange={(e) => setMoveForm({ ...moveForm, date: e.target.value })} />
            </div>
            <div className="ptm-row2">
              <div className="ptm-field"><label>시</label>
                <select value={moveForm.hour} onChange={(e) => setMoveForm({ ...moveForm, hour: e.target.value })}>{hourOptions.map((h) => <option key={h} value={h}>{h}시</option>)}</select>
              </div>
              <div className="ptm-field"><label>분</label>
                <select value={moveForm.minute} onChange={(e) => setMoveForm({ ...moveForm, minute: e.target.value })}>{minuteOptions.map((m) => <option key={m} value={m}>{m}분</option>)}</select>
              </div>
            </div>
            <button className="ptm-save-btn" disabled={working} onClick={async () => {
              const ok = await act(() => moveProxyReservation(moveForm.id, moveForm.date, `${moveForm.hour}:${moveForm.minute}`, Number(moveForm.duration) || 50), "예약 시간이 변경됨");
              if (ok) { setDay(moveForm.date); setMoveForm(null); }
            }}>{working ? "저장 중..." : "변경하기"}</button>
          </div>
        </div>
      )}

      {noteEdit && (
        <div className="ptm-overlay" onClick={() => !working && setNoteEdit(null)}>
          <div className="ptm-sheet ptm-px-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">운동일지</span>
              <button className="ptm-icon-btn" onClick={() => setNoteEdit(null)}><X size={16} /></button>
            </div>
            <textarea className="ptm-px-textarea" rows={6} value={noteEdit.text} onChange={(e) => setNoteEdit({ ...noteEdit, text: e.target.value })} placeholder="오늘 진행한 운동 내용을 적어주세요" autoFocus />
            <button className="ptm-save-btn" disabled={working} onClick={async () => {
              const ok = await act(() => saveProxyWorkoutNote(noteEdit.id, noteEdit.text), "운동일지가 저장됨");
              if (ok) setNoteEdit(null);
            }}>{working ? "저장 중..." : "저장"}</button>
          </div>
        </div>
      )}

      {signResId && (
        <SignatureModal
          title={`${nameOf(reservations.find((r) => r.id === signResId)?.customerId || "")} · 출석 서명`}
          onCancel={() => setSignResId(null)}
          onSubmit={completeWithSignature}
        />
      )}

      {toast && <div className="ptm-toast">{toast.msg}</div>}
    </div>
  );
}
