// 회계관리(일일/주간/월간) 금액·건수 계산을 한 곳에 모은 것. 세 탭이 모두 이 함수들을 써서
// 같은 기간이면 어느 탭에서 봐도 같은 숫자가 나온다.
// 기준: 결제 1건 = 이용권 1개. 집계일 = 이용권의 결제일(createdAt, 등록 화면의 "결제일"과 같은 값),
// 금액 = 실제 결제(입금)금액. 미수금(판매가 − 결제금액)은 합계에 넣지 않고 따로 보여준다.
// 통계분석의 등록 매출, 매출 계획의 이번달 등록금액과 같은 기준이다(페이롤은 레슨 완료 기준이라 별개).

import { toLocalDateStr, addDays } from "@/lib/formatUtils";
import type { Customer, Product } from "@/lib/types";

export type PaymentKind = "new" | "renew";

export type PaymentRow = Product & {
  paidDate: string; // YYYY-MM-DD (한국 날짜)
  customerName: string;
  phone: string;
  kind: PaymentKind; // 그 고객의 첫 이용권이면 신규, 아니면 재등록
  isTransfer: boolean; // 양도로 생긴 이용권(결제금액 = 양도 금액)
  paid: number;
  unpaid: number;
};

export type PaymentSummary = {
  totalAmount: number; totalCount: number; totalPeople: number;
  newAmount: number; newCount: number; newPeople: number;
  renewAmount: number; renewCount: number; renewPeople: number;
  transferAmount: number; transferCount: number; transferPeople: number;
  unpaidAmount: number; unpaidCount: number;
};

export const paidOf = (p: Pick<Product, "paidAmount">): number => Number(p.paidAmount) || 0;
export const unpaidOf = (p: Pick<Product, "price" | "paidAmount">): number => Math.max(0, (Number(p.price) || 0) - paidOf(p));
export const paidDateOf = (p: Pick<Product, "createdAt">): string => toLocalDateStr(new Date(p.createdAt || 0));

// 고객별 첫 이용권의 결제 시각 — 그 시각과 같은 이용권이 신규, 나머지는 재등록(통계분석과 같은 규칙).
export function firstPurchaseMap(products: Product[]): Record<string, number> {
  const map: Record<string, number> = {};
  products.forEach((p) => {
    if (!(p.customerId in map) || (p.createdAt || 0) < map[p.customerId]) map[p.customerId] = p.createdAt || 0;
  });
  return map;
}

// 기간(start~end, 양끝 포함)의 결제 건 목록. 최신 결제일 순.
export function buildPaymentRows(
  products: Product[],
  customers: Customer[],
  range: { start: string; end: string },
  transferProductIds: Set<string>,
  firstPurchase: Record<string, number>,
): PaymentRow[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  return products
    .map((p) => ({ p, paidDate: paidDateOf(p) }))
    .filter(({ p, paidDate }) => !!p.createdAt && paidDate >= range.start && paidDate <= range.end)
    .map(({ p, paidDate }) => {
      const cust = byId.get(p.customerId);
      return {
        ...p,
        paidDate,
        customerName: cust ? `${cust.name}${cust.archivedAt ? " (보관)" : ""}` : "(삭제된 고객)",
        phone: cust?.phone || "",
        kind: (firstPurchase[p.customerId] === p.createdAt ? "new" : "renew") as PaymentKind,
        isTransfer: transferProductIds.has(p.id),
        paid: paidOf(p),
        unpaid: unpaidOf(p),
      };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function summarizePayments(rows: PaymentRow[]): PaymentSummary {
  const sum = (list: PaymentRow[]) => list.reduce((s, r) => s + r.paid, 0);
  const people = (list: PaymentRow[]) => new Set(list.map((r) => r.customerId)).size;
  const newRows = rows.filter((r) => r.kind === "new");
  const renewRows = rows.filter((r) => r.kind === "renew");
  const transferRows = rows.filter((r) => r.isTransfer);
  const unpaidRows = rows.filter((r) => r.unpaid > 0);
  return {
    totalAmount: sum(rows), totalCount: rows.length, totalPeople: people(rows),
    newAmount: sum(newRows), newCount: newRows.length, newPeople: people(newRows),
    renewAmount: sum(renewRows), renewCount: renewRows.length, renewPeople: people(renewRows),
    transferAmount: sum(transferRows), transferCount: transferRows.length, transferPeople: people(transferRows),
    unpaidAmount: unpaidRows.reduce((s, r) => s + r.unpaid, 0), unpaidCount: unpaidRows.length,
  };
}

// 주간 화면의 요일별 합계(월~일). start는 그 주 월요일.
export function dailyTotals(rows: PaymentRow[], start: string, days: number): { date: string; amount: number; count: number }[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    const dayRows = rows.filter((r) => r.paidDate === date);
    return { date, amount: dayRows.reduce((s, r) => s + r.paid, 0), count: dayRows.length };
  });
}
