// 대리 트레이너가 관리자와 같은 스케줄 화면(PTMemberManager mode="delegate")을 쓸 때의 데이터 연결부.
// 대리 계정은 테이블을 직접 읽거나 쓸 권한이 없으므로, 화면이 쓰는 고객/이용권/예약 모양을 전부 DB의
// proxy_* 함수 결과에서 만들어 준다. proxy_context는 "지정 고객 + 유효 기간"만 걸러서 보내고, 다른 고객의
// 예약은 이름·이용권·운동일지 없이 날짜/시간/길이만 보낸다 — 그래서 화면에 그려도 다른 고객 정보는 없다.
// 결제·매출·급여·연락처 전체·이메일은 애초에 받지 않는다.

import {
  loadProxyContext, addProxyReservations, setProxyReservationStatus, moveProxyReservation, saveProxyWorkoutNote,
  type ProxyContext,
} from "@/lib/proxyDb";
import type { Customer, Product, Reservation, ReservationStatus } from "@/lib/types";

// 다른 고객의 예약(시간만 아는 "예약됨" 칸)은 이 접두어의 id로 만든다 — 화면에서 눌러도 열리지 않게 구분하는 표시.
export const BUSY_ID_PREFIX = "busy-";
export const isBusyId = (id: string | null | undefined): boolean => !!id && id.startsWith(BUSY_ID_PREFIX);

export type DelegateState = {
  customers: Customer[];
  products: Product[];
  reservations: Reservation[];
  newCustomerIds: string[];
  info: { name: string; customerCount: number; endsOn: string | null; active: boolean };
};

type ProxyCustomerExt = ProxyContext["customers"][number] & { isNew?: boolean };
type ProxyProductExt = ProxyContext["products"][number] & { sessionDuration?: number };

function toState(ctx: ProxyContext): DelegateState {
  const customers: Customer[] = (ctx.customers as ProxyCustomerExt[]).map((c) => ({
    id: c.id, name: c.name, phone: c.phoneMasked || "", isDormant: false,
  }));
  const products: Product[] = (ctx.products as ProxyProductExt[]).map((p) => ({
    id: p.id, customerId: p.customerId, name: p.name, type: p.type,
    totalSessions: p.totalSessions, usedSessions: p.usedSessions,
    startDate: p.startDate, endDate: p.endDate, sessionDuration: p.sessionDuration || 50,
    // 금액은 대리 계정에 내려오지 않는다 — 화면 계산이 깨지지 않게 0으로 둔다(대리 화면엔 금액이 보이지 않음).
    listPrice: 0, price: 0, paidAmount: 0, paymentMethod: "card",
    createdAt: p.createdAt ? new Date(p.createdAt).getTime() : undefined,
  }));
  const own: Reservation[] = ctx.reservations.map((r) => ({
    id: r.id, customerId: r.customerId, productId: r.productId, seriesId: r.seriesId,
    date: r.date, time: r.time, duration: r.duration, memo: "", status: r.status, type: "pt",
    // 서명 이미지 경로는 대리 계정에 보내지 않는다 — "서명 있음" 표시만 되도록 값만 채운다.
    signatureUrl: r.signed ? "signed" : null,
    workoutNote: r.workoutNote, delegateName: r.delegateName,
  }));
  const busy: Reservation[] = ctx.busy.map((b, i) => ({
    id: `${BUSY_ID_PREFIX}${b.date}-${b.time}-${i}`, customerId: null, productId: null, seriesId: null,
    date: b.date, time: b.time, duration: b.duration, memo: "예약됨", status: "scheduled", type: "misc",
  }));
  const active = ctx.delegations.filter((d) => d.active);
  const endsOn = active.some((d) => !d.endsOn) ? null : active.map((d) => d.endsOn as string).sort().slice(-1)[0] || null;
  return {
    customers, products, reservations: [...own, ...busy],
    newCustomerIds: (ctx.customers as ProxyCustomerExt[]).filter((c) => c.isNew).map((c) => c.id),
    info: { name: ctx.delegations[0]?.name || "", customerCount: customers.length, endsOn, active: active.length > 0 },
  };
}

export async function loadDelegateState(): Promise<DelegateState> {
  return toState(await loadProxyContext());
}

// 아래 동작은 모두 DB 함수가 지정 고객/기간/소진 이용권/규칙을 다시 확인한다. 끝나면 최신 상태를 다시 받아 돌려준다.
export async function delegateAddReservations(customerId: string, productId: string, dates: string[], time: string, duration: number) {
  await addProxyReservations(customerId, productId, dates, time, duration);
  return loadDelegateState();
}
export async function delegateSetStatus(reservationId: string, status: ReservationStatus) {
  await setProxyReservationStatus(reservationId, status);
  return loadDelegateState();
}
export async function delegateMove(reservationId: string, date: string, time: string, duration: number) {
  await moveProxyReservation(reservationId, date, time, duration);
  return loadDelegateState();
}
export async function delegateSaveNote(reservationId: string, note: string) {
  await saveProxyWorkoutNote(reservationId, note);
  return loadDelegateState();
}
