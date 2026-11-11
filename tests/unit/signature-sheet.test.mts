import * as S from "@/lib/signatureSheet";
let pass = 0, fail = 0;
const show = (l: string, ok: boolean, d = "") => { ok ? pass++ : fail++; console.log(ok ? "PASS" : "FAIL", l, d); };
const P = (id: string, total: number, used: number, x: any = {}) => ({ id, customerId: "c1", name: `PT ${total}회`, type: "session", totalSessions: total, usedSessions: used, price: 0, listPrice: 0, paidAmount: 0, paymentMethod: "card", startDate: "2026-01-01", sessionDuration: 50, createdAt: 1, ...x });
const day = (i: number) => { const d = new Date(Date.UTC(2026, 0, 5) + i * 86400000); return d.toISOString().slice(0, 10); };
const L = (pid: string, i: number, status = "done", x: any = {}) => ({ id: `${pid}-${i}`, customerId: "c1", productId: pid, seriesId: null, date: day(i), time: "10:00", duration: 50, status, type: "pt", signatureUrl: status === "done" ? `o/${pid}-${i}-1.png` : null, ...x });
const today = "2026-11-05";
// (1) 50회권 32회 사용
const r50 = Array.from({ length: 32 }, (_, i) => L("p50", i, i === 10 ? "noshow" : "done", i === 20 ? { signatureUrl: null } : {}));
r50.push(L("p50", 33, "cancelled")); // 취소는 칸 없음
r50.push({ ...L("p50", 300, "scheduled"), date: "2026-11-20" });
const s50 = S.buildSheet(P("p50", 50, 32) as any, r50 as any, [], today);
const [left, right] = S.splitColumns(s50.pages[0]);
show("(1) 50회권: 한 장, 왼쪽 25칸·오른쪽 25칸", s50.pages.length === 1 && left.length === 25 && right.length === 25);
show("(1) 1~32회차 레슨, 33회차는 예정, 34~50 빈칸(번호만)", s50.cells.slice(0, 32).every((c) => c.kind === "lesson") && s50.cells[32].kind === "scheduled" && s50.cells.slice(33).every((c) => c.kind === "empty") && s50.cells.map((c) => c.no).join() === Array.from({ length: 50 }, (_, i) => i + 1).join(), `빈칸 ${s50.cells.filter((c) => c.kind === "empty").length}`);
show("(1) 사용 32 / 남은 18 / 총 50, 취소는 칸에서 제외", s50.used === 32 && s50.remain === 18 && s50.total === 50 && s50.lessonCount === 32 && !s50.mismatch);
show("(4) 노쇼·서명 없음 레슨도 칸 차지(11회차 노쇼, 21회차 서명 없음)", (s50.cells[10] as any).r.status === "noshow" && (s50.cells[20] as any).r.signatureUrl === null);
// (2) 100회권 → 2장
const s100 = S.buildSheet(P("p100", 100, 60) as any, Array.from({ length: 60 }, (_, i) => L("p100", i)) as any, [], today);
show("(2) 100회권: 2장, 1~50 / 51~100", s100.pages.length === 2 && s100.pages[0][0].no === 1 && s100.pages[0][49].no === 50 && s100.pages[1][0].no === 51 && s100.pages[1][49].no === 100);
show("(2) 2장째 왼쪽 51~75, 오른쪽 76~100", S.splitColumns(s100.pages[1])[0].at(-1)!.no === 75 && S.splitColumns(s100.pages[1])[1][0].no === 76);
// (3) 30회권
const s30 = S.buildSheet(P("p30", 30, 5) as any, Array.from({ length: 5 }, (_, i) => L("p30", i)) as any, [], today);
const [l30, r30] = S.splitColumns(s30.pages[0]);
show("(3) 30회권: 30칸만, 왼쪽 25 + 오른쪽 5", s30.cells.length === 30 && l30.length === 25 && r30.length === 5 && r30[0].no === 26);
// 다른 이용권 레슨은 섞이지 않음
show("이용권 연결 기준: 다른 이용권 레슨은 안 들어감", S.buildSheet(P("p30", 30, 5) as any, [...r50, ...Array.from({ length: 5 }, (_, i) => L("p30", i))] as any, [], today).lessonCount === 5);
// 기록 없는 사용(직접 조정) → 앞쪽
const sUn = S.buildSheet(P("pu", 20, 8) as any, Array.from({ length: 5 }, (_, i) => L("pu", i)) as any, [], today);
show("사용 8 · 레슨 5 → 앞 3칸 '기록 없는 사용', 4~8 레슨(스케줄 카드 번호와 같음)", sUn.cells.slice(0, 3).every((c) => c.kind === "unrecorded") && sUn.cells.slice(3, 8).every((c) => c.kind === "lesson") && !!sUn.mismatch);
// 양도: 날짜 자리에
const tr = [{ id: "t", sourceProductId: "pt", sourceCustomerId: "c1", recipientCustomerId: "c2", recipientProductId: "x", sessionsTransferred: 3, amount: 0, paymentMethod: "card", createdAt: new Date("2026-01-08T12:00:00+09:00").getTime() }];
const sTr = S.buildSheet(P("pt", 20, 8) as any, Array.from({ length: 5 }, (_, i) => L("pt", i)) as any, tr as any, today);
show("양도 3회: 1/8 넘긴 날짜 자리에 '양도' 칸(레슨 1/5~1/8 뒤, 1/9 앞)", sTr.cells.map((c) => c.kind[0]).join("").startsWith("llllttt") && sTr.cells[7].kind === "lesson" && sTr.unrecorded === 0, sTr.cells.slice(0, 9).map((c) => c.kind).join(","));
// 기록이 사용보다 많음
const sOv = S.buildSheet(P("po", 10, 3) as any, Array.from({ length: 5 }, (_, i) => L("po", i)) as any, [], today);
show("레슨 5 > 사용 3: 레슨 모두 표시 + 안내", sOv.lessonCount === 5 && sOv.cells.slice(0, 5).every((c) => c.kind === "lesson") && (sOv.mismatch || "").includes("많아요"));
// 총 횟수 초과
const sX = S.buildSheet(P("px", 10, 12) as any, Array.from({ length: 12 }, (_, i) => L("px", i)) as any, [], today);
show("총 10회인데 12회 사용: 12칸까지 표시 + 안내", sX.capacity === 12 && sX.overTotal);
show("기본 이용권: 잔여 남은 것 중 먼저 산 것", S.defaultSheetProductId([P("a", 10, 10, { createdAt: 1 }), P("b", 10, 3, { createdAt: 2 }), P("c", 10, 0, { createdAt: 3 }), P("d", 10, 0, { createdAt: 0, archivedAt: "x" })] as any) === "b");
show("파일 이름", S.sheetFileName("홍길동", "PT 50회", "2026-11-05") === "서명시트_홍길동_PT50회_2026-11-05" && S.sheetFileName("홍길동", "PT 100회", "2026-11-05", { no: 2, of: 2 }) === "서명시트_홍길동_PT100회_2026-11-05_2of2");
console.log(`\n합계: PASS ${pass} / FAIL ${fail}`); if (fail) process.exit(1);
