// 매출(결제) 금액·건수 계산을 한 곳에 모은 것. 회계관리(일일/주간/월간)·통계분석(등록 매출)·매출 계획(실제 등록금액)이
// 모두 이 함수들을 써서, 같은 기간이면 어느 화면에서 봐도 같은 숫자가 나온다.
// 기준: 결제 1건 = 이용권 1개. 집계일 = 이용권의 결제일(createdAt, 등록 화면의 "결제일"과 같은 값),
// 금액 = 판매할 때 처음 받은 금액(paidAmount). 나중에 받은 미수금 결제(잔금, payment_collections)는
// 판매 건과 따로 "잔금" 줄로 받은 날(paidDate)에 잡는다 — 금액만 그날 매출에 더하고, 신규/재등록 건수·인원에는
// 넣지 않는다(새 판매가 아니므로). 판매가(판매금액)는 원래 판매일 기준 그대로다.
// 미수금(판매가 − 처음 결제금액 − 취소 안 된 잔금 합계)은 합계에 넣지 않고 따로 보여준다.
// 페이롤은 레슨 완료 × (판매가 ÷ 총 횟수) 기준이라 이 계산과 별개다(잔금을 받아도 급여는 바뀌지 않는다).

import { toLocalDateStr, addDays } from "@/lib/formatUtils";
import type { Customer, Product, PaymentCollection } from "@/lib/types";

// collection = 미수금 결제(잔금) 줄
export type PaymentKind = "new" | "renew" | "collection";

export type PaymentRow = Product & {
  rowKey: string; // 목록 key — 판매 줄은 이용권 id, 잔금 줄은 잔금 기록 id
  paidDate: string; // YYYY-MM-DD (한국 날짜) — 이 줄의 금액이 매출로 잡히는 날
  saleDate: string; // 원래 판매일(잔금 줄도 원래 판매 건의 판매일)
  customerName: string;
  phone: string;
  kind: PaymentKind; // 판매 줄: 그 고객의 첫 이용권이면 신규, 아니면 재등록 / 잔금 줄: collection
  isTransfer: boolean; // 양도로 생긴 이용권(결제금액 = 양도 금액)
  paid: number; // 이 줄로 들어온 금액(판매 줄 = 처음 결제금액, 잔금 줄 = 잔금)
  unpaid: number; // 판매 줄: 지금 남은 미수금 / 잔금 줄: 0
  collection: PaymentCollection | null; // 잔금 줄이면 그 기록
};

export type PaymentSummary = {
  totalAmount: number; totalCount: number; totalPeople: number;
  newAmount: number; newCount: number; newPeople: number;
  renewAmount: number; renewCount: number; renewPeople: number;
  transferAmount: number; transferCount: number; transferPeople: number;
  collectionAmount: number; collectionCount: number;
  unpaidAmount: number; unpaidCount: number;
};

// 취소되지 않은 잔금 기록만.
export const activeCollections = (collections: PaymentCollection[] | null | undefined): PaymentCollection[] =>
  (collections || []).filter((c) => !c.cancelledAt);

// 이용권 id → 취소 안 된 잔금 합계
export function collectedByProduct(collections: PaymentCollection[] | null | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  activeCollections(collections).forEach((c) => { map[c.productId] = (map[c.productId] || 0) + (Number(c.amount) || 0); });
  return map;
}

// 처음 결제금액(판매할 때 받은 돈)
export const paidOf = (p: Pick<Product, "paidAmount">): number => Number(p.paidAmount) || 0;
// 지금까지 받은 돈 전체(처음 결제 + 잔금)
export const paidTotalOf = (p: Pick<Product, "id" | "paidAmount">, collected?: Record<string, number>): number =>
  paidOf(p) + (collected?.[p.id] || 0);
// 지금 남은 미수금
export const unpaidOf = (p: Pick<Product, "id" | "price" | "paidAmount">, collected?: Record<string, number>): number =>
  Math.max(0, (Number(p.price) || 0) - paidTotalOf(p, collected));
export const paidDateOf = (p: Pick<Product, "createdAt">): string => toLocalDateStr(new Date(p.createdAt || 0));

// 'YYYY-MM' → 그 달 1일~말일
export function monthRange(key: string): { start: string; end: string } {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: `${key}-01`, end: addDays(next, -1) };
}

// 고객별 첫 이용권의 결제 시각 — 그 시각과 같은 이용권이 신규, 나머지는 재등록(통계분석과 같은 규칙).
export function firstPurchaseMap(products: Product[]): Record<string, number> {
  const map: Record<string, number> = {};
  products.forEach((p) => {
    if (!(p.customerId in map) || (p.createdAt || 0) < map[p.customerId]) map[p.customerId] = p.createdAt || 0;
  });
  return map;
}

// 기간(start~end, 양끝 포함)의 결제 줄 목록(판매 줄 + 잔금 줄). 최신 결제일 순.
// products에 없는 이용권(삭제·보관된 판매 건)의 잔금은 판매 건과 함께 빠진다 — 복구하면 함께 돌아온다.
export function buildPaymentRows(
  products: Product[],
  customers: Customer[],
  range: { start: string; end: string },
  transferProductIds: Set<string>,
  firstPurchase: Record<string, number>,
  collections: PaymentCollection[] | null = null,
): PaymentRow[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const collected = collectedByProduct(collections);
  const custInfo = (customerId: string) => {
    const cust = byId.get(customerId);
    return { customerName: cust ? `${cust.name}${cust.archivedAt ? " (보관)" : ""}` : "(삭제된 고객)", phone: cust?.phone || "" };
  };
  const saleRows: (PaymentRow & { sortAt: number })[] = products
    .map((p) => ({ p, paidDate: paidDateOf(p) }))
    .filter(({ p, paidDate }) => !!p.createdAt && paidDate >= range.start && paidDate <= range.end)
    .map(({ p, paidDate }) => ({
      ...p,
      ...custInfo(p.customerId),
      rowKey: p.id,
      paidDate,
      saleDate: paidDate,
      kind: (firstPurchase[p.customerId] === p.createdAt ? "new" : "renew") as PaymentKind,
      isTransfer: transferProductIds.has(p.id),
      paid: paidOf(p),
      unpaid: unpaidOf(p, collected),
      collection: null,
      sortAt: p.createdAt || 0,
    }));
  const collectionRows: (PaymentRow & { sortAt: number })[] = activeCollections(collections)
    .filter((c) => productById.has(c.productId) && c.paidDate >= range.start && c.paidDate <= range.end)
    .map((c) => {
      const p = productById.get(c.productId) as Product;
      return {
        ...p,
        ...custInfo(p.customerId),
        rowKey: c.id,
        paymentMethod: c.paymentMethod,
        paidDate: c.paidDate,
        saleDate: paidDateOf(p),
        kind: "collection" as PaymentKind,
        isTransfer: false,
        paid: Number(c.amount) || 0,
        unpaid: 0,
        collection: c,
        sortAt: new Date(c.createdAt).getTime() || 0,
      };
    });
  return [...saleRows, ...collectionRows]
    .sort((a, b) => (a.paidDate === b.paidDate ? b.sortAt - a.sortAt : a.paidDate < b.paidDate ? 1 : -1))
    .map(({ sortAt: _sortAt, ...row }) => row); // eslint-disable-line @typescript-eslint/no-unused-vars
}

export function summarizePayments(rows: PaymentRow[]): PaymentSummary {
  const sum = (list: PaymentRow[]) => list.reduce((s, r) => s + r.paid, 0);
  const people = (list: PaymentRow[]) => new Set(list.map((r) => r.customerId)).size;
  // 건수·인원은 판매 줄만 센다(잔금은 새 판매가 아님). 금액 합계에는 잔금도 받은 날 기준으로 들어간다.
  const saleRows = rows.filter((r) => r.kind !== "collection");
  const collectionRows = rows.filter((r) => r.kind === "collection");
  const newRows = saleRows.filter((r) => r.kind === "new");
  const renewRows = saleRows.filter((r) => r.kind === "renew");
  const transferRows = saleRows.filter((r) => r.isTransfer);
  const unpaidRows = saleRows.filter((r) => r.unpaid > 0);
  return {
    totalAmount: sum(rows), totalCount: saleRows.length, totalPeople: people(saleRows),
    newAmount: sum(newRows), newCount: newRows.length, newPeople: people(newRows),
    renewAmount: sum(renewRows), renewCount: renewRows.length, renewPeople: people(renewRows),
    transferAmount: sum(transferRows), transferCount: transferRows.length, transferPeople: people(transferRows),
    collectionAmount: sum(collectionRows), collectionCount: collectionRows.length,
    unpaidAmount: unpaidRows.reduce((s, r) => s + r.unpaid, 0), unpaidCount: unpaidRows.length,
  };
}

// 주간 화면의 요일별 합계(월~일). start는 그 주 월요일. 금액은 잔금 포함, 건수는 판매 건만.
export function dailyTotals(rows: PaymentRow[], start: string, days: number): { date: string; amount: number; count: number }[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    const dayRows = rows.filter((r) => r.paidDate === date);
    return { date, amount: dayRows.reduce((s, r) => s + r.paid, 0), count: dayRows.filter((r) => r.kind !== "collection").length };
  });
}
