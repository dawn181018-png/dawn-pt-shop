import * as T from "@/lib/trainers";
import * as S from "@/lib/delegateSettlement";
let pass = 0, fail = 0;
const show = (l: string, ok: boolean, d = "") => { ok ? pass++ : fail++; console.log(ok ? "PASS" : "FAIL", l, d); };
const dl = (id: string, name: string, email: string, createdAt: number, customers: string[], revoked = false) => ({ id, delegateName: name, delegateEmail: email, customerIds: customers, startsOn: "2026-10-08", endsOn: null, revokedAt: revoked ? "x" : null, delegateUserId: null, createdAt });
const delegations: any[] = [dl("d1", "장재혁", "Jang@test.com", 1, ["c1"]), dl("d2", "박코치", "park@test.com", 2, ["c2"]), dl("d3", "장재혁", "jang@test.com", 3, ["c3"]), dl("d4", "옛트레이너", "old@test.com", 0, ["c1"], true)];
const opts = T.trainerOptions(delegations);
show("목록: 대표 + 트레이너(같은 이메일은 한 명), 색 순서는 처음 지정 순", opts.map((o) => `${o.name}:${o.colorIdx}`).join(",") === "대표(나):null,옛트레이너:0,장재혁:1,박코치:2", opts.map((o) => `${o.name}:${o.colorIdx}`).join(","));
show("해제된 트레이너는 예약창 목록에서 빠짐(active=false)", opts.find((o) => o.key === "old@test.com")!.active === false);
const byId = T.delegationEmailMap(delegations);
const R = (x: any) => ({ id: "r", customerId: "c1", productId: "p", seriesId: null, date: "2026-11-10", time: "10:00", duration: 50, status: "scheduled", type: "pt", trainerEmail: null, delegationId: null, ...x });
const existing = [R({ id: "e1" }), R({ id: "e2", time: "11:00" }), R({ id: "e3", time: "12:00" }), R({ id: "e4", date: "2026-11-11" }), R({ id: "e5", date: "2026-11-12" })];
show("기존 예약 5건(담당자 비어 있음) → 모두 대표", existing.every((r) => T.trainerKeyOf(r, byId) === "owner"));
show("담당자 비어 있고 대리 기록만 있는 예전 레슨 → 그 트레이너(지금처럼)", T.trainerKeyOf(R({ delegationId: "d1" }), byId) === "jang@test.com");
show("담당자 'owner'면 대리 기록이 있어도 대표", T.trainerKeyOf(R({ trainerEmail: "owner", delegationId: "d1" }), byId) === "owner");
const jang = opts.find((o) => o.key === "jang@test.com")!;
const a1 = T.trainerAssignment(jang, "c3"); const a2 = T.trainerAssignment(jang, "c9"); const a3 = T.trainerAssignment(opts.find((o) => o.key === "old@test.com")!, "c1");
show("배정: 이 고객을 맡은 지정이 있으면 그 지정으로", a1.kind === "ok" && a1.fields.delegationId === "d3" && a1.fields.trainerEmail === "jang@test.com");
show("배정: 대상이 아닌 고객이면 '추가할까요?' 필요", a2.kind === "needsAdd" && a2.delegation.id === "d3");
show("배정: 해제된 트레이너는 불가", a3.kind === "unavailable");
show("배정: 대표", (() => { const a = T.trainerAssignment(opts[0], "c1"); return a.kind === "ok" && a.fields.trainerEmail === "owner" && a.fields.delegationId === null; })());
const all = [R({ id: "x1", time: "10:00", trainerEmail: "owner" }), R({ id: "x2", time: "10:00", trainerEmail: "jang@test.com", delegationId: "d1" }), R({ id: "x3", time: "10:30", status: "cancelled", trainerEmail: "owner" }), { ...R({ id: "x4", time: "14:00" }), type: "misc" }];
show("겹침: 대표 10:20 → 대표 10:00 레슨과 겹침(취소된 건 제외)", T.trainerConflicts([{ date: "2026-11-10", time: "10:20", duration: 50 }], "owner", all as any, byId).map((r) => r.id).join() === "x1");
show("겹침: 장재혁 10:20 → 장재혁 10:00과만 겹침(대표 레슨은 상관없음)", T.trainerConflicts([{ date: "2026-11-10", time: "10:20", duration: 50 }], "jang@test.com", all as any, byId).map((r) => r.id).join() === "x2");
show("겹침: 박코치 10:00 → 다른 강사끼리는 허용(0건)", T.trainerConflicts([{ date: "2026-11-10", time: "10:00", duration: 50 }], "park@test.com", all as any, byId).length === 0);
show("겹침: 10:50 시작은 10:00~10:50과 안 겹침(끝나는 시각과 같음)", T.trainerConflicts([{ date: "2026-11-10", time: "10:50", duration: 50 }], "owner", all as any, byId).length === 0);
show("겹침: 기타 일정(14:00)은 대표 일정으로 봄", T.trainerConflicts([{ date: "2026-11-10", time: "14:10", duration: 30 }], "owner", all as any, byId).map((r) => r.id).join() === "x4");
show("겹침: 수정 중인 자기 자신은 제외", T.trainerConflicts([{ date: "2026-11-10", time: "10:00", duration: 50 }], "owner", all as any, byId, new Set(["x1"])).length === 0);
// 정산 연결
const res: any[] = [
  R({ id: "s1", status: "done", trainerEmail: "jang@test.com", delegationId: "d1", delegateName: "장재혁", signatureUrl: "o/own.png" }),    // 담당자 장재혁, 대표 폰으로 완료 → 장재혁 정산
  R({ id: "s2", status: "scheduled", trainerEmail: "jang@test.com", delegationId: "d1", delegateName: "장재혁" }),                       // 예정 → 정산 대상 아님
  R({ id: "s3", status: "done", trainerEmail: "owner", delegationId: "d1", delegateName: "장재혁", signatureUrl: "o/delegated/x.png" }), // 대표 담당 → 제외
  R({ id: "s4", status: "done", trainerEmail: "jang@test.com", delegationId: null, delegateName: null, customerId: "c9" }),            // 담당자로만 연결
  R({ id: "s5", status: "done", trainerEmail: null, delegationId: "d1", delegateName: "장재혁", signatureUrl: "o/delegated/y.png" }),     // 예전 방식(미지정+대리 서명) 그대로
  R({ id: "s6", status: "done", trainerEmail: "park@test.com", delegationId: "d2", delegateName: "박코치" }),                            // 다른 강사
];
const st = S.buildSettlement({ reservations: res, delegationIds: jang.delegations.reduce((s, d) => s.add(d.id), new Set<string>()), trainerEmail: "jang@test.com", month: "2026-11", products: [{ id: "p", type: "session", totalSessions: 10, price: 1000000, listPrice: 1000000, name: "PT 10회" } as any], customerNameOf: () => "고객", transferRecipientIds: new Set(), firstDay: "2026-10-08", settings: { ...S.defaultSettlementSettings, perLesson: 30000 } });
const ids = st.lessons.map((l) => `${l.id}${l.eligible ? "+" : "-"}`).join(",");
show("정산: 장재혁 담당 완료(s1·s4)와 예전 대리(s5)는 대상, 대표 담당(s3)·다른 강사(s6)·예정(s2)은 제외", ids === "s1+,s4+,s5+", ids);
show("정산 금액 계산은 그대로: 3회 × 30,000 = 90,000", st.total === 90000);
show("서명 시트 담당 표시: 담당자 장재혁 → 대리, 'owner' → 본인", S.classifyLesson(res[0], "2026-10-08").kind === "delegate" && S.classifyLesson(res[2], "2026-10-08").kind === "owner");
console.log(`\n합계: PASS ${pass} / FAIL ${fail}`); if (fail) process.exit(1);
