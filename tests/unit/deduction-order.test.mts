// 차감 순서 회귀 시험: "먼저 등록한 이용권부터, 다 쓰면 다음 이용권" (2026-11-10 대표 요청).
import { earliestUsableProduct } from "@/lib/productUtils";
let pass = 0, fail = 0;
const show = (l: string, ok: boolean, d = "") => { ok ? pass++ : fail++; console.log(ok ? "PASS" : "FAIL", l, d); };
const P = (id: string, created: string, total: number, used: number, x: any = {}) => ({ id, customerId: "c1", name: id, type: "session", totalSessions: total, usedSessions: used, createdAt: new Date(`${created}T00:00:00+09:00`).getTime(), ...x });
const list: any[] = [P("late", "2026-08-19", 50, 0), P("early", "2026-08-18", 50, 26), P("done", "2026-03-20", 50, 50), P("del", "2026-01-01", 10, 0, { archivedAt: "x" }), { ...P("period", "2025-01-01", 0, 0), type: "period" }, P("other", "2025-01-01", 10, 0, { customerId: "c2" })];
show("잔여 있는 것 중 먼저 등록한 이용권(8/18)", earliestUsableProduct("c1", list)?.id === "early");
show("레슨이 나중 이용권(8/19)에 묶여 있어도 먼저 이용권", earliestUsableProduct("c1", list, "late")?.id === "early");
show("다 쓴 이용권·삭제된 이용권·기간권·다른 고객 이용권은 건너뜀", !["done", "del", "period", "other"].includes(earliestUsableProduct("c1", list)?.id || ""));
const usedUp = list.map((p) => (p.id === "early" ? { ...p, usedSessions: 50 } : p));
show("먼저 이용권을 다 쓰면 다음 이용권(8/19)", earliestUsableProduct("c1", usedUp)?.id === "late");
show("잔여 있는 이용권이 없으면 없음", earliestUsableProduct("c1", usedUp.map((p) => ({ ...p, usedSessions: p.totalSessions }))) === undefined);
const sameDay = [P("b", "2026-05-01", 10, 0), P("a", "2026-05-01", 10, 0)];
show("같은 날 등록이면 지금 묶인 이용권 먼저", earliestUsableProduct("c1", sameDay, "b")?.id === "b");
show("같은 날 등록·묶인 것 없음이면 id 순(항상 같은 결과)", earliestUsableProduct("c1", sameDay)?.id === "a");
console.log(`\n합계: PASS ${pass} / FAIL ${fail}`); if (fail) process.exit(1);
