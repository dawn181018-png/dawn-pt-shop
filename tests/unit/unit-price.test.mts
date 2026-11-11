import * as U from "@/lib/unitPrice";
let pass = 0, fail = 0;
const show = (l: string, ok: boolean, d = "") => { ok ? pass++ : fail++; console.log(ok ? "PASS" : "FAIL", l, d); };
const at = (d: string) => new Date(`${d}T10:00:00+09:00`).getTime();
const P = (id: string, cust: string, d: string, total: number, price: number, paid: number, x: any = {}) => ({ id, customerId: cust, name: `PT ${total}회`, type: "session", totalSessions: total, usedSessions: 0, price, listPrice: price, paidAmount: paid, paymentMethod: "card", startDate: d, sessionDuration: 50, createdAt: at(d), ...x });
const products: any[] = [
  P("s1", "c1", "2026-10-03", 20, 1_200_000, 1_200_000, { memo: "20회 + 서비스 2회" }),       // 신규, 서비스 2
  P("s2", "c2", "2026-10-10", 10, 700_000, 400_000),                                       // 신규, 미수 300,000 → 11월에 200,000 받음
  P("s3", "c1", "2026-10-20", 30, 1_500_000, 1_500_000, { memo: "서비스5회" }),             // 재등록, 서비스 5
  P("s4", "c3", "2026-10-25", 10, 300_000, 300_000),                                       // 양도받은 이용권 → 제외
  { ...P("s5", "c4", "2026-10-26", 0, 200_000, 200_000), type: "period" },                 // 기간권 → 제외
  P("s6", "c5", "2026-10-27", 10, 600_000, 600_000, { archivedAt: "2026-10-28" }),         // 삭제 → 제외
  P("s7", "c6", "2026-11-02", 10, 800_000, 800_000),                                       // 11월 판매
];
const collections: any[] = [
  { id: "k1", productId: "s2", amount: 200_000, paidDate: "2026-11-04", paymentMethod: "cash", requestId: "r", createdAt: "2026-11-04T10:00:00+09:00", cancelledAt: null, cancelReason: null },
  { id: "k2", productId: "s2", amount: 50_000, paidDate: "2026-11-05", paymentMethod: "cash", requestId: "r2", createdAt: "2026-11-05T10:00:00+09:00", cancelledAt: "x", cancelReason: "잘못" }, // 취소 → 제외
];
const customers: any[] = ["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => ({ id, name: id }));
const base = { products: products.filter((p) => !p.archivedAt), customers, collections, transferRecipientIds: new Set(["s4"]) };
const oct = U.unitSales({ ...base, basis: "received", range: { start: "2026-10-01", end: "2026-10-31" } });
const t = U.totalsOf(oct.sales);
// 손계산(받은 금액): s1 1,200,000 + s2 (400,000+200,000) + s3 1,500,000 = 3,300,000 / 횟수 20+10+30=60 / 서비스 2+5=7
show("10월 대상 3건(양도·기간권·삭제 제외)", t.count === 3 && oct.excludedTransfer === 1 && oct.excludedPeriod === 1, JSON.stringify({ n: t.count, tr: oct.excludedTransfer, pe: oct.excludedPeriod }));
show("받은 금액 합계 3,300,000 (11월에 받은 잔금 200,000은 10월 판매에 붙음, 취소 잔금 제외)", t.amount === 3_300_000, `${t.amount}`);
show("평균 1회 단가 = 3,300,000 ÷ 60 = 55,000", Math.round(t.avgUnit!) === 55_000, `${t.avgUnit}`);
show("서비스 제외 = 3,300,000 ÷ 53 = 62,264", Math.round(t.avgUnitNoService!) === 62_264, `${Math.round(t.avgUnitNoService!)}`);
show("1건 평균 = 3,300,000 ÷ 3 = 1,100,000", Math.round(t.avgContract!) === 1_100_000);
show("미수 남은 건 1건 100,000원", oct.unpaidCount === 1 && oct.unpaidAmount === 100_000);
const octC = U.totalsOf(U.unitSales({ ...base, basis: "contract", range: { start: "2026-10-01", end: "2026-10-31" } }).sales);
show("계약 금액 기준: 3,400,000 ÷ 60 = 56,667", octC.amount === 3_400_000 && Math.round(octC.avgUnit!) === 56_667, `${Math.round(octC.avgUnit!)}`);
// 가중 평균 vs 단순 평균 차이 확인: 건별 단가 60,000 / 60,000 / 50,000 → 단순 평균 56,667 ≠ 55,000
show("단순 평균(56,667)이 아니라 합계 기준(55,000)", Math.round(t.avgUnit!) !== Math.round((60000 + 60000 + 50000) / 3));
const nov = U.totalsOf(U.unitSales({ ...base, basis: "received", range: { start: "2026-11-01", end: "2026-11-30" } }).sales);
show("11월: 11월 판매 1건만(10월 판매의 잔금은 11월 단가에 안 섞임) 800,000÷10=80,000", nov.count === 1 && nov.amount === 800_000 && nov.avgUnit === 80_000);
const kinds = (k: string) => U.totalsOf(oct.sales.filter((s) => s.kind === k));
show("신규 2건(s1,s2) · 재등록 1건(s3)", kinds("new").count === 2 && kinds("renew").count === 1);
const g = U.byCount(oct.sales);
show("횟수별: 10회·20회·30회 각 1건", g.map((x) => `${x.sessions}:${x.totals.count}`).join(",") === "10:1,20:1,30:1");
const e = U.extremes(oct.sales, 5);
show("최고 단가 s1/s2(60,000), 최저 s3(50,000)", e.low[0].id === "s3" && e.high[0].unit === 60000);
show("서비스 읽기: '20회 + 서비스 2회'→2, '서비스5회'→5, '3회 서비스'→3, '서비스 있음'→null", U.serviceSessionsFromMemo("20회 + 서비스 2회") === 2 && U.serviceSessionsFromMemo("서비스5회") === 5 && U.serviceSessionsFromMemo("3회 서비스") === 3 && U.serviceSessionsFromMemo("서비스 있음") === null);
const unread = U.unitSales({ ...base, products: [P("z", "c1", "2026-10-03", 10, 500000, 500000, { memo: "서비스 있음" })], basis: "received", range: { start: "2026-10-01", end: "2026-10-31" } });
show("메모에 서비스는 있는데 횟수를 못 읽으면 '못 읽은 건'으로 셈", unread.serviceUnread === 1 && unread.sales[0].service === 0);
const tr = U.monthlyTrend({ ...base, basis: "received" }, "2026-11");
show("12개월 추이: 12칸, 10월 55,000 · 11월 80,000", tr.length === 12 && Math.round(tr[10].totals.avgUnit!) === 55000 && tr[11].totals.avgUnit === 80000 && tr[0].month === "2025-12");
const none = U.totalsOf(U.unitSales({ ...base, basis: "received", range: { start: "2026-01-01", end: "2026-01-31" } }).sales);
show("판매 없는 달: 0건, 단가 없음", none.count === 0 && none.avgUnit === null);
console.log(`\n합계: PASS ${pass} / FAIL ${fail}`); if (fail) process.exit(1);
