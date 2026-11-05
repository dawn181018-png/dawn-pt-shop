// 대리 레슨 "누가 진행했는지" 판단과 월 정산 계산을 한 곳에 모은 것. 월 정산 화면과 고객 상세 "서명" 탭이 같이 쓴다.
// 조회·계산만 한다 — 예약·서명·세션 차감·결제 데이터는 읽기만 하고 바꾸지 않는다. 페이롤(급여) 계산과는 별개다.
//
// 담당 판단 기준(추측해서 대리로 분류하지 않는다):
// - 대리 트레이너가 자기 화면에서 예약을 잡거나·옮기거나·완료/노쇼/취소하면 예약에 대리 지정(delegationId)·이름이 남는다.
//   관리자가 완료 처리할 때는 이 값을 바꾸지 않으므로, 대리 이름이 있어도 "대리가 예약만 잡고 관리자가 완료"일 수 있다.
// - 대리 화면에서 서명을 받아 완료하면 서명 파일이 "<트레이너 uid>/delegated/" 폴더에 저장된다 → 대리 진행이 확실하다.
// - 그래서 완료 건: 대리 이름 + 대리 폴더 서명 = 대리 진행 / 대리 이름 + 관리자 서명 또는 서명 없음 = 확인 필요.
//   노쇼·취소 건은 서명이 없으므로 대리 이름이 있으면 그 대리 트레이너가 맡은 레슨으로 센다(지급 대상 여부는 따로 고른다).
// - 대리 이름이 없으면: 대리 지정이 처음 시작된 날 이후는 관리자 본인, 그 전은 "담당 구분 없음"(기록 자체가 없던 때).

import type { LessonDelegation, Product, Reservation, ReservationStatus } from "@/lib/types";

export type LessonHandlerKind = "delegate" | "check" | "owner" | "unknown";
export type LessonHandler = { kind: LessonHandlerKind; delegateName: string | null; note: string | null };

type HandlerInput = Pick<Reservation, "delegationId" | "delegateName" | "signatureUrl" | "status" | "date">;

// 레슨 처리자 기록(reservation_status_logs, 2026-11-05~): 상태가 바뀐 순간 로그인해 있던 계정이 관리자인지 대리인지.
// 지금 상태로 바꾼 마지막 기록이 있으면 그걸 가장 먼저 믿는다(서명 위치·대리 이름보다 정확). 없으면 예전 기준으로 판단한다.
export type StatusLogActor = { newStatus: string; actorRole: "owner" | "delegate" | "member" | "system"; actorName: string | null };
export type ReservationStatusLog = StatusLogActor & {
  id: string; reservationId: string; oldStatus: string | null; delegationId: string | null; changedAt: string;
};
// 예약별 "가장 최근" 기록만 모은다.
export function latestStatusLogs(logs: ReservationStatusLog[] | null | undefined): Map<string, StatusLogActor> {
  const map = new Map<string, ReservationStatusLog>();
  (logs || []).forEach((l) => {
    const cur = map.get(l.reservationId);
    if (!cur || l.changedAt >= cur.changedAt) map.set(l.reservationId, l);
  });
  return map;
}

export const isDelegatedSignature = (path?: string | null): boolean => !!path && path.includes("/delegated/");

// 대리 지정이 처음 시작된 날(이 날 전에는 대리 기록 자체가 없었다). 지정이 없으면 null.
export function firstDelegationDay(delegations: Pick<LessonDelegation, "startsOn">[]): string | null {
  return delegations.reduce<string | null>((min, d) => (!min || d.startsOn < min ? d.startsOn : min), null);
}

export function classifyLesson(r: HandlerInput, firstDay: string | null, log?: StatusLogActor | null): LessonHandler {
  const name = (r.delegateName || "").trim() || null;
  if (log && log.newStatus === r.status && (r.status === "done" || r.status === "noshow" || r.status === "cancelled")) {
    if (log.actorRole === "delegate") return { kind: "delegate", delegateName: log.actorName || name, note: null };
    if (log.actorRole === "owner") return { kind: "owner", delegateName: null, note: name ? `대리(${name})가 예약 · 관리자가 처리` : null };
  }
  if (r.delegationId || name) {
    if (r.status !== "done") return { kind: "delegate", delegateName: name, note: null };
    if (isDelegatedSignature(r.signatureUrl)) return { kind: "delegate", delegateName: name, note: null };
    return { kind: "check", delegateName: name, note: r.signatureUrl ? "대리가 예약 · 관리자 계정으로 서명받아 완료" : "대리 기록 있음 · 서명 없이 완료" };
  }
  if (!firstDay || r.date < firstDay) return { kind: "unknown", delegateName: null, note: null };
  return { kind: "owner", delegateName: null, note: null };
}

// ---- 대리 트레이너 목록: 지정이 여러 건이어도 이메일이 같으면 한 사람 ----
export type DelegateTrainer = { email: string; name: string; delegationIds: Set<string> };
export function delegateTrainers(delegations: LessonDelegation[]): DelegateTrainer[] {
  const map = new Map<string, DelegateTrainer & { latest: number }>();
  delegations.forEach((d) => {
    const email = (d.delegateEmail || "").trim().toLowerCase();
    if (!email) return;
    const cur = map.get(email) || { email, name: d.delegateName, delegationIds: new Set<string>(), latest: -1 };
    cur.delegationIds.add(d.id);
    if ((d.createdAt || 0) >= cur.latest) { cur.name = d.delegateName; cur.latest = d.createdAt || 0; }
    map.set(email, cur);
  });
  return [...map.values()].map(({ latest: _latest, ...t }) => t).sort((a, b) => a.name.localeCompare(b.name, "ko")); // eslint-disable-line @typescript-eslint/no-unused-vars
}

// ---- 월 정산 계산 ----
export type SettlementMode = "fixed" | "rate";
export type SettlementAdjustment = { amount: number; memo: string };
export type SettlementSettings = {
  mode: SettlementMode;
  perLesson: number; // 회당 수업료(원)
  ratePct: number; // 비율(%)
  includeNoshow: boolean; // 노쇼도 지급 대상에 넣기(기본 끔)
  includedCheckIds: string[]; // "확인 필요" 완료 건 중 관리자가 지급 대상으로 넣은 예약 id
  manualAmounts: Record<string, number>; // 비율 방식에서 직접 입력한 레슨별 금액(단가가 불명확한 레슨 등)
  adjustments: SettlementAdjustment[]; // 교통비·보너스 등 +/−
};
export const defaultSettlementSettings: SettlementSettings = {
  mode: "fixed", perLesson: 0, ratePct: 0, includeNoshow: false, includedCheckIds: [], manualAmounts: {}, adjustments: [],
};

export type SettlementLesson = {
  id: string;
  date: string;
  time: string;
  duration: number;
  customerName: string;
  status: ReservationStatus;
  productName: string;
  handler: LessonHandlerKind; // delegate | check | owner(대리가 예약만 잡고 관리자가 처리 — 처리자 기록으로 확인된 경우)
  handlerNote: string | null;
  unitPrice: number | null; // 회당 기준 단가(판매가 ÷ 총 횟수, 원 단위 반올림). 불명확하면 null
  unitIssue: string | null; // 단가가 불명확하거나 확인이 필요한 이유
  eligible: boolean; // 정산(지급) 대상인지
  amount: number; // 이 레슨 지급액(원, 대상이 아니면 0)
  basis: string; // 금액 근거(예: "50,000원 × 40% = 20,000원")
};
export type SettlementCounts = { done: number; noshow: number; cancelled: number; check: number; eligible: number };
export type SettlementResult = {
  lessons: SettlementLesson[];
  counts: SettlementCounts;
  lessonAmount: number;
  adjustTotal: number;
  total: number;
  fingerprint: string; // 확정 뒤 변경 감지용(레슨 id·상태·날짜·시간)
};

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
export const toWon = (n: unknown): number => Math.round(Number(n) || 0);

export function monthBounds(month: string): { start: string; end: string } {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 그 달 말일(날짜 문자열 기준이라 시간대 영향 없음)
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

// 회당 기준 단가와 확인이 필요한 이유
export function unitPriceOf(p: Product | undefined, transferRecipientIds: Set<string>): { unit: number | null; issue: string | null } {
  if (!p) return { unit: null, issue: "연결된 이용권 없음" };
  if (p.type !== "session") return { unit: null, issue: "기간권(횟수 없음)" };
  if (transferRecipientIds.has(p.id)) return { unit: null, issue: "양도받은 이용권" };
  if (!(Number(p.totalSessions) > 0) || !(Number(p.price) > 0)) return { unit: null, issue: "단가 0원" };
  const unit = Math.round(Number(p.price) / Number(p.totalSessions));
  if (Number(p.listPrice) > Number(p.price)) return { unit, issue: "할인 판매" };
  return { unit, issue: null };
}

export function buildSettlement(input: {
  reservations: Reservation[];
  delegationIds: Set<string>;
  month: string;
  products: Product[]; // 보관된 이용권 포함
  customerNameOf: (customerId: string | null) => string;
  transferRecipientIds: Set<string>;
  firstDay: string | null;
  settings: SettlementSettings;
  statusLogs?: Map<string, StatusLogActor>; // 처리자 기록(있으면 가장 먼저 믿는다)
}): SettlementResult {
  const { start, end } = monthBounds(input.month);
  const s = input.settings;
  const included = new Set(s.includedCheckIds);
  const byId = new Map(input.products.map((p) => [p.id, p]));
  const lessons = input.reservations
    .filter((r) => r.type === "pt" && !!r.delegationId && input.delegationIds.has(r.delegationId)
      && r.date >= start && r.date <= end && (r.status === "done" || r.status === "noshow" || r.status === "cancelled"))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .map((r): SettlementLesson => {
      const h = classifyLesson(r, input.firstDay, input.statusLogs?.get(r.id));
      const p = r.productId ? byId.get(r.productId) : undefined;
      const { unit, issue } = unitPriceOf(p, input.transferRecipientIds);
      // 관리자가 처리한 것으로 기록된 레슨은 대리 트레이너 지급 대상이 아니다.
      const eligible = h.kind === "owner" ? false
        : r.status === "done" ? (h.kind === "delegate" || included.has(r.id)) : r.status === "noshow" ? s.includeNoshow : false;
      let amount = 0;
      let basis = "-";
      if (eligible) {
        if (s.mode === "fixed") {
          amount = toWon(s.perLesson);
          basis = `회당 ${won(amount)}`;
        } else if (r.id in s.manualAmounts) {
          amount = toWon(s.manualAmounts[r.id]);
          basis = `직접 입력 ${won(amount)}`;
        } else if (unit !== null) {
          amount = toWon((unit * (Number(s.ratePct) || 0)) / 100);
          basis = `${won(unit)} × ${Number(s.ratePct) || 0}% = ${won(amount)}`;
        } else {
          basis = "단가 불명확 · 금액 직접 입력 필요";
        }
      }
      return {
        id: r.id, date: r.date, time: r.time, duration: Number(r.duration) || 0,
        customerName: input.customerNameOf(r.customerId), status: r.status, productName: p?.name || "-",
        handler: h.kind === "check" ? "check" : h.kind === "owner" ? "owner" : "delegate", handlerNote: h.note,
        unitPrice: unit, unitIssue: issue, eligible, amount, basis,
      };
    });
  const counts: SettlementCounts = {
    done: lessons.filter((l) => l.status === "done" && l.handler === "delegate").length,
    noshow: lessons.filter((l) => l.status === "noshow" && l.handler !== "owner").length,
    cancelled: lessons.filter((l) => l.status === "cancelled" && l.handler !== "owner").length,
    check: lessons.filter((l) => l.handler === "check").length,
    eligible: lessons.filter((l) => l.eligible).length,
  };
  const lessonAmount = lessons.reduce((sum, l) => sum + l.amount, 0);
  const adjustTotal = s.adjustments.reduce((sum, a) => sum + toWon(a.amount), 0);
  return { lessons, counts, lessonAmount, adjustTotal, total: lessonAmount + adjustTotal, fingerprint: lessonFingerprint(lessons) };
}

export const lessonFingerprint = (lessons: Pick<SettlementLesson, "id" | "status" | "date" | "time">[]): string =>
  lessons.map((l) => `${l.id}|${l.status}|${l.date}|${l.time}`).sort().join(";");

// 확정 이후 바뀐 레슨(추가·빠짐·상태/날짜 변경)
export function settlementChanges(snapshotLessons: SettlementLesson[], current: SettlementLesson[]): string[] {
  const before = new Map(snapshotLessons.map((l) => [l.id, l]));
  const after = new Map(current.map((l) => [l.id, l]));
  const out: string[] = [];
  const label = (l: SettlementLesson) => `${l.date.slice(5).replace("-", "/")} ${l.time} ${l.customerName}`;
  const statusLabel: Record<string, string> = { done: "완료", noshow: "노쇼", cancelled: "취소", scheduled: "예약됨" };
  current.forEach((l) => { if (!before.has(l.id)) out.push(`추가됨: ${label(l)} (${statusLabel[l.status]})`); });
  snapshotLessons.forEach((l) => {
    const now = after.get(l.id);
    if (!now) out.push(`빠짐: ${label(l)} (확정 때 ${statusLabel[l.status]})`);
    else if (now.status !== l.status) out.push(`상태 변경: ${label(l)} ${statusLabel[l.status]} → ${statusLabel[now.status]}`);
    else if (now.date !== l.date || now.time !== l.time) out.push(`일정 변경: ${label(l)} → ${now.date.slice(5).replace("-", "/")} ${now.time}`);
  });
  return out;
}

// 정산서 고객 이름 가리기: "김철수" → "김○○"
export const maskName = (name: string): string => {
  const chars = [...(name || "").trim()];
  if (chars.length === 0) return "";
  return chars[0] + "○".repeat(Math.max(1, chars.length - 1));
};

// ---- 정산 기록(delegate_settlements) 상태 ----
export type SettlementAction = "confirm" | "unconfirm" | "paid" | "unpaid";
export type SettlementSnapshot = {
  version: 1;
  month: string;
  delegateName: string;
  delegateEmail: string;
  settings: SettlementSettings;
  lessons: SettlementLesson[];
  counts: SettlementCounts;
  lessonAmount: number;
  adjustTotal: number;
  total: number;
  fingerprint: string;
};
export interface DelegateSettlementRecord {
  id: string;
  month: string;
  delegateEmail: string;
  delegateName: string;
  action: SettlementAction;
  lessonCount: number;
  totalAmount: number;
  snapshot: SettlementSnapshot | null;
  paidOn: string | null;
  memo: string | null;
  createdAt: string;
}

// 같은 달·같은 트레이너 기록(오래된 순)으로 지금 상태를 만든다. 지우지 않고 쌓기만 하므로 마지막 줄이 지금 상태다.
export function settlementState(records: DelegateSettlementRecord[]): {
  confirmed: DelegateSettlementRecord | null; paid: DelegateSettlementRecord | null; history: DelegateSettlementRecord[];
} {
  const history = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let confirmed: DelegateSettlementRecord | null = null;
  let paid: DelegateSettlementRecord | null = null;
  history.forEach((r) => {
    if (r.action === "confirm") { confirmed = r; paid = null; }
    else if (r.action === "unconfirm") { confirmed = null; paid = null; }
    else if (r.action === "paid" && confirmed) paid = r;
    else if (r.action === "unpaid") paid = null;
  });
  return { confirmed, paid, history };
}
