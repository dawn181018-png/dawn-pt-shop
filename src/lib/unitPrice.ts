// 통계분석 > "PT 단가 분석" 계산(조회 전용). PT 1회를 평균 얼마에 팔고, 한 번 계약할 때 평균 얼마를 결제하는지 본다.
// 판매 건(이용권)과 미수금 결제(잔금) 기록을 읽기만 한다 — 매출·세션 차감·잔여 횟수 계산과 데이터는 바꾸지 않는다.
//
// 기준(대표와 정한 규칙):
// - 단위는 "판매 건". 판매 건은 처음 결제한 날(결제일 = 이용권 createdAt, 회계관리와 같은 날짜)의 달에 묶는다.
//   나중에 받은 미수금(잔금)은 받은 날짜 매출로 잡히는 회계관리 규칙은 그대로 두고, 단가에서는 그 판매 건에 붙여 계산한다
//   (11월에 받은 10월 판매의 잔금을 11월 단가에 넣으면 횟수 없이 돈만 더해져 단가가 부풀기 때문).
// - 금액: 기본 (b) 실제 받은 금액 = 처음 결제금액 + 지금까지 받은 잔금(취소 제외). 전환 (a) 계약 금액 = 판매가.
// - 횟수: 총 횟수(서비스 포함). 서비스 횟수는 메모의 "서비스 N회"(또는 "N회 서비스")에서 읽는다 — 따로 적는 칸이 없다.
// - 제외: 삭제(보관)된 판매 건, 기간권(횟수 없음), 양도로 생긴 이용권. 대리 레슨은 판매 기록이 아니라 섞이지 않는다.
// - 평균은 건별 단가의 단순 평균이 아니라 합계로 나눈 값(가중 평균)이다.

import { paidOf, collectedByProduct, firstPurchaseMap, monthRange, paidDateOf } from "@/lib/accounting";
import type { Customer, PaymentCollection, Product } from "@/lib/types";

export type UnitBasis = "received" | "contract";

// 메모에서 서비스 횟수 읽기. 못 읽으면 null(서비스 0회로 계산하고 "읽지 못한 건"으로 센다).
export function serviceSessionsFromMemo(memo?: string | null): number | null {
  const text = memo || "";
  const m = text.match(/서비스\s*[:+]?\s*(\d{1,3})\s*회?/) || text.match(/(\d{1,3})\s*회\s*서비스/);
  return m ? Number(m[1]) : null;
}

export type UnitSale = {
  id: string;
  no: number; // 화면용 건 번호(결제일 순)
  customerId: string;
  customerName: string;
  productName: string;
  paidDate: string;
  kind: "new" | "renew";
  sessions: number; // 총 횟수(서비스 포함)
  service: number; // 메모에서 읽은 서비스 횟수(없으면 0)
  serviceRead: boolean; // 메모에 "서비스" 글자가 있는데 횟수를 못 읽었으면 false
  contract: number; // 판매가
  received: number; // 처음 결제 + 받은 잔금
  unpaid: number; // 판매가 − 받은 금액
  amount: number; // 지금 기준(basis)의 금액
  unit: number; // amount ÷ sessions
};

export type UnitTotals = {
  count: number;
  amount: number;
  sessions: number;
  service: number;
  avgUnit: number | null; // 금액 합계 ÷ 총 횟수
  avgUnitNoService: number | null; // 금액 합계 ÷ (총 횟수 − 서비스)
  avgContract: number | null; // 금액 합계 ÷ 건수
};

export function totalsOf(sales: UnitSale[]): UnitTotals {
  const amount = sales.reduce((s, x) => s + x.amount, 0);
  const sessions = sales.reduce((s, x) => s + x.sessions, 0);
  const service = sales.reduce((s, x) => s + x.service, 0);
  return {
    count: sales.length, amount, sessions, service,
    avgUnit: sessions > 0 ? amount / sessions : null,
    avgUnitNoService: sessions - service > 0 ? amount / (sessions - service) : null,
    avgContract: sales.length > 0 ? amount / sales.length : null,
  };
}

// 기간 안의 판매 건(단가 계산 대상)과 제외된 건 수
export function unitSales(input: {
  products: Product[]; // 보관 안 된 이용권만(화면의 products)
  customers: Customer[]; // 보관된 고객 포함(이름 표시용)
  collections: PaymentCollection[] | null;
  transferRecipientIds: Set<string>;
  range: { start: string; end: string };
  basis: UnitBasis;
}): { sales: UnitSale[]; excludedTransfer: number; excludedPeriod: number; unpaidCount: number; unpaidAmount: number; serviceUnread: number } {
  const collected = collectedByProduct(input.collections);
  const first = firstPurchaseMap(input.products);
  const names = new Map(input.customers.map((c) => [c.id, c.name]));
  const inRange = input.products.filter((p) => !p.archivedAt && !!p.createdAt && paidDateOf(p) >= input.range.start && paidDateOf(p) <= input.range.end);
  const excludedPeriod = inRange.filter((p) => p.type !== "session").length;
  const excludedTransfer = inRange.filter((p) => p.type === "session" && input.transferRecipientIds.has(p.id)).length;
  const sales = inRange
    .filter((p) => p.type === "session" && !input.transferRecipientIds.has(p.id) && Number(p.totalSessions) > 0)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map((p, i): UnitSale => {
      const sessions = Number(p.totalSessions) || 0;
      const parsed = serviceSessionsFromMemo(p.memo);
      const service = parsed !== null && parsed < sessions ? parsed : 0;
      const contract = Number(p.price) || 0;
      const received = paidOf(p) + (collected[p.id] || 0);
      const amount = input.basis === "contract" ? contract : received;
      return {
        id: p.id, no: i + 1, customerId: p.customerId, customerName: names.get(p.customerId) || "(삭제된 고객)", productName: p.name,
        paidDate: paidDateOf(p), kind: first[p.customerId] === p.createdAt ? "new" : "renew",
        sessions, service, serviceRead: !/서비스/.test(p.memo || "") || (parsed !== null && parsed < sessions),
        contract, received, unpaid: Math.max(0, contract - received), amount, unit: sessions > 0 ? amount / sessions : 0,
      };
    });
  const unpaid = sales.filter((x) => x.unpaid > 0);
  return {
    sales, excludedTransfer, excludedPeriod,
    unpaidCount: unpaid.length, unpaidAmount: unpaid.reduce((s, x) => s + x.unpaid, 0),
    serviceUnread: sales.filter((x) => !x.serviceRead).length,
  };
}

// 같은 총 횟수끼리 묶기(10회, 20회, 30회 …)
export function byCount(sales: UnitSale[]): { sessions: number; totals: UnitTotals }[] {
  const map = new Map<number, UnitSale[]>();
  sales.forEach((s) => map.set(s.sessions, [...(map.get(s.sessions) || []), s]));
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([sessions, list]) => ({ sessions, totals: totalsOf(list) }));
}

// 단가가 가장 높은/낮은 건 n개
export function extremes(sales: UnitSale[], n = 5): { high: UnitSale[]; low: UnitSale[] } {
  const sorted = [...sales].sort((a, b) => b.unit - a.unit || a.no - b.no);
  return { high: sorted.slice(0, n), low: [...sorted].reverse().slice(0, n) };
}

// 최근 12개월(이번 달 포함) 월별 단가
export function monthlyTrend(input: Omit<Parameters<typeof unitSales>[0], "range">, endMonth: string, months = 12) {
  const out: { month: string; totals: UnitTotals }[] = [];
  let y = Number(endMonth.slice(0, 4)), m = Number(endMonth.slice(5, 7));
  for (let i = 0; i < months; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.unshift({ month: key, totals: totalsOf(unitSales({ ...input, range: monthRange(key) }).sales) });
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

export const wonRound = (n: number | null): string => (n === null ? "-" : `${Math.round(n).toLocaleString()}원`);
