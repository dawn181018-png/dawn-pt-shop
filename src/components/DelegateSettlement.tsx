// "대리 레슨" 탭 > "월 정산"(관리자 전용): 대리 트레이너가 한 달 동안 진행한 레슨의 횟수·날짜를 보고, 회당 금액 또는
// 비율로 지급액을 계산해 확정·지급 기록을 남긴다. 계산은 lib/delegateSettlement 한 곳에서 하고, 이 화면은 보여주고 저장만 한다.
// 예약·서명·세션 차감·결제 데이터는 읽기만 한다. 기존 페이롤(급여) 계산과는 별개다(같은 레슨이 페이롤에도 들어 있다는 안내만 한다).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, Printer, ImageDown, X, CheckCircle2, AlertTriangle } from "lucide-react";
import * as db from "@/lib/db";
import { today } from "@/lib/formatUtils";
import { printElement, saveElementPng } from "@/lib/exportUtils";
import {
  buildSettlement, defaultSettlementSettings, delegateTrainers, firstDelegationDay, maskName, settlementChanges, settlementState, toWon,
  type DelegateSettlementRecord, type SettlementLesson, type SettlementSettings, type SettlementSnapshot, type StatusLogActor,
} from "@/lib/delegateSettlement";
import type { Customer, LessonDelegation, Product, Reservation } from "@/lib/types";

const weekdayShort = ["일", "월", "화", "수", "목", "금", "토"];
const statusText: Record<string, string> = { done: "완료", noshow: "노쇼", cancelled: "취소", scheduled: "예약됨" };
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdayShort[d.getDay()]})`;
};
const shiftMonth = (month: string, delta: number) => {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1 + delta;
  const ny = y + Math.floor(m / 12), nm = ((m % 12) + 12) % 12 + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
};
const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
const parseInt0 = (v: string) => { const n = Number(v.replace(/[^0-9-]/g, "")); return Number.isFinite(n) ? Math.trunc(n) : 0; };

// 날짜별로 묶기(하루에 몇 회인지 바로 보이게)
function groupByDay(lessons: SettlementLesson[]) {
  const groups: { date: string; lessons: SettlementLesson[] }[] = [];
  lessons.forEach((l) => {
    const g = groups[groups.length - 1];
    if (g && g.date === l.date) g.lessons.push(l); else groups.push({ date: l.date, lessons: [l] });
  });
  return groups;
}
const dayCountText = (ls: SettlementLesson[]) => {
  const done = ls.filter((l) => l.status === "done").length;
  const noshow = ls.filter((l) => l.status === "noshow").length;
  const cancelled = ls.filter((l) => l.status === "cancelled").length;
  return [done && `완료 ${done}회`, noshow && `노쇼 ${noshow}회`, cancelled && `취소 ${cancelled}회`].filter(Boolean).join(" · ");
};

export default function DelegateSettlement({
  delegations, reservations, products, customers, transferRecipientIds, statusLogs, flash,
}: {
  delegations: LessonDelegation[];
  reservations: Reservation[];
  products: Product[]; // 보관된 이용권 포함
  customers: Customer[]; // 보관된 고객 포함
  transferRecipientIds: Set<string>;
  statusLogs?: Map<string, StatusLogActor>; // 레슨 처리자 기록(있으면 관리자/대리 구분에 가장 먼저 쓴다)
  flash: (msg: string, ms?: number) => void;
}) {
  const trainers = useMemo(() => delegateTrainers(delegations), [delegations]);
  const firstDay = useMemo(() => firstDelegationDay(delegations), [delegations]);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [email, setEmail] = useState<string>(""); // 비어 있으면 첫 번째 트레이너
  const trainer = trainers.find((t) => t.email === email) || trainers[0] || null;

  // 정산 기록(추가만). null = 표가 아직 없음(SQL 실행 전) → 계산만 보여주고 확정 버튼은 숨긴다.
  const [records, setRecords] = useState<DelegateSettlementRecord[] | null>(null);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  useEffect(() => {
    db.listDelegateSettlements().then(setRecords).catch(() => setRecords(null)).finally(() => setRecordsLoaded(true));
  }, []);

  // 금액 입력값은 달·트레이너별로 따로 기억한다(화면을 벗어나면 사라지는 작업용 값, 확정하면 기록에 저장된다).
  const key = trainer ? `${month}|${trainer.email}` : "";
  const [settingsByKey, setSettingsByKey] = useState<Record<string, SettlementSettings>>({});
  // 다른 달로 넘어가도 같은 트레이너의 지급 방식·금액은 이어서 쓴다(새 달의 체크·조정은 비운 채로 시작).
  const [lastByTrainer, setLastByTrainer] = useState<Record<string, Pick<SettlementSettings, "mode" | "perLesson" | "ratePct">>>({});
  const draft: SettlementSettings = useMemo(
    () => settingsByKey[key] || { ...defaultSettlementSettings, ...(trainer ? lastByTrainer[trainer.email] : {}) },
    [settingsByKey, key, trainer, lastByTrainer],
  );
  const setDraft = (patch: Partial<SettlementSettings>) => {
    if (!trainer) return;
    const next = { ...draft, ...patch };
    setLastByTrainer((cur) => ({ ...cur, [trainer.email]: { mode: next.mode, perLesson: next.perLesson, ratePct: next.ratePct } }));
    setSettingsByKey((cur) => ({ ...cur, [key]: next }));
  };

  const customerName = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? map.get(id) || "(삭제된 고객)" : "-");
  }, [customers]);

  const state = useMemo(() => {
    if (!trainer || !records) return { confirmed: null, paid: null, history: [] as DelegateSettlementRecord[] };
    return settlementState(records.filter((r) => r.month === month && r.delegateEmail === trainer.email));
  }, [records, month, trainer]);
  const confirmedSnap: SettlementSnapshot | null = state.confirmed?.snapshot || null;

  // 지금 데이터로 계산한 결과(확정돼 있으면 확정 때 입력값으로 다시 계산해 바뀐 레슨이 있는지만 본다)
  const live = useMemo(() => {
    if (!trainer) return null;
    return buildSettlement({
      reservations, delegationIds: trainer.delegationIds, month, products, customerNameOf: customerName,
      transferRecipientIds, firstDay, settings: confirmedSnap ? confirmedSnap.settings : draft, statusLogs, trainerEmail: trainer.email,
    });
  }, [trainer, reservations, month, products, customerName, transferRecipientIds, firstDay, confirmedSnap, draft, statusLogs]);
  const changes = useMemo(() => (confirmedSnap && live ? settlementChanges(confirmedSnap.lessons, live.lessons) : []), [confirmedSnap, live]);

  // 화면에 보여줄 숫자: 확정됐으면 확정 기록(고정), 아니면 지금 계산
  const view = confirmedSnap
    ? { lessons: confirmedSnap.lessons, counts: confirmedSnap.counts, lessonAmount: confirmedSnap.lessonAmount, adjustTotal: confirmedSnap.adjustTotal, total: confirmedSnap.total, settings: confirmedSnap.settings }
    : live ? { ...live, settings: draft } : null;
  const missingAmount = !confirmedSnap && !!live && draft.mode === "rate" && live.lessons.some((l) => l.eligible && l.unitPrice === null && !(l.id in draft.manualAmounts));

  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: "confirm" } | { kind: "unconfirm"; memo: string } | { kind: "paid"; date: string; memo: string } | { kind: "unpaid"; memo: string }>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [maskNames, setMaskNames] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // 화면이 "저장 중"으로 바뀌기 전의 연속 클릭까지 막도록 ref로도 잠근다(기록이 두 번 쌓이지 않게).
  const savingRef = useRef(false);
  const addRecord = async (data: Parameters<typeof db.insertDelegateSettlement>[0], done: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const row = await db.insertDelegateSettlement(data);
      setRecords((cur) => [...(cur || []), row]);
      setDialog(null);
      flash(done, 2500);
    } catch (e) {
      flash(`저장 실패: ${e instanceof Error ? e.message : "다시 시도해주세요"}`, 4000);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const doConfirm = () => {
    if (!trainer || !live) return;
    const snapshot: SettlementSnapshot = {
      version: 1, month, delegateName: trainer.name, delegateEmail: trainer.email, settings: draft,
      lessons: live.lessons, counts: live.counts, lessonAmount: live.lessonAmount, adjustTotal: live.adjustTotal, total: live.total, fingerprint: live.fingerprint,
    };
    addRecord({ month, delegateEmail: trainer.email, delegateName: trainer.name, action: "confirm", lessonCount: live.counts.eligible, totalAmount: live.total, snapshot },
      `${monthLabel(month)} ${trainer.name} 정산 확정됨 · ${won(live.total)}`);
  };

  const exportPng = async () => {
    if (!sheetRef.current || !trainer) return;
    try { await saveElementPng(sheetRef.current, `대리정산_${trainer.name}_${month}`); }
    catch { flash("이미지 저장에 실패했어요. 인쇄 → PDF로 저장을 이용해주세요", 4000); }
  };
  const exportPrint = async () => {
    if (!sheetRef.current || !trainer) return;
    try { await printElement(sheetRef.current, `대리 레슨 정산 ${trainer.name} ${monthLabel(month)}`); }
    catch { flash("인쇄 창을 열지 못했어요", 3000); }
  };

  if (trainers.length === 0) {
    return <div className="ptm-table-empty">대리 레슨 지정이 아직 없어요. &ldquo;지정 관리&rdquo;에서 먼저 대리 트레이너를 지정해주세요.</div>;
  }
  if (!trainer || !view || !live) return null;
  const editable = !confirmedSnap;
  const s = view.settings;
  const groups = groupByDay(view.lessons);

  return (
    <div className="ptm-ds">
      <div className="ptm-toolbar ptm-ds-toolbar">
        <div className="ptm-week-nav">
          <button className="ptm-nav-btn" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
          <button className="ptm-nav-today" onClick={() => setMonth(today().slice(0, 7))}>이번 달</button>
          <button className="ptm-nav-btn" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
          <span className="ptm-week-range">{monthLabel(month)}</span>
        </div>
        <select className="ptm-sort" value={trainer.email} onChange={(e) => setEmail(e.target.value)}>
          {trainers.map((t) => <option key={t.email} value={t.email}>{t.name} ({t.email})</option>)}
        </select>
      </div>
      <div className="ptm-acct-note">
        {monthLabel(month)} 1일~말일(한국 날짜) 동안 {trainer.name} 트레이너에게 맡긴 레슨이에요. 이 정산은 기존 페이롤(급여)과 별개라,
        같은 레슨이 페이롤의 레슨 매출·커미션에도 그대로 들어 있어요.
      </div>

      {confirmedSnap && (
        <div className="ptm-acct-warn ptm-ds-status">
          <CheckCircle2 size={15} /> {new Date(state.confirmed!.createdAt).toLocaleString("ko-KR")} 정산 확정 · 정산 대상 {view.counts.eligible}회 · 합계 <b>{won(view.total)}</b>
          {state.paid ? <> · <b>지급 완료</b> {state.paid.paidOn || ""}{state.paid.memo ? ` (${state.paid.memo})` : ""}</> : " · 미지급"}
        </div>
      )}
      {confirmedSnap && changes.length > 0 && (
        <div className="ptm-acct-warn danger">
          <AlertTriangle size={14} /> 확정 이후 변경된 레슨이 있습니다. 확정된 숫자는 그대로예요 — 다시 계산하려면 확정을 해제한 뒤 다시 확정해주세요.
          <ul className="ptm-ds-changes">{changes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}

      <div className="ptm-pay-grid ptm-ds-cards">
        <div className="ptm-pay-card"><div className="ptm-pay-card-label">완료 (대리 진행)</div><div className="ptm-pay-card-num">{view.counts.done}회</div></div>
        <div className="ptm-pay-card"><div className="ptm-pay-card-label">노쇼</div><div className="ptm-pay-card-num">{view.counts.noshow}회</div><div className="ptm-prod-count">{s.includeNoshow ? "지급 대상에 포함" : "지급 대상 아님"}</div></div>
        <div className="ptm-pay-card"><div className="ptm-pay-card-label">취소</div><div className="ptm-pay-card-num">{view.counts.cancelled}회</div><div className="ptm-prod-count">지급 대상 아님</div></div>
        <div className="ptm-pay-card"><div className="ptm-pay-card-label">확인 필요</div><div className="ptm-pay-card-num" style={view.counts.check > 0 ? { color: "var(--coral)" } : {}}>{view.counts.check}회</div><div className="ptm-prod-count">체크한 것만 포함</div></div>
        <div className="ptm-pay-card ptm-ds-card-main"><div className="ptm-pay-card-label">정산 대상</div><div className="ptm-pay-card-num">{view.counts.eligible}회</div><div className="ptm-prod-count">{won(view.total)}</div></div>
      </div>

      <div className="ptm-ds-settings">
        <div className="ptm-field"><label>지급 방식</label>
          <div className="ptm-type-toggle">
            <button className={`ptm-type-btn ${s.mode === "fixed" ? "active" : ""}`} disabled={!editable} onClick={() => setDraft({ mode: "fixed" })}>회당 수업료</button>
            <button className={`ptm-type-btn ${s.mode === "rate" ? "active" : ""}`} disabled={!editable} onClick={() => setDraft({ mode: "rate" })}>비율(%)</button>
          </div>
        </div>
        {s.mode === "fixed" ? (
          <div className="ptm-field"><label>회당 수업료 (원)</label>
            <input type="text" inputMode="numeric" disabled={!editable} value={s.perLesson ? s.perLesson.toLocaleString() : ""} placeholder="0"
              onChange={(e) => setDraft({ perLesson: Math.max(0, parseInt0(e.target.value)) })} />
          </div>
        ) : (
          <div className="ptm-field"><label>비율 (%) — 회당 기준 단가(이용권 판매가 ÷ 총 횟수) × 비율</label>
            <input type="text" inputMode="decimal" disabled={!editable} value={s.ratePct || ""} placeholder="0"
              onChange={(e) => { const v = Number(e.target.value.replace(/[^0-9.]/g, "")); setDraft({ ratePct: Number.isFinite(v) ? Math.min(100, v) : 0 }); }} />
          </div>
        )}
        <label className="ptm-acct-check ptm-ds-switch">
          <input type="checkbox" disabled={!editable} checked={s.includeNoshow} onChange={(e) => setDraft({ includeNoshow: e.target.checked })} /> 노쇼도 지급 대상에 넣기
        </label>
      </div>

      <div className="ptm-ds-days">
        {groups.length === 0 && <div className="ptm-table-empty">이 달에 {trainer.name} 트레이너에게 맡긴 레슨(완료·노쇼·취소)이 없어요</div>}
        {groups.map((g) => (
          <div key={g.date} className="ptm-ds-day">
            <div className="ptm-ds-day-head"><b>{dayLabel(g.date)}</b><span>{dayCountText(g.lessons)}</span></div>
            {g.lessons.map((l) => (
              <div key={l.id} className={`ptm-ds-row${l.status !== "done" ? ` ${l.status}` : ""}${l.handler === "check" ? " check" : l.handler === "owner" ? " owner" : ""}${l.eligible ? " eligible" : ""}`}>
                <span className="ptm-ds-time">{l.time}</span>
                <span className="ptm-ds-name">{l.customerName}</span>
                <span className={`ptm-badge ptm-ds-st-${l.status}`}>{statusText[l.status]}</span>
                <span className="ptm-ds-prod">{l.productName} · {l.duration}분</span>
                <span className="ptm-ds-amount">{l.eligible ? <><b>{won(l.amount)}</b><small>{l.basis}</small></> : <small>{l.handler === "owner" ? "관리자 처리 · 지급 대상 아님" : "지급 대상 아님"}</small>}</span>
                {l.handler === "owner" && <span className="ptm-ds-ownernote">처리자 기록: 관리자가 처리했어요 (대리 트레이너는 예약만)</span>}
                {l.handler === "check" && (
                  <label className="ptm-ds-check" title={l.handlerNote || ""}>
                    <input type="checkbox" disabled={!editable} checked={l.eligible}
                      onChange={(e) => setDraft({ includedCheckIds: e.target.checked ? [...s.includedCheckIds, l.id] : s.includedCheckIds.filter((x) => x !== l.id) })} />
                    확인 필요 · {l.handlerNote}
                  </label>
                )}
                {s.mode === "rate" && l.eligible && l.unitIssue && (
                  <span className="ptm-ds-issue">{l.unitIssue}
                    {editable && (
                      <input type="text" inputMode="numeric" placeholder="금액 직접 입력" value={l.id in s.manualAmounts ? s.manualAmounts[l.id].toLocaleString() : ""}
                        onChange={(e) => {
                          const next = { ...s.manualAmounts };
                          if (e.target.value.trim() === "") delete next[l.id]; else next[l.id] = Math.max(0, parseInt0(e.target.value));
                          setDraft({ manualAmounts: next });
                        }} />
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="ptm-ds-adjust">
        <div className="ptm-ds-adjust-head"><b>조정 금액</b>
          {editable && <button className="ptm-res-btn" onClick={() => setDraft({ adjustments: [...s.adjustments, { amount: 0, memo: "" }] })}><Plus size={12} /> 추가</button>}
        </div>
        {s.adjustments.length === 0 && <div className="ptm-acct-note">교통비·보너스처럼 더하거나 뺄 금액이 있으면 추가하세요 (빼는 금액은 앞에 −).</div>}
        {s.adjustments.map((a, i) => (
          <div key={i} className="ptm-ds-adjust-row">
            <input type="text" inputMode="numeric" disabled={!editable} value={a.amount ? a.amount.toLocaleString() : ""} placeholder="+10,000 또는 -5,000"
              onChange={(e) => setDraft({ adjustments: s.adjustments.map((x, j) => (j === i ? { ...x, amount: parseInt0(e.target.value) } : x)) })} />
            <input type="text" disabled={!editable} value={a.memo} placeholder="메모 (예: 교통비)"
              onChange={(e) => setDraft({ adjustments: s.adjustments.map((x, j) => (j === i ? { ...x, memo: e.target.value } : x)) })} />
            {editable && <button className="ptm-icon-btn" title="삭제" onClick={() => setDraft({ adjustments: s.adjustments.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>}
          </div>
        ))}
      </div>

      <div className="ptm-ds-total">
        <div><span>정산 대상 금액 ({view.counts.eligible}회)</span><b>{won(view.lessonAmount)}</b></div>
        <div><span>조정</span><b>{view.adjustTotal >= 0 ? "+" : "−"}{won(Math.abs(view.adjustTotal))}</b></div>
        <div className="sum"><span>합계</span><b>{won(view.total)}</b></div>
      </div>
      {missingAmount && <div className="ptm-acct-warn danger">단가가 불명확한 레슨이 있어요. 그 레슨의 금액을 직접 입력해야 확정할 수 있어요.</div>}

      <div className="ptm-ds-actions">
        <button className="ptm-series-btn ghost" onClick={() => setSheetOpen(true)}><Printer size={14} /> 정산서 보기 · 내보내기</button>
        {records !== null && (editable ? (
          <button className="ptm-save-btn" disabled={saving || missingAmount} onClick={() => setDialog({ kind: "confirm" })}>정산 확정</button>
        ) : (
          <>
            {!state.paid
              ? <button className="ptm-save-btn" disabled={saving} onClick={() => setDialog({ kind: "paid", date: today(), memo: "" })}>지급 완료 표시</button>
              : <button className="ptm-series-btn ghost" disabled={saving} onClick={() => setDialog({ kind: "unpaid", memo: "" })}>지급 완료 취소</button>}
            <button className="ptm-series-btn ghost" disabled={saving} onClick={() => setDialog({ kind: "unconfirm", memo: "" })}>확정 해제</button>
          </>
        ))}
      </div>
      {recordsLoaded && records === null && <div className="ptm-acct-note">정산 기록 기능이 아직 설치되지 않아 계산만 볼 수 있어요(SQL 실행 필요).</div>}

      {state.history.length > 0 && (
        <div className="ptm-ds-history">
          <button className="ptm-pay-history-toggle" onClick={() => setShowHistory(!showHistory)}>정산 기록 {state.history.length}건 {showHistory ? "숨기기" : "보기"}</button>
          {showHistory && (
            <ul>
              {state.history.map((r) => (
                <li key={r.id}>
                  {new Date(r.createdAt).toLocaleString("ko-KR")} · {{ confirm: "정산 확정", unconfirm: "확정 해제", paid: "지급 완료", unpaid: "지급 완료 취소" }[r.action]}
                  {r.action === "confirm" && ` · ${r.lessonCount}회 · ${won(r.totalAmount)}`}
                  {r.paidOn && ` · 지급일 ${r.paidOn}`}{r.memo && ` · ${r.memo}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialog && (
        <div className="ptm-overlay" onClick={() => !saving && setDialog(null)}>
          <div className="ptm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">{{ confirm: "정산 확정", unconfirm: "확정 해제", paid: "지급 완료 표시", unpaid: "지급 완료 취소" }[dialog.kind]}</span>
              <button className="ptm-icon-btn" onClick={() => !saving && setDialog(null)}><X size={16} /></button>
            </div>
            <div className="ptm-acct-edit-who">{monthLabel(month)} · {trainer.name}</div>
            {dialog.kind === "confirm" && (
              <>
                <ul className="ptm-acct-diff">
                  <li>정산 대상 {live.counts.eligible}회 (완료 {live.counts.done} · 노쇼 {s.includeNoshow ? `${live.counts.noshow} 포함` : "제외"} · 확인 필요 중 포함 {draft.includedCheckIds.filter((id) => live.lessons.some((l) => l.id === id)).length})</li>
                  <li>레슨 금액 {won(live.lessonAmount)} · 조정 {live.adjustTotal >= 0 ? "+" : "−"}{won(Math.abs(live.adjustTotal))}</li>
                  <li><b>합계 {won(live.total)}</b></li>
                </ul>
                <div className="ptm-acct-note">확정하면 지금의 레슨 목록과 금액이 그대로 저장돼요. 나중에 예약이 바뀌어도 확정된 숫자는 바뀌지 않아요.</div>
              </>
            )}
            {dialog.kind === "paid" && (
              <div className="ptm-field"><label>지급일</label>
                <input type="date" value={dialog.date} onChange={(e) => e.target.value && setDialog({ ...dialog, date: e.target.value })} />
              </div>
            )}
            {dialog.kind !== "confirm" && (
              <div className="ptm-field"><label>{dialog.kind === "unconfirm" ? "해제 사유 (필수)" : "메모 (선택)"}</label>
                <input value={dialog.memo} onChange={(e) => setDialog({ ...dialog, memo: e.target.value })}
                  placeholder={dialog.kind === "unconfirm" ? "예: 레슨 추가 반영" : dialog.kind === "paid" ? "예: 계좌이체" : ""} />
              </div>
            )}
            {dialog.kind === "unconfirm" && <div className="ptm-acct-note">해제해도 확정 기록은 지워지지 않고 해제 기록이 추가돼요.</div>}
            <div className="ptm-row2">
              <button className="ptm-series-btn ghost" style={{ marginTop: 0 }} disabled={saving} onClick={() => setDialog(null)}>닫기</button>
              <button className="ptm-save-btn" style={{ marginTop: 0 }}
                disabled={saving || (dialog.kind === "unconfirm" && !dialog.memo.trim())}
                onClick={() => {
                  const base = { month, delegateEmail: trainer.email, delegateName: trainer.name };
                  if (dialog.kind === "confirm") doConfirm();
                  else if (dialog.kind === "unconfirm") addRecord({ ...base, action: "unconfirm", memo: dialog.memo }, "정산 확정 해제됨 · 기록이 남았어요");
                  else if (dialog.kind === "paid") addRecord({ ...base, action: "paid", paidOn: dialog.date, memo: dialog.memo }, "지급 완료로 표시됨");
                  else addRecord({ ...base, action: "unpaid", memo: dialog.memo }, "지급 완료 표시 취소됨");
                }}>
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {sheetOpen && (
        <div className="ptm-overlay" onClick={() => setSheetOpen(false)}>
          <div className="ptm-sheet ptm-ds-sheet-wrap" onClick={(e) => e.stopPropagation()}>
            <div className="ptm-sheet-head">
              <span className="ptm-sheet-title">정산서</span>
              <button className="ptm-icon-btn" onClick={() => setSheetOpen(false)}><X size={16} /></button>
            </div>
            <div className="ptm-ds-export-bar">
              <label className="ptm-acct-check"><input type="checkbox" checked={maskNames} onChange={(e) => setMaskNames(e.target.checked)} /> 고객 이름 가리기 (김○○)</label>
              <button className="ptm-res-btn" onClick={exportPrint}><Printer size={13} /> 인쇄 · PDF</button>
              <button className="ptm-res-btn" onClick={exportPng}><ImageDown size={13} /> 이미지(PNG)</button>
            </div>
            <div ref={sheetRef} className="ptm-export-area ptm-ds-sheet">
              <div className="ptm-ds-sheet-title">대리 레슨 정산서</div>
              <div className="ptm-ds-sheet-meta">
                <span>{monthLabel(month)}</span><span>트레이너 {trainer.name}</span>
                <span>{confirmedSnap ? `확정 ${new Date(state.confirmed!.createdAt).toLocaleDateString("ko-KR")}` : "미확정(작성 중)"}</span>
                {state.paid && <span>지급 완료 {state.paid.paidOn || ""}</span>}
              </div>
              <table className="ptm-ds-sheet-table">
                <thead><tr><th>날짜</th><th>시간</th><th>고객</th><th>상태</th><th>이용권</th><th>분</th><th>금액</th></tr></thead>
                <tbody>
                  {groups.map((g) => g.lessons.map((l, i) => (
                    <tr key={l.id} className={l.eligible ? "" : "off"}>
                      <td>{i === 0 ? `${dayLabel(g.date)} · ${g.lessons.filter((x) => x.eligible).length}회` : ""}</td>
                      <td>{l.time}</td>
                      <td>{maskNames ? maskName(l.customerName) : l.customerName}</td>
                      <td>{statusText[l.status]}{l.handler === "check" ? (l.eligible ? " (확인 후 포함)" : " (확인 필요·제외)") : l.handler === "owner" ? " (관리자 처리·제외)" : ""}</td>
                      <td>{l.productName}</td>
                      <td>{l.duration}</td>
                      <td>{l.eligible ? won(l.amount) : "-"}</td>
                    </tr>
                  )))}
                  {groups.length === 0 && <tr><td colSpan={7}>레슨 없음</td></tr>}
                </tbody>
              </table>
              <div className="ptm-ds-sheet-sum">
                <div>완료 {view.counts.done}회 · 노쇼 {view.counts.noshow}회{s.includeNoshow ? "(포함)" : "(제외)"} · 취소 {view.counts.cancelled}회 · <b>정산 대상 {view.counts.eligible}회</b></div>
                <div>지급 방식: {s.mode === "fixed" ? `회당 ${won(toWon(s.perLesson))}` : `회당 기준 단가 × ${s.ratePct}%`}</div>
                <div>레슨 금액 {won(view.lessonAmount)}</div>
                {s.adjustments.map((a, i) => <div key={i}>조정 {a.amount >= 0 ? "+" : "−"}{won(Math.abs(toWon(a.amount)))}{a.memo ? ` (${a.memo})` : ""}</div>)}
                <div className="sum">합계 {won(view.total)}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
