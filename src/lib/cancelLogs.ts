// 예약 "취소 내역" 화면용 공용 함수 — 기록은 DB(reservation_cancel_logs)가 취소·삭제와 같은 처리 안에서 남기고,
// 여기서는 보여주기(이름표·건수·걸러 보기)만 한다. 기록을 만들거나 고치는 함수는 없다(추가만 가능한 기록).
import { toLocalDateStr } from "@/lib/formatUtils";
import { OWNER_KEY, normEmail } from "@/lib/trainers";

export type CancelKind = "single" | "series" | "pushed" | "delete" | "other";

export type ReservationCancelLog = {
  id: string;
  reservationId: string;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  productName: string | null;
  reservationType: string | null;
  reservationDate: string | null; // YYYY-MM-DD
  reservationTime: string | null; // HH:MM
  duration: number | null;
  trainerEmail: string | null;
  trainerName: string | null;
  seriesId: string | null;
  fromSeries: boolean;
  oldStatus: string | null;
  cancelKind: CancelKind;
  memo: string | null;
  actorRole: "owner" | "delegate" | "member" | "system";
  actorName: string | null;
  cancelledAt: string; // ISO 시각
};

export const CANCEL_KIND_LABELS: Record<CancelKind, string> = {
  single: "한 건 취소",
  series: "반복 예약 취소",
  pushed: "새 예약에 밀려 취소",
  delete: "예약 삭제",
  other: "기타",
};

const OLD_STATUS_LABELS: Record<string, string> = { done: "완료", noshow: "노쇼" };

// "예약 삭제 (완료였음)"처럼 지운 레슨이 완료·노쇼였으면 함께 보여준다.
export function cancelKindLabel(log: Pick<ReservationCancelLog, "cancelKind" | "oldStatus">): string {
  const base = CANCEL_KIND_LABELS[log.cancelKind] || "기타";
  const was = log.oldStatus ? OLD_STATUS_LABELS[log.oldStatus] : undefined;
  return was ? `${base} (${was}였음)` : base;
}

export function cancelActorLabel(log: Pick<ReservationCancelLog, "actorRole" | "actorName">): string {
  if (log.actorRole === "delegate") return log.actorName ? `대리 ${log.actorName}` : "대리 트레이너";
  if (log.actorRole === "owner") return "대표";
  if (log.actorRole === "member") return "회원";
  return "시스템";
}

// 담당 강사 필터 키: 대표 = "owner", 대리 트레이너 = 이메일(소문자). 예약의 담당자 키(trainers.trainerKeyOf)와 같은 모양.
export const cancelTrainerKey = (log: Pick<ReservationCancelLog, "trainerEmail">): string => {
  const e = normEmail(log.trainerEmail);
  return !e || e === OWNER_KEY ? OWNER_KEY : e;
};

export const cancelledDateOf = (log: Pick<ReservationCancelLog, "cancelledAt">): string => toLocalDateStr(new Date(log.cancelledAt));

// "이번 달 취소 N건 / 전체 N건" — 이번 달은 취소한 날짜 기준.
export function cancelSummary(logs: Pick<ReservationCancelLog, "cancelledAt">[], todayStr: string): { month: number; total: number } {
  const ym = todayStr.slice(0, 7);
  return { month: logs.filter((l) => cancelledDateOf(l).startsWith(ym)).length, total: logs.length };
}

export type CancelLogFilter = { from?: string; to?: string; name?: string; trainer?: string };

// 기간(취소한 날짜, 양 끝 포함) · 회원 이름 · 담당 강사로 걸러서 최근 취소부터 돌려준다.
export function filterCancelLogs<T extends ReservationCancelLog>(logs: T[], f: CancelLogFilter): T[] {
  const name = (f.name || "").trim().toLowerCase();
  return logs
    .filter((l) => {
      const d = cancelledDateOf(l);
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      if (name && !(l.customerName || "").toLowerCase().includes(name)) return false;
      if (f.trainer && f.trainer !== "all" && cancelTrainerKey(l) !== f.trainer) return false;
      return true;
    })
    .sort((a, b) => b.cancelledAt.localeCompare(a.cancelledAt) || b.id.localeCompare(a.id));
}
