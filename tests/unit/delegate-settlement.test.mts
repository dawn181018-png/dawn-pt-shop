import * as S from "@/lib/delegateSettlement";
let pass = 0, fail = 0;
const show = (label: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(ok ? "PASS" : "FAIL", label, detail); };
const D1 = "d1", D2 = "d2", Dother = "dx";
const delegations: any[] = [
  { id: D1, delegateName: "장재혁", delegateEmail: "Jang@test.com", customerIds: ["c1"], startsOn: "2026-10-08", endsOn: null, revokedAt: null, createdAt: 1 },
  { id: D2, delegateName: "장재혁", delegateEmail: "jang@test.com", customerIds: ["c2"], startsOn: "2026-11-01", endsOn: null, revokedAt: null, createdAt: 2 },
  { id: Dother, delegateName: "박코치", delegateEmail: "park@test.com", customerIds: ["c1"], startsOn: "2026-10-20", endsOn: null, revokedAt: null, createdAt: 3 },
];
const products: any[] = [
  { id: "p1", customerId: "c1", name: "PT 50회", type: "session", totalSessions: 50, usedSessions: 10, price: 2500000, listPrice: 2500000 },
  { id: "p2", customerId: "c2", name: "PT 10회", type: "session", totalSessions: 10, usedSessions: 1, price: 900000, listPrice: 1000000 }, // 할인
  { id: "p3", customerId: "c2", name: "PT 5회(양도)", type: "session", totalSessions: 5, usedSessions: 0, price: 0, listPrice: 0 },
];
const res = (id: string, date: string, time: string, status: string, extra: any = {}) => ({ id, customerId: "c1", productId: "p1", seriesId: null, date, time, duration: 50, status, type: "pt", delegationId: D1, delegateName: "장재혁", signatureUrl: status === "done" ? `own/delegated/${id}-1762240000000.png` : null, ...extra });
const reservations: any[] = [
  res("a", "2026-11-01", "07:00", "done"),                      // 월초 경계
  res("b", "2026-11-12", "10:00", "done", { customerId: "c2", productId: "p2", delegationId: D2 }),
  res("c", "2026-11-30", "21:00", "done"),                      // 월말 경계
  res("d", "2026-11-12", "11:00", "noshow"),
  res("e", "2026-11-20", "09:00", "cancelled"),
  res("f", "2026-10-31", "20:00", "done"),                      // 전달 — 빠져야 함
  res("g", "2026-12-01", "07:00", "done"),                      // 다음달 — 빠져야 함
  res("h", "2026-11-15", "10:00", "done", { signatureUrl: "own/h-1762240000000.png" }), // 대리 예약·관리자 서명 → 확인 필요
  res("i", "2026-11-16", "10:00", "done", { delegationId: Dother, delegateName: "박코치" }), // 다른 트레이너
  res("j", "2026-11-17", "10:00", "done", { delegationId: null, delegateName: null, signatureUrl: "own/j-1.png" }), // 본인
  res("k", "2026-11-18", "10:00", "scheduled"),                  // 예정 — 목록 제외
  { ...res("m", "2026-11-19", "10:00", "done"), type: "misc" },  // 기타 일정 제외
];
const trainers = S.delegateTrainers(delegations as any);
const jang = trainers.find((t) => t.email === "jang@test.com")!;
show("트레이너: 같은 이메일(대소문자 무시) 지정 2건은 한 사람", trainers.length === 2 && jang.delegationIds.size === 2);
const firstDay = S.firstDelegationDay(delegations as any);
const names = (id: string | null) => ({ c1: "김철수", c2: "이영희" } as any)[id || ""] || "-";
const base = { reservations, delegationIds: jang.delegationIds, month: "2026-11", products, customerNameOf: names, transferRecipientIds: new Set(["p3"]), firstDay };
const run = (settings: Partial<S.SettlementSettings>) => S.buildSettlement({ ...base, settings: { ...S.defaultSettlementSettings, ...settings } });

// (1) 횟수·목록
let r = run({ mode: "fixed", perLesson: 30000 });
show("(1) 완료 3 · 노쇼 1 · 취소 1 · 확인 필요 1", r.counts.done === 3 && r.counts.noshow === 1 && r.counts.cancelled === 1 && r.counts.check === 1, JSON.stringify(r.counts));
show("(1) 월초 11/1 07:00, 월말 11/30 21:00 포함 · 10/31·12/1·예정·기타일정·다른 트레이너 제외", r.lessons.map((l) => l.id).join(",") === "a,b,d,h,e,c", r.lessons.map((l) => l.id).join(","));
show("(1) 날짜순 정렬", r.lessons.every((l, i, a) => i === 0 || (a[i - 1].date + a[i - 1].time) <= (l.date + l.time)));
// (2) 회당 금액 × 횟수 + 조정
show("(2) 정산 대상 3회 × 30,000 = 90,000", r.counts.eligible === 3 && r.lessonAmount === 90000 && r.total === 90000, `${r.counts.eligible}회 ${r.lessonAmount}`);
r = run({ mode: "fixed", perLesson: 30000, adjustments: [{ amount: 15000, memo: "교통비" }, { amount: -5000, memo: "지각" }] });
show("(2) 조정 +15,000 −5,000 → 합계 100,000", r.adjustTotal === 10000 && r.total === 100000, `${r.total}`);
// (3) 노쇼 스위치
const on = run({ mode: "fixed", perLesson: 30000, includeNoshow: true }), off = run({ mode: "fixed", perLesson: 30000, includeNoshow: false });
show("(3) 노쇼 켜면 4회 120,000 / 끄면 3회 90,000", on.counts.eligible === 4 && on.total === 120000 && off.counts.eligible === 3 && off.total === 90000, `${on.counts.eligible}/${on.total} ${off.counts.eligible}/${off.total}`);
// 확인 필요 체크
const chk = run({ mode: "fixed", perLesson: 30000, includedCheckIds: ["h"] });
show("확인 필요 건은 체크해야만 포함 (3→4회)", chk.counts.eligible === 4 && chk.total === 120000);
show("취소는 어떤 설정에서도 지급 대상 아님", [on, off, chk].every((x) => !x.lessons.find((l) => l.id === "e")!.eligible));
// 비율 방식
const rate = run({ mode: "rate", ratePct: 40 });
const la = rate.lessons.find((l) => l.id === "a")!, lb = rate.lessons.find((l) => l.id === "b")!;
show("비율: 2,500,000÷50=50,000 × 40% = 20,000 근거 표시", la.amount === 20000 && la.basis === "50,000원 × 40% = 20,000원", la.basis);
show("비율: 할인 판매 이용권은 '할인 판매' 표시 + 90,000×40%=36,000", lb.unitIssue === "할인 판매" && lb.amount === 36000, `${lb.unitIssue} ${lb.amount}`);
const rate2 = S.buildSettlement({ ...base, reservations: [...reservations, res("t", "2026-11-21", "10:00", "done", { customerId: "c2", productId: "p3", delegationId: D2 })], settings: { ...S.defaultSettlementSettings, mode: "rate", ratePct: 40 } });
const lt = rate2.lessons.find((l) => l.id === "t")!;
show("비율: 양도받은 이용권은 단가 불명확 → 0원 + 직접 입력 필요", lt.unitPrice === null && lt.unitIssue === "양도받은 이용권" && lt.amount === 0 && lt.basis.includes("직접 입력"));
const rate3 = S.buildSettlement({ ...base, reservations: [...reservations, res("t", "2026-11-21", "10:00", "done", { customerId: "c2", productId: "p3", delegationId: D2 })], settings: { ...S.defaultSettlementSettings, mode: "rate", ratePct: 40, manualAmounts: { t: 25000 } } });
show("비율: 직접 입력 25,000 반영", rate3.lessons.find((l) => l.id === "t")!.amount === 25000 && rate3.total === rate2.total + 25000);
show("금액은 원 단위 정수", [r, on, rate, rate3].every((x) => Number.isInteger(x.total) && x.lessons.every((l) => Number.isInteger(l.amount))));
// (4) 확정 후 변경 감지 (확정된 숫자 고정은 화면이 snapshot을 보여주는 방식 — 여기서는 감지 문구)
const snap = run({ mode: "fixed", perLesson: 30000 });
const after = S.buildSettlement({ ...base, reservations: [...reservations.map((x) => (x.id === "a" ? { ...x, status: "cancelled", signatureUrl: x.signatureUrl } : x)), res("n", "2026-11-25", "10:00", "done")], settings: { ...S.defaultSettlementSettings, mode: "fixed", perLesson: 30000 } });
const ch = S.settlementChanges(snap.lessons, after.lessons);
show("(4) 확정 뒤 레슨 추가·취소 감지", snap.fingerprint !== after.fingerprint && ch.some((c) => c.startsWith("추가됨")) && ch.some((c) => c.startsWith("상태 변경")), ch.join(" / "));
show("(4) 확정된 숫자(snapshot)는 그대로", snap.total === 90000 && snap.counts.eligible === 3);
show("(4) 변경 없으면 감지 없음", S.settlementChanges(snap.lessons, run({ mode: "fixed", perLesson: 30000 }).lessons).length === 0);
// 기록 상태
const rec = (action: string, at: string, extra: any = {}) => ({ id: at, month: "2026-11", delegateEmail: "jang@test.com", delegateName: "장재혁", action, lessonCount: 3, totalAmount: 90000, snapshot: null, paidOn: null, memo: null, createdAt: at, ...extra });
let st = S.settlementState([rec("confirm", "1"), rec("paid", "2", { paidOn: "2026-12-05" })] as any);
show("기록: 확정 → 지급 완료", !!st.confirmed && !!st.paid && st.paid.paidOn === "2026-12-05");
st = S.settlementState([rec("confirm", "1"), rec("paid", "2"), rec("unconfirm", "3"), rec("confirm", "4", { totalAmount: 120000 })] as any);
show("기록: 해제 후 재확정 → 최신 확정, 지급 표시는 초기화, 이력 4건 보존", st.confirmed!.totalAmount === 120000 && !st.paid && st.history.length === 4);
// (7) 이름 가리기
show("(7) 이름 가리기 김철수→김○○, 남궁민수→남○○○, 이→이○", S.maskName("김철수") === "김○○" && S.maskName("남궁민수") === "남○○○" && S.maskName("이") === "이○", `${S.maskName("김철수")} ${S.maskName("남궁민수")} ${S.maskName("이")}`);
// 담당 분류
const cls = (x: any) => S.classifyLesson(x, firstDay).kind;
show("분류: 대리 폴더 서명=대리 / 관리자 서명=확인 필요 / 서명 없음=확인 필요 / 기록 없음(10/8 이후)=본인 / 10/8 이전=구분 없음",
  cls(res("x", "2026-11-01", "1", "done")) === "delegate" && cls(res("x", "2026-11-01", "1", "done", { signatureUrl: "own/x-1.png" })) === "check"
  && cls(res("x", "2026-11-01", "1", "done", { signatureUrl: null })) === "check"
  && cls({ date: "2026-10-08", status: "done", delegationId: null, delegateName: null, signatureUrl: "own/x.png" }) === "owner"
  && cls({ date: "2026-10-07", status: "done", delegationId: null, delegateName: null, signatureUrl: "own/x.png" }) === "unknown");
show("월 경계: 2월·12월 말일", JSON.stringify(S.monthBounds("2028-02")) === '{"start":"2028-02-01","end":"2028-02-29"}' && S.monthBounds("2026-12").end === "2026-12-31");
console.log(`\n합계: PASS ${pass} / FAIL ${fail}`); if (fail) process.exit(1);
