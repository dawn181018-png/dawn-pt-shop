import { sessionCountInName as f, nameSessionMismatch as m } from "@/lib/productUtils";
const cases: [string, number | null][] = [["PT 20회", 20], ["half 20", 20], ["Premium Conditioning 20s", 20], ["하프 PT 20 회", 20], ["50분 PT 10회", 10], ["3개월 PT 24", 24], ["PT 50회(양도)", 50], ["필라테스", null], ["2026 PT 30회", 30], ["30% 할인 PT", null], ["10만원 PT", null], ["PT 1000", null]];
let fail = 0;
for (const [n, want] of cases) { const got = f(n); const ok = got === want; if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", JSON.stringify(n), "→", got); }
const w = [["half 20", 10, 20], ["PT 20회", 20, null], ["PT 50회", 0, null], ["필라테스", 10, null]] as const;
for (const [n, s, want] of w) { const got = m(n, s); const ok = got === want; if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", `경고(${n}, 저장 ${s}회) →`, got); }
console.log(fail ? `FAIL ${fail}` : "모두 통과"); process.exit(fail ? 1 : 0);
