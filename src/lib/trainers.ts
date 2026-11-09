// 예약 "담당자(강사)" 공용 규칙 — 스케줄 색·이름, 예약창 담당자 목록, 같은 강사 시간 겹침 확인이 모두 여기 한 곳을 쓴다.
// 담당자 값(reservations.trainer_email): 비어 있음 = 미지정(지금까지의 예약, 대표로 표시) / "owner" = 대표 / 이메일 = 그 대리 트레이너.
// 미지정인데 대리 기록(delegationId)이 있는 예전 레슨은 지금까지처럼 그 대리 트레이너로 보여준다(기존 데이터를 다르게 보이게 하지 않음).
// 조회·표시용 계산만 한다 — 세션 차감·잔여 횟수·매출 계산과는 관계없다.

import type { LessonDelegation, Reservation } from "@/lib/types";

export const OWNER_KEY = "owner";
export const TRAINER_COLOR_COUNT = 4; // 1번째 강사 노랑(예전 대리 색), 2번째 하늘, 3번째 분홍, 4번째 연두 — 그 뒤는 다시 처음부터

export type TrainerOption = {
  key: string; // "owner" 또는 이메일(소문자)
  name: string;
  colorIdx: number | null; // 대표는 null(지금 색 그대로)
  active: boolean; // 해제되지 않은 대리 지정이 있는지(예약창 목록에는 이것만)
  delegations: LessonDelegation[];
};

export const normEmail = (e?: string | null) => (e || "").trim().toLowerCase();

// 대표 + 대리 트레이너(이메일이 같으면 한 사람). 색 순서는 처음 지정된 순서로 고정한다.
export function trainerOptions(delegations: LessonDelegation[]): TrainerOption[] {
  const map = new Map<string, { name: string; first: number; latest: number; list: LessonDelegation[] }>();
  delegations.forEach((d) => {
    const key = normEmail(d.delegateEmail);
    if (!key) return;
    const cur = map.get(key) || { name: d.delegateName, first: Infinity, latest: -Infinity, list: [] };
    cur.list.push(d);
    const at = d.createdAt || 0;
    if (at < cur.first) cur.first = at;
    if (at >= cur.latest) { cur.latest = at; cur.name = d.delegateName; }
    map.set(key, cur);
  });
  const trainers = [...map.entries()].sort((a, b) => a[1].first - b[1].first).map(([key, v], i): TrainerOption => ({
    key, name: v.name, colorIdx: i % TRAINER_COLOR_COUNT, active: v.list.some((d) => !d.revokedAt), delegations: v.list,
  }));
  return [{ key: OWNER_KEY, name: "대표(나)", colorIdx: null, active: true, delegations: [] }, ...trainers];
}

// 예약의 담당자 키
export function trainerKeyOf(r: Pick<Reservation, "trainerEmail" | "delegationId">, delegationEmailById: Map<string, string>): string {
  if (r.trainerEmail === OWNER_KEY) return OWNER_KEY;
  if (r.trainerEmail) return normEmail(r.trainerEmail);
  if (r.delegationId && delegationEmailById.get(r.delegationId)) return delegationEmailById.get(r.delegationId) as string;
  return OWNER_KEY;
}
export const delegationEmailMap = (delegations: LessonDelegation[]) => new Map(delegations.map((d) => [d.id, normEmail(d.delegateEmail)]));

// 예약창에서 고른 담당자로 저장할 값. 대리 트레이너면 이 고객을 맡은(해제 안 된) 지정을 함께 붙여야 그 트레이너 화면에도 보인다.
// covering이 없으면 needsAdd(이 고객을 그 트레이너 지정에 추가할지 물어봐야 함), 지정이 하나도 살아 있지 않으면 unavailable.
export function trainerAssignment(option: TrainerOption, customerId: string | null):
  | { kind: "ok"; fields: Pick<Reservation, "trainerEmail" | "delegationId" | "delegateName"> }
  | { kind: "needsAdd"; delegation: LessonDelegation }
  | { kind: "unavailable" } {
  if (option.key === OWNER_KEY) return { kind: "ok", fields: { trainerEmail: OWNER_KEY, delegationId: null, delegateName: null } };
  const live = option.delegations.filter((d) => !d.revokedAt).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (live.length === 0) return { kind: "unavailable" };
  const covering = customerId ? live.find((d) => d.customerIds.includes(customerId)) : live[0];
  if (!covering) return { kind: "needsAdd", delegation: live[0] };
  return { kind: "ok", fields: { trainerEmail: option.key, delegationId: covering.id, delegateName: covering.delegateName } };
}

// 시간 겹침: 같은 날, [시작, 시작+길이) 구간이 겹치면 true
const toMin = (t: string) => { const [h, m] = (t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
export function timesOverlap(a: { date: string; time: string; duration: number | string }, b: { date: string; time: string; duration: number | string }): boolean {
  if (a.date !== b.date) return false;
  const as = toMin(a.time), ae = as + (Number(a.duration) || 50);
  const bs = toMin(b.time), be = bs + (Number(b.duration) || 50);
  return as < be && bs < ae;
}

// 같은 강사의 겹치는 예약(취소 제외). 다른 강사끼리는 겹쳐도 괜찮다. 기타 일정(misc)은 대표의 일정으로 본다.
export function trainerConflicts(
  rows: { date: string; time: string; duration: number | string }[],
  key: string,
  reservations: Reservation[],
  delegationEmailById: Map<string, string>,
  excludeIds: Set<string> = new Set(),
): Reservation[] {
  return reservations.filter((r) => r.status !== "cancelled" && !excludeIds.has(r.id)
    && (r.type === "misc" ? OWNER_KEY : trainerKeyOf(r, delegationEmailById)) === key
    && rows.some((x) => timesOverlap(x, r)));
}
