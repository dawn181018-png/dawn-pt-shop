// 매출(회계·통계·매출 계획) 계산 회귀 시험(가짜 데이터). 화면 공식(oldStats/oldForecast)과 공용 함수가 같은 숫자를 내는지,
// 미수금 결제(잔금)가 받은 날 매출로만 잡히는지 확인한다.
import * as N from "@/lib/accounting";
import { toLocalDateStr, addDays } from "@/lib/formatUtils";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => { if (ok) pass++; else { fail++; console.log("FAIL", label, detail); } };
const show = (label: string, ok: boolean, detail = "") => { check(label, ok, detail); console.log(ok ? "PASS" : "FAIL", label, detail); };

// ---- 가짜 데이터 300건(2019~2026), 일부 미수금, 일부 양도 ----
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const customers = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, name: `고객${i}`, phone: `010-${i}` }));
const products: any[] = Array.from({ length: 300 }, (_, i) => {
  const t = Date.UTC(2019, 0, 1) + Math.floor(rnd() * (Date.UTC(2026, 10, 4) - Date.UTC(2019, 0, 1)));
  const price = Math.round(rnd() * 30) * 100000 + 500000;
  const paid = rnd() < 0.15 ? Math.round(price * rnd() / 10000) * 10000 : price;
  return { id: `p${i}`, customerId: `c${Math.floor(rnd() * 60)}`, name: `PT ${i}`, type: "session", totalSessions: 20, usedSessions: 0,
    startDate: "2020-01-01", sessionDuration: 50, listPrice: price, price, paidAmount: paid, paymentMethod: ["card", "cash", "transfer"][i % 3], createdAt: t };
});
const transferIds = new Set(products.filter((_, i) => i % 37 === 0).map((p) => p.id));
const months: string[] = []; for (let y = 2019; y <= 2026; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
const fpOld = N.firstPurchaseMap(products), fpNew = N.firstPurchaseMap(products);

// main 브랜치의 통계분석·매출 계획 계산(화면 코드에서 그대로 옮김)
const oldStats = (key: string) => {
  const mp = products.filter((p) => p.createdAt && toLocalDateStr(new Date(p.createdAt)).startsWith(key));
  const paid = (p: any) => Number(p.paidAmount) || 0, unp = (p: any) => Math.max(0, Number(p.price || 0) - paid(p));
  const nw = mp.filter((p) => fpOld[p.customerId] === p.createdAt), rn = mp.filter((p) => fpOld[p.customerId] !== p.createdAt);
  return { regRevenue: mp.reduce((s, p) => s + paid(p), 0), regCount: mp.length, regUnpaid: mp.reduce((s, p) => s + unp(p), 0),
    newRevenue: nw.reduce((s, p) => s + paid(p), 0), newCount: nw.length, renewRevenue: rn.reduce((s, p) => s + paid(p), 0), renewCount: rn.length };
};
const oldForecast = (key: string) => {
  const map: Record<string, { actual: number; unpaid: number }> = {};
  customers.forEach((c) => {
    const mp = products.filter((p) => p.customerId === c.id && p.createdAt && toLocalDateStr(new Date(p.createdAt)).startsWith(key));
    map[c.id] = { actual: mp.reduce((s, p) => s + (Number(p.paidAmount) || 0), 0), unpaid: mp.reduce((s, p) => s + Math.max(0, p.price - p.paidAmount), 0) };
  });
  return map;
};
// 이번 작업의 화면 계산(PTMemberManager와 같은 호출)
const newStats = (key: string, cols: any) => {
  const s = N.summarizePayments(N.buildPaymentRows(products, [], N.monthRange(key), new Set(), fpNew, cols));
  return { regRevenue: s.totalAmount, regCount: s.totalCount, regUnpaid: s.unpaidAmount, newRevenue: s.newAmount, newCount: s.newCount, renewRevenue: s.renewAmount, renewCount: s.renewCount };
};
const newForecast = (key: string, cols: any) => {
  const map: Record<string, { actual: number; unpaid: number }> = {};
  customers.forEach((c) => (map[c.id] = { actual: 0, unpaid: 0 }));
  N.buildPaymentRows(products, [], N.monthRange(key), new Set(), fpNew, cols).forEach((r) => { map[r.customerId].actual += r.paid; map[r.customerId].unpaid += r.unpaid; });
  return map;
};
const lastDay = (key: string) => N.monthRange(key).end;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- (8) 잔금 기록이 없을 때: 96개월 전부 old == new (회계관리 월간·일별·목록, 통계분석, 매출 계획) ----
let diffs = 0;
for (const key of months) {
  const range = { start: `${key}-01`, end: lastDay(key) };
  const oRows = N.buildPaymentRows(products, customers, range, transferIds, fpOld, null);
  const nRows = N.buildPaymentRows(products, customers, range, transferIds, fpNew, null);
  const { collectionAmount: _ca, collectionCount: _cc, ...oSum } = N.summarizePayments(oRows); // eslint-disable-line @typescript-eslint/no-unused-vars
  const { collectionAmount, collectionCount, ...nSum } = N.summarizePayments(nRows);
  if (!same(oSum, nSum) || collectionAmount !== 0 || collectionCount !== 0) { diffs++; console.log("diff summary", key, oSum, nSum); }
  if (!same(oRows.map((r) => [r.id, r.paidDate, r.paid, r.unpaid, r.kind, r.isTransfer]), nRows.map((r) => [r.id, r.paidDate, r.paid, r.unpaid, r.kind, r.isTransfer]))) { diffs++; console.log("diff rows", key); }
  const days = Number(range.end.slice(8));
  if (!same(N.dailyTotals(oRows, range.start, days), N.dailyTotals(nRows, range.start, days))) { diffs++; console.log("diff daily", key); }
  if (!same(oldStats(key), newStats(key, []))) { diffs++; console.log("diff stats", key, oldStats(key), newStats(key, [])); }
  if (!same(oldForecast(key), newForecast(key, []))) { diffs++; console.log("diff forecast", key); }
}
show("(8) 잔금이 없을 때 96개월 × 5개 화면 계산이 이전과 1원도 다르지 않음", diffs === 0, `차이 ${diffs}곳`);

// ---- (1) 10/3 판매가 200만 · 100만 결제, 11/4에 잔금 100만 ----
const P = { id: "px", customerId: "c1", name: "PT 50회", type: "session", totalSessions: 50, usedSessions: 0, startDate: "2026-10-03", sessionDuration: 50,
  listPrice: 2000000, price: 2000000, paidAmount: 1000000, paymentMethod: "card", createdAt: new Date("2026-10-03T14:00:00+09:00").getTime() };
products.push(P);
const fp2 = N.firstPurchaseMap(products);
const before = { oct: newStats("2026-10", []), nov: newStats("2026-11", []) };
const col = (id: string, amount: number, date: string, extra: any = {}) => ({ id, productId: "px", amount, paidDate: date, paymentMethod: "transfer", requestId: id, createdAt: `${date}T10:00:00+09:00`, cancelledAt: null, cancelReason: null, ...extra });
const cols = [col("k1", 1000000, "2026-11-04")];
const S = (key: string, c: any) => { const s = N.summarizePayments(N.buildPaymentRows(products, customers, N.monthRange(key), transferIds, fp2, c)); return s; };
const day = (d: string, c: any) => N.summarizePayments(N.buildPaymentRows(products, customers, { start: d, end: d }, transferIds, fp2, c));
show("(1) 10월 매출은 잔금 전후 그대로", S("2026-10", cols).totalAmount === S("2026-10", []).totalAmount, `${S("2026-10", []).totalAmount} → ${S("2026-10", cols).totalAmount}`);
show("(1) 10월 3일 매출은 처음 결제 100만 그대로", day("2026-10-03", cols).totalAmount - day("2026-10-03", []).totalAmount === 0 && N.buildPaymentRows(products, customers, { start: "2026-10-03", end: "2026-10-03" }, transferIds, fp2, cols).find((r) => r.id === "px")!.paid === 1000000);
show("(1) 11월 4일 매출 +100만", day("2026-11-04", cols).totalAmount - day("2026-11-04", []).totalAmount === 1000000, `${day("2026-11-04", []).totalAmount} → ${day("2026-11-04", cols).totalAmount}`);
show("(1) 11월 월간 +100만", S("2026-11", cols).totalAmount - S("2026-11", []).totalAmount === 1000000);
show("(1) 미수금 100만 → 0 (완납)", N.unpaidOf(P, N.collectedByProduct([])) === 1000000 && N.unpaidOf(P, N.collectedByProduct(cols)) === 0);
show("(1) 10월 판매금액(판매가 합)은 원래 판매일 그대로", N.buildPaymentRows(products, customers, N.monthRange("2026-10"), transferIds, fp2, cols).filter((r) => r.kind !== "collection").reduce((s, r) => s + r.price, 0) === N.buildPaymentRows(products, customers, N.monthRange("2026-10"), transferIds, fp2, []).reduce((s, r) => s + r.price, 0));

// ---- (2) 같은 기간이면 일일/주간/월간·통계분석·매출 계획이 같은 숫자 ----
const nov = S("2026-11", cols);
const novDays = Array.from({ length: 30 }, (_, i) => day(addDays("2026-11-01", i), cols).totalAmount).reduce((a, b) => a + b, 0);
const weekStart = "2026-11-02"; // 월요일
const weekRows = N.buildPaymentRows(products, customers, { start: weekStart, end: addDays(weekStart, 6) }, transferIds, fp2, cols);
const weekSum = N.summarizePayments(weekRows).totalAmount;
const weekDaily = N.dailyTotals(weekRows, weekStart, 7).reduce((s, d) => s + d.amount, 0);
const weekByDays = Array.from({ length: 7 }, (_, i) => day(addDays(weekStart, i), cols).totalAmount).reduce((a, b) => a + b, 0);
const statsNov = N.summarizePayments(N.buildPaymentRows(products, [], N.monthRange("2026-11"), new Set(), fp2, cols)).totalAmount;
const fcMap: Record<string, number> = {}; N.buildPaymentRows(products, [], N.monthRange("2026-11"), new Set(), fp2, cols).forEach((r) => (fcMap[r.customerId] = (fcMap[r.customerId] || 0) + r.paid));
const fcTotal = Object.values(fcMap).reduce((a, b) => a + b, 0);
show("(2) 11월: 월간 = 일일 합 = 통계분석 = 매출 계획(고객 합)", nov.totalAmount === novDays && nov.totalAmount === statsNov && nov.totalAmount === fcTotal, `${nov.totalAmount} / ${novDays} / ${statsNov} / ${fcTotal}`);
show("(2) 11/2~8 주간: 주간 합계 = 요일별 합 = 일일 합", weekSum === weekDaily && weekSum === weekByDays, `${weekSum} / ${weekDaily} / ${weekByDays}`);
show("(2) 매출 계획: 홍길동(c1)의 11월 실제 등록금액에 잔금 100만 포함", fcMap["c1"] - (newForecast("2026-11", [])["c1"].actual) === 1000000);

// ---- (7) 신규/재등록 건수·인원은 잔금으로 늘지 않음 ----
const n0 = S("2026-11", []), n1 = S("2026-11", cols);
show("(7) 11월 건수·인원·신규·재등록 그대로, 잔금은 따로 1건",
  n0.totalCount === n1.totalCount && n0.totalPeople === n1.totalPeople && n0.newCount === n1.newCount && n0.newPeople === n1.newPeople && n0.renewCount === n1.renewCount && n0.renewPeople === n1.renewPeople && n0.newAmount === n1.newAmount && n0.renewAmount === n1.renewAmount && n1.collectionCount === 1 && n1.collectionAmount === 1000000,
  `건수 ${n0.totalCount}→${n1.totalCount}, 인원 ${n0.totalPeople}→${n1.totalPeople}, 잔금 ${n1.collectionCount}건`);
show("(7) 주간 요일별 '건수'에도 잔금은 안 셈", N.dailyTotals(weekRows, weekStart, 7).find((d) => d.date === "2026-11-04")!.count === N.dailyTotals(N.buildPaymentRows(products, customers, { start: weekStart, end: addDays(weekStart, 6) }, transferIds, fp2, []), weekStart, 7).find((d) => d.date === "2026-11-04")!.count);

// ---- (5) 결제 취소 → 매출에서 빠지고 미수금 다시, 기록은 남음 ----
const cancelled = [col("k1", 1000000, "2026-11-04", { cancelledAt: "2026-11-04T12:00:00+09:00", cancelReason: "금액 잘못 입력" })];
show("(5) 취소하면 11/4 매출에서 빠짐", day("2026-11-04", cancelled).totalAmount === day("2026-11-04", []).totalAmount);
show("(5) 취소하면 미수금 100만 다시", N.unpaidOf(P, N.collectedByProduct(cancelled)) === 1000000);
show("(5) 취소된 기록은 목록(이력용 데이터)에 그대로 1건", cancelled.length === 1 && N.activeCollections(cancelled).length === 0);

// ---- (6) 판매 건 삭제(보관) → 잔금도 빠짐, 복구 → 돌아옴 ----
const activeProducts = products.filter((p) => p.id !== "px"); // 화면은 보관된 이용권을 products에서 뺀다
const dayDeleted = N.summarizePayments(N.buildPaymentRows(activeProducts, customers, { start: "2026-11-04", end: "2026-11-04" }, transferIds, fp2, cols)).totalAmount;
show("(6) 삭제하면 잔금도 11/4 매출에서 빠짐", dayDeleted === day("2026-11-04", []).totalAmount);
show("(6) 복구하면 잔금이 돌아옴", day("2026-11-04", cols).totalAmount === day("2026-11-04", []).totalAmount + 1000000);

// ---- 지난 달(10월 이전)은 잔금이 생겨도 1원도 안 바뀜 ----
let pastDiff = 0; const unpaidMoved: string[] = [];
for (const key of months.filter((m) => m < "2026-11")) {
  const { unpaidAmount: ua, unpaidCount: uc, ...a } = S(key, []); const { unpaidAmount: ub, unpaidCount: ucb, ...b } = S(key, cols);
  if (!same(a, b)) pastDiff++;
  if (ua !== ub || uc !== ucb) unpaidMoved.push(`${key}: 미수금 ${ua}→${ub}, ${uc}건→${ucb}건`);
}
show("(8) 잔금을 받아도 2019-01 ~ 2026-10 월별 결제금액·건수·인원·신규/재등록 불변", pastDiff === 0, `차이 ${pastDiff}개월`);
show("(결정 2) 바뀐 것은 잔금 받은 판매 건이 있는 달의 '지금 남은 미수금' 카드뿐", unpaidMoved.length === 1 && unpaidMoved[0].startsWith("2026-10"), unpaidMoved.join(" / "));

console.log(`\n합계: PASS ${pass} / FAIL ${fail}`);
if (fail) process.exit(1);
