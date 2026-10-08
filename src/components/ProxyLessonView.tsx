// 대리 레슨 전용 화면(/proxy). 대리 트레이너는 지정된 고객의 레슨(예약/완료·서명/노쇼/시간 변경/취소/운동일지)만
// 할 수 있다. 화면에 보이는 데이터는 전부 DB의 proxy_* 함수가 "지정 고객 + 유효 기간"으로 걸러서 내려준 것이고,
// 다른 고객의 예약은 이름 없이 "예약됨"(시간대만)으로 온다. 결제/매출/급여/연락처 전체는 애초에 받지 않는다.
"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X, Check, UserX, Ban, NotebookPen, RotateCcw, Clock, LogOut, Plus } from "lucide-react";
import SignatureModal from "@/components/SignatureModal";
import { today, addDays } from "@/lib/formatUtils";
import {
  loadProxyContext, addProxyReservations, setProxyReservationStatus, moveProxyReservation, saveProxyWorkoutNote,
  type ProxyContext, type ProxyProduct, type ProxyReservation,
} from "@/lib/proxyDb";
import { proxyCompleteWithSignature, logoutProxy } from "@/app/proxy/actions";
import "@/components/ptm.css";

// 관리자 스케줄 화면과 같은 그리드 규격
const HOUR_START = 6, HOUR_END = 23, HOUR_PX = 36;
const timeTopPx = (time: string): number => { const [h, m] = time.split(":").map(Number); return ((h - HOUR_START) * 60 + m) * (HOUR_PX / 60); };
const durHeightPx = (duration: number): number => Math.max(22, duration * (HOUR_PX / 60));
const pxToTime = (offsetY: number): string => {
  let totalMin = HOUR_START * 60 + offsetY / (HOUR_PX / 60);
  totalMin = Math.round(totalMin / 30) * 30;
  totalMin = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - 30, totalMin));
  return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
};
const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
const koDate = (dateStr: string): string => { const d = new Date(dateStr); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
const mondayOf = (dateStr: string): string => { const d = new Date(dateStr); const day = d.getDay(); return addDays(dateStr, day === 0 ? -6 : 1 - day); };
const hourOptions = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => String(HOUR_START + i).padStart(2, "0"));
const minuteOptions = ["00", "10", "20", "30", "40", "50"];
const statusLabel: Record<string, string> = { scheduled: "예약됨", done: "완료", noshow: "노쇼", cancelled: "취소" };

const remainingOf = (p: ProxyProduct) => p.totalSessions - p.usedSessions;
const isDepleted = (p: ProxyProduct, todayStr: string) =>
  p.type === "session" ? remainingOf(p) <= 0 : !!p.endDate && p.endDate < todayStr;
const productLabel = (p: ProxyProduct) =>
  p.type === "session" ? `${p.name} · 잔여 ${remainingOf(p)}/${p.totalSessions}회` : `${p.name} · ~${p.endDate || "-"}`;

type BookingForm = { customerId: string; productId: string; date: string; hour: string; minute: string; duration: number; weeks: number };

export default function ProxyLessonView() {
  const [ctx, setCtx] = useState<ProxyContext | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"schedule" | "customers">("schedule");
  const [weekStart, setWeekStart] = useState(mondayOf(today()));
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState<{ msg: string; seq: number } | null>(null);
  const [selectedResId, setSelectedResId] = useState<string | null>(null);
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
  // 관리자 화면과 같은 규칙: 잔여가 남은 이용권 중 가장 먼저 등록한 것부터 사용
  const defaultProductId = (customerId: string) => {
    const list = availableProducts(customerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return (list.find((p) => p.type === "session") || list[0])?.id || "";
  };

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const selectedRes = reservations.find((r) => r.id === selectedResId) || null;

  const openBooking = (date: string, time: string) => {
    const firstCustomer = customers[0]?.id || "";
    const [hour, minute] = time.split(":");
    setBooking({ customerId: firstCustomer, productId: firstCustomer ? defaultProductId(firstCustomer) : "", date, hour, minute, duration: 50, weeks: 1 });
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
    if (ok) setBooking(null);
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
    if (ok) { setSignResId(null); setSelectedResId(null); }
  };

  if (!ctx) {
    return (
      <div className="ptm-root">
        <div className="ptm-eyebrow">던휘트니스 삼성점</div>
        <h1 className="ptm-title">대리 레슨</h1>
        <div className="ptm-sign-card" style={{ marginTop: 16 }}>{loadError || "불러오는 중..."}</div>
      </div>
    );
  }

  const header = (
    <div className="ptm-proxy-head">
      <div>
        <div className="ptm-eyebrow">던휘트니스 삼성점</div>
        <h1 className="ptm-title">대리 레슨</h1>
        {activeDelegations.length > 0 && (
          <div className="ptm-no-product-msg" style={{ margin: "4px 0 0" }}>
            {activeDelegations[0].name} 트레이너님 · {activeDelegations.map((d) => `${d.startsOn} ~ ${d.endsOn}`).join(", ")}
          </div>
        )}
      </div>
      <form action={logoutProxy}><button className="ptm-res-btn" type="submit"><LogOut size={13} /> 로그아웃</button></form>
    </div>
  );

  if (activeDelegations.length === 0) {
    const upcoming = ctx.delegations.filter((d) => !d.revoked && d.startsOn > todayStr);
    return (
      <div className="ptm-root">
        {header}
        <div className="ptm-sign-card" style={{ marginTop: 16 }}>
          <div className="ptm-sign-title" style={{ fontSize: 17 }}>지금은 대리 레슨 기간이 아니에요</div>
          <div className="ptm-sign-muted">
            {upcoming.length > 0 ? `${upcoming[0].startsOn}부터 이용할 수 있어요.` : "기간이 끝났거나 해제됐어요. 담당 트레이너에게 문의해주세요."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ptm-root">
      {header}

      <div className="ptm-tabs">
        <button className={`ptm-tab ${tab === "schedule" ? "active" : ""}`} onClick={() => setTab("schedule")}>스케줄</button>
        <button className={`ptm-tab ${tab === "customers" ? "active" : ""}`} onClick={() => setTab("customers")}>담당 고객 {customers.length}명</button>
      </div>

      {tab === "schedule" && (
        <>
          <div className="ptm-week-toolbar">
            <div className="ptm-week-nav">
              <button className="ptm-nav-btn" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={16} /></button>
              <button className="ptm-nav-today" onClick={() => setWeekStart(mondayOf(today()))}>오늘</button>
              <button className="ptm-nav-btn" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={16} /></button>
              <span className="ptm-week-range">{koDate(weekDates[0])} - {koDate(weekDates[6])}</span>
            </div>
            <button className="ptm-quick-add" onClick={() => openBooking(todayStr, "18:00")}><Plus size={16} /> 새 예약</button>
          </div>
          <div className="ptm-no-product-msg" style={{ marginTop: -4 }}>
            회색 &lsquo;예약됨&rsquo;은 다른 예약이 있는 시간이에요. 빈 칸을 누르면 담당 고객 예약을 만들 수 있어요.
          </div>
          <div className="ptm-week-grid-wrap">
            <div style={{ width: "100%" }}>
              <div className="ptm-week-headrow">
                <div className="ptm-week-headtime" />
                {weekDates.map((d, i) => (
                  <div key={d} className={`ptm-week-headcell ${d === todayStr ? "today" : ""}`}>{dayLabels[i]} {koDate(d)}</div>
                ))}
              </div>
              <div className="ptm-week-body" style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}>
                <div className="ptm-week-timecol" style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}>
                  {Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i).map((h) => (
                    <div key={h} className="ptm-hour-label" style={{ top: (h - HOUR_START) * HOUR_PX }}>{h}시</div>
                  ))}
                </div>
                {weekDates.map((d) => (
                  <div
                    key={d}
                    className="ptm-week-daycol ptm-day-bg"
                    style={{ height: (HOUR_END - HOUR_START) * HOUR_PX }}
                    onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); openBooking(d, pxToTime(e.clientY - rect.top)); }}
                  >
                    {ctx.busy.filter((b) => b.date === d).map((b, i) => (
                      <div key={`busy-${i}`} className="ptm-block ptm-proxy-busy" style={{ top: timeTopPx(b.time), height: durHeightPx(b.duration), left: 2, right: 2 }} onClick={(e) => e.stopPropagation()}>
                        <div className="ptm-block-name">예약됨</div>
                      </div>
                    ))}
                    {reservations.filter((r) => r.date === d && r.status !== "cancelled").map((r) => (
                      <div
                        key={r.id}
                        className={`ptm-block ${r.status}`}
                        style={{ top: timeTopPx(r.time), height: durHeightPx(r.duration), left: 2, right: 2, cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); setSelectedResId(r.id); }}
                      >
                        <div className="ptm-block-time">{r.time}</div>
                        <div className="ptm-block-name">{nameOf(r.customerId)}</div>
                        <div className="ptm-block-sub">{statusLabel[r.status]}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "customers" && (
        <div className="ptm-prod-list" style={{ marginTop: 0 }}>
          {customers.map((c) => {
            const next = reservations.filter((r) => r.customerId === c.id && r.status === "scheduled" && r.date >= todayStr)[0];
            return (
              <div className="ptm-prod-row" key={c.id} style={{ cursor: "pointer" }} onClick={() => setDetailCustomerId(c.id)}>
                <div className="ptm-prod-top">
                  <span className="ptm-prod-name">{c.name}</span>
                  <span className="ptm-pending-sale-sub">{c.phoneMasked || "연락처 없음"}</span>
                </div>
                <div className="ptm-pending-sale-sub">
                  {products.filter((p) => p.customerId === c.id && !isDepleted(p, todayStr)).map(productLabel).join(" / ") || "사용 가능한 이용권 없음"}
                </div>
                <div className="ptm-pending-sale-sub">다음 예약: {next ? `${koDate(next.date)} ${next.time}` : "없음"}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* 고객 상세: 이용권 잔여, 예약 내역, 운동일지 */}
      {detailCustomerId && (() => {
        const custRes = reservations.filter((r) => r.customerId === detailCustomerId).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
        const logs = custRes.filter((r) => (r.workoutNote || "").trim());
        return (
          <div className="ptm-overlay" onClick={() => setDetailCustomerId(null)}>
            <div className="ptm-sheet" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
              <div className="ptm-sheet-head">
                <span className="ptm-sheet-title">{nameOf(detailCustomerId)}</span>
                <button className="ptm-icon-btn" onClick={() => setDetailCustomerId(null)}><X size={16} /></button>
              </div>
              <div className="ptm-detail-section-title">이용권</div>
              {products.filter((p) => p.customerId === detailCustomerId).map((p) => (
                <div key={p.id} className="ptm-pending-sale-sub">{productLabel(p)}{isDepleted(p, todayStr) ? " (사용완료)" : ""}</div>
              ))}
              <div className="ptm-detail-section-title" style={{ marginTop: 12 }}>예약 내역</div>
              {custRes.length === 0 && <div className="ptm-pending-sale-sub">예약이 없어요</div>}
              {custRes.slice(0, 30).map((r) => (
                <div key={r.id} className="ptm-res-item" style={{ cursor: "pointer" }} onClick={() => setSelectedResId(r.id)}>
                  <div className="ptm-res-item-top">
                    <span className="ptm-res-date">{koDate(r.date)} {r.time}</span>
                    <span className={`ptm-res-badge ${r.status}`}>{statusLabel[r.status]}</span>
                  </div>
                </div>
              ))}
              <div className="ptm-detail-section-title" style={{ marginTop: 12 }}>운동일지</div>
              {logs.length === 0 && <div className="ptm-pending-sale-sub">작성된 운동일지가 없어요</div>}
              {logs.map((r) => (
                <div key={r.id} className="ptm-prod-row">
                  <div className="ptm-pending-sale-sub"><b>{koDate(r.date)} {r.time}</b>{r.delegateName ? ` · 대리 ${r.delegateName}` : ""}</div>
                  <div className="ptm-res-memo" style={{ whiteSpace: "pre-wrap" }}>{r.workoutNote}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 예약 하나에 대한 처리 */}
      {selectedRes && (() => {
        const r: ProxyReservation = selectedRes;
        const p = productOf(r.productId);
        return (
          <div className="ptm-overlay" onClick={() => setSelectedResId(null)}>
            <div className="ptm-sheet" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
              <div className="ptm-sheet-head">
                <span className="ptm-sheet-title">{nameOf(r.customerId)} · {koDate(r.date)} {r.time}</span>
                <button className="ptm-icon-btn" onClick={() => setSelectedResId(null)}><X size={16} /></button>
              </div>
              <div className="ptm-pending-sale-sub">상태: {statusLabel[r.status]}{r.signed ? " · 서명 완료" : ""}{r.delegateName ? ` · 대리 ${r.delegateName}` : ""}</div>
              <div className="ptm-pending-sale-sub" style={{ marginBottom: 12 }}>{p ? productLabel(p) : "이용권 없음"}</div>
              <div className="ptm-proxy-actions">
                {r.status !== "done" && r.status !== "cancelled" && (
                  <button className="ptm-res-btn" disabled={working} onClick={() => setSignResId(r.id)}><Check size={12} /> 완료(서명)</button>
                )}
                {r.status === "scheduled" && (
                  <>
                    <button className="ptm-res-btn danger" disabled={working} onClick={() => act(() => setProxyReservationStatus(r.id, "noshow"), "노쇼 처리 · 세션 1회 차감")}><UserX size={12} /> 노쇼</button>
                    <button className="ptm-res-btn" disabled={working} onClick={() => { const [hour, minute] = r.time.split(":"); setMoveForm({ id: r.id, date: r.date, hour, minute, duration: r.duration }); }}><Clock size={12} /> 시간 변경</button>
                    <button className="ptm-res-btn danger" disabled={working} onClick={() => act(() => setProxyReservationStatus(r.id, "cancelled"), "예약 취소됨").then((ok) => ok && setSelectedResId(null))}><Ban size={12} /> 취소</button>
                  </>
                )}
                {(r.status === "done" || r.status === "noshow" || r.status === "cancelled") && (
                  <button className="ptm-res-btn" disabled={working} onClick={() => act(() => setProxyReservationStatus(r.id, "scheduled"), "예약됨으로 되돌림")}><RotateCcw size={12} /> 예약됨으로 되돌리기</button>
                )}
                {r.status === "done" && (
                  <button className="ptm-res-btn" disabled={working} onClick={() => setNoteEdit({ id: r.id, text: r.workoutNote || "" })}><NotebookPen size={12} /> 운동일지 {r.workoutNote ? "수정" : "작성"}</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {booking && (
        <div className="ptm-overlay" onClick={() => !working && setBooking(null)}>
          <div className="ptm-sheet" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">새 예약</span>
              <button className="ptm-icon-btn" onClick={() => setBooking(null)}><X size={16} /></button>
            </div>
            <div className="ptm-field"><label>담당 고객</label>
              <select value={booking.customerId} onChange={(e) => setBooking({ ...booking, customerId: e.target.value, productId: defaultProductId(e.target.value) })}>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="ptm-field"><label>이용권</label>
              <select value={booking.productId} onChange={(e) => setBooking({ ...booking, productId: e.target.value })}>
                {availableProducts(booking.customerId).length === 0 && <option value="">예약 가능한 이용권 없음</option>}
                {availableProducts(booking.customerId).map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
              </select>
            </div>
            <div className="ptm-row3">
              <div className="ptm-field"><label>날짜</label>
                <input type="date" value={booking.date} onChange={(e) => setBooking({ ...booking, date: e.target.value })} />
              </div>
              <div className="ptm-field"><label>시</label>
                <select value={booking.hour} onChange={(e) => setBooking({ ...booking, hour: e.target.value })}>{hourOptions.map((h) => <option key={h} value={h}>{h}</option>)}</select>
              </div>
              <div className="ptm-field"><label>분</label>
                <select value={booking.minute} onChange={(e) => setBooking({ ...booking, minute: e.target.value })}>{minuteOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              </div>
            </div>
            <div className="ptm-row2">
              <div className="ptm-field"><label>레슨 시간(분)</label>
                <input type="number" value={booking.duration} onFocus={(e) => e.target.select()} onChange={(e) => setBooking({ ...booking, duration: Number(e.target.value) })} />
              </div>
              <div className="ptm-field"><label>매주 반복 (회)</label>
                <select value={booking.weeks} onChange={(e) => setBooking({ ...booking, weeks: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n === 1 ? "반복 안 함" : `${n}주`}</option>)}
                </select>
              </div>
            </div>
            <button className="ptm-save-btn" disabled={working} onClick={submitBooking}>{working ? "저장 중..." : "예약 등록"}</button>
          </div>
        </div>
      )}

      {moveForm && (
        <div className="ptm-overlay" onClick={() => !working && setMoveForm(null)}>
          <div className="ptm-sheet" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">예약 시간 변경</span>
              <button className="ptm-icon-btn" onClick={() => setMoveForm(null)}><X size={16} /></button>
            </div>
            <div className="ptm-row3">
              <div className="ptm-field"><label>날짜</label>
                <input type="date" value={moveForm.date} onChange={(e) => setMoveForm({ ...moveForm, date: e.target.value })} />
              </div>
              <div className="ptm-field"><label>시</label>
                <select value={moveForm.hour} onChange={(e) => setMoveForm({ ...moveForm, hour: e.target.value })}>{hourOptions.map((h) => <option key={h} value={h}>{h}</option>)}</select>
              </div>
              <div className="ptm-field"><label>분</label>
                <select value={moveForm.minute} onChange={(e) => setMoveForm({ ...moveForm, minute: e.target.value })}>{minuteOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              </div>
            </div>
            <div className="ptm-field"><label>레슨 시간(분)</label>
              <input type="number" value={moveForm.duration} onFocus={(e) => e.target.select()} onChange={(e) => setMoveForm({ ...moveForm, duration: Number(e.target.value) })} />
            </div>
            <button className="ptm-save-btn" disabled={working} onClick={async () => {
              const ok = await act(() => moveProxyReservation(moveForm.id, moveForm.date, `${moveForm.hour}:${moveForm.minute}`, Number(moveForm.duration) || 50), "예약 시간이 변경됨");
              if (ok) setMoveForm(null);
            }}>{working ? "저장 중..." : "변경 저장"}</button>
          </div>
        </div>
      )}

      {noteEdit && (
        <div className="ptm-overlay" onClick={() => !working && setNoteEdit(null)}>
          <div className="ptm-sheet" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">운동일지</span>
              <button className="ptm-icon-btn" onClick={() => setNoteEdit(null)}><X size={16} /></button>
            </div>
            <div className="ptm-field"><label>운동 내용</label>
              <textarea rows={5} value={noteEdit.text} onChange={(e) => setNoteEdit({ ...noteEdit, text: e.target.value })} placeholder="오늘 진행한 운동 내용을 적어주세요" autoFocus />
            </div>
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
