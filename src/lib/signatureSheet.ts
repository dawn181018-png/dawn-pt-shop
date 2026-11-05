// 고객 상세 > 서명 탭 "서명 시트": 이용권 1개를 종이 출석부처럼 회차 칸에 채우는 계산. 화면·이미지 저장이 같이 쓴다.
// 조회만 한다 — 예약·서명·세션 차감·잔여 횟수는 읽기만 하고 바꾸지 않는다.
//
// 어떤 레슨이 어느 이용권 칸에 들어가나(추측으로 다시 배정하지 않는다):
// - 레슨(예약)에 저장된 이용권 연결(productId)을 그대로 쓴다. 완료할 때 이용권이 소진돼 다른 이용권으로 넘어갔으면 실제로
//   차감한 이용권으로 바뀌어 저장되므로, 완료·노쇼 레슨은 차감된 이용권에 붙어 있다.
// - 그 이용권의 완료·노쇼 레슨을 날짜순으로 칸에 채운다(노쇼도 1회 차감이므로 한 칸).
// - 양도로 넘겨준 횟수는 넘겨준 날짜 자리에 "양도" 칸으로 넣는다.
// - 이용권 사용 횟수가 레슨 기록 + 양도보다 많으면(직접 조정·앱 이전 사용 등) 그 차이를 맨 앞 칸에 "기록 없는 사용"으로 둔다
//   → 스케줄 카드의 회차 번호(최근 완료 = 사용 횟수)와 같은 번호가 된다.
// - 적으면 레슨은 모두 보여주고 "사용 횟수와 레슨 기록이 달라요"를 안내한다.

import { toLocalDateStr } from "@/lib/formatUtils";
import type { PassTransfer, Product, Reservation } from "@/lib/types";

export const SLOTS_PER_PAGE = 50;
export const SLOTS_PER_COLUMN = 25;

export type SheetCell =
  | { kind: "lesson"; no: number; r: Reservation }
  | { kind: "transfer"; no: number; date: string }
  | { kind: "unrecorded"; no: number }
  | { kind: "scheduled"; no: number; r: Reservation }
  | { kind: "empty"; no: number };

export type SheetData = {
  product: Product;
  total: number;
  used: number;
  remain: number;
  capacity: number; // 칸 수 = max(총 횟수, 채워진 칸)
  cells: SheetCell[]; // 1번부터 capacity번까지
  pages: SheetCell[][]; // 한 장에 50칸
  firstDate: string | null;
  lastDate: string | null;
  lessonCount: number;
  transferCount: number;
  unrecorded: number;
  mismatch: string | null; // 사용 횟수와 기록이 맞지 않을 때 안내
  overTotal: boolean; // 총 횟수보다 많이 채워짐
};

const usedStatus = (s: string) => s === "done" || s === "noshow";

export function buildSheet(product: Product, reservations: Reservation[], transfers: PassTransfer[], todayStr: string): SheetData {
  const total = Math.max(0, Number(product.totalSessions) || 0);
  const used = Math.max(0, Number(product.usedSessions) || 0);
  const lessons = reservations
    .filter((r) => r.type === "pt" && r.productId === product.id && usedStatus(r.status))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const outs = transfers
    .filter((t) => t.sourceProductId === product.id && Number(t.sessionsTransferred) > 0)
    .map((t) => {
      const at = new Date(t.createdAt || 0);
      return { date: toLocalDateStr(at), key: `${toLocalDateStr(at)}${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`, count: Number(t.sessionsTransferred) };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  const transferCount = outs.reduce((s, t) => s + t.count, 0);
  const unrecorded = Math.max(0, used - lessons.length - transferCount);

  const filled: SheetCell[] = [];
  for (let i = 0; i < unrecorded; i++) filled.push({ kind: "unrecorded", no: 0 });
  // 레슨과 양도를 날짜순으로 섞는다
  let ti = 0;
  lessons.forEach((r) => {
    while (ti < outs.length && outs[ti].key <= r.date + r.time) {
      for (let k = 0; k < outs[ti].count; k++) filled.push({ kind: "transfer", no: 0, date: outs[ti].date });
      ti++;
    }
    filled.push({ kind: "lesson", no: 0, r });
  });
  for (; ti < outs.length; ti++) for (let k = 0; k < outs[ti].count; k++) filled.push({ kind: "transfer", no: 0, date: outs[ti].date });

  const capacity = Math.max(total, filled.length);
  // 예정 레슨: 이 이용권에 묶인 앞으로의 예약을 빈 칸에 순서대로(스케줄 카드의 예정 회차와 같은 순서)
  const upcoming = reservations
    .filter((r) => r.type === "pt" && r.productId === product.id && r.status === "scheduled" && r.date >= todayStr)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const cells: SheetCell[] = [];
  for (let i = 0; i < capacity; i++) {
    const no = i + 1;
    if (i < filled.length) cells.push({ ...filled[i], no } as SheetCell);
    else {
      const r = upcoming[i - filled.length];
      cells.push(r ? { kind: "scheduled", no, r } : { kind: "empty", no });
    }
  }
  const pages: SheetCell[][] = [];
  for (let i = 0; i < Math.max(1, capacity); i += SLOTS_PER_PAGE) pages.push(cells.slice(i, i + SLOTS_PER_PAGE));

  const recorded = lessons.length + transferCount;
  const mismatch = used < recorded
    ? `이용권의 사용 횟수(${used}회)보다 레슨 기록(${recorded}회)이 많아요 — 기록된 레슨을 모두 보여줘요`
    : unrecorded > 0 ? `사용 ${used}회 중 ${unrecorded}회는 레슨 기록이 없어요(직접 조정·앱 사용 전 등) — 앞쪽 칸에 표시했어요` : null;
  return {
    product, total, used, remain: Math.max(0, total - used), capacity, cells, pages,
    firstDate: lessons[0]?.date || null, lastDate: lessons[lessons.length - 1]?.date || null,
    lessonCount: lessons.length, transferCount, unrecorded, mismatch, overTotal: filled.length > total,
  };
}

// 한 장 50칸을 왼쪽(1~25) / 오른쪽(26~50) 열로. 50칸보다 적으면 왼쪽부터 채운다.
export function splitColumns(page: SheetCell[]): [SheetCell[], SheetCell[]] {
  return [page.slice(0, SLOTS_PER_COLUMN), page.slice(SLOTS_PER_COLUMN)];
}

// 기본 선택: 지금 사용 중인 이용권(잔여가 남은 횟수권 중 가장 먼저 등록한 것 = 차감 순서). 없으면 가장 최근 이용권.
export function defaultSheetProductId(products: Product[]): string {
  const sessions = products.filter((p) => p.type === "session" && !p.archivedAt);
  const active = sessions.filter((p) => (Number(p.totalSessions) || 0) - (Number(p.usedSessions) || 0) > 0)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (active[0]) return active[0].id;
  return [...sessions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]?.id || "";
}

// 파일 이름에 쓸 수 없는 글자를 뺀다: 서명시트_홍길동_PT50회_2026-11-05.png
export const sheetFileName = (customerName: string, productName: string, dateStr: string, page?: { no: number; of: number }) =>
  `서명시트_${customerName}_${productName}_${dateStr}${page && page.of > 1 ? `_${page.no}of${page.of}` : ""}`
    .replace(/[\\/:*?"<>|\s]+/g, "");
