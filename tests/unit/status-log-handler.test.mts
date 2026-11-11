import * as S from "@/lib/delegateSettlement";
let pass = 0, fail = 0;
const show = (l: string, ok: boolean, d = "") => { ok ? pass++ : fail++; console.log(ok ? "PASS" : "FAIL", l, d); };
const R = (id: string, status: string, x: any = {}) => ({ id, customerId: "c1", productId: "p1", seriesId: null, date: "2026-11-10", time: "10:00", duration: 50, status, type: "pt", delegationId: "d1", delegateName: "장재혁", signatureUrl: null, ...x });
const log = (id: string, newStatus: string, actorRole: any, at = "2026-11-10T01:00:00Z") => ({ id: "l" + id + at, reservationId: id, oldStatus: "scheduled", newStatus, actorRole, actorName: actorRole === "delegate" ? "장재혁" : null, delegationId: null, changedAt: at });
const logs = S.latestStatusLogs([
  log("a", "done", "delegate"),                     // 대리가 완료(서명 없음이어도)
  log("b", "done", "owner"),                        // 대리 예약 · 관리자 완료
  log("c", "done", "delegate"), log("c", "cancelled", "owner", "2026-11-10T02:00:00Z"), // 마지막 기록이 우선
  log("e", "noshow", "owner"),                      // 관리자가 노쇼 처리
]);
const fd = "2026-10-08";
show("기록: 대리가 서명 없이 완료 → 대리 진행(예전엔 확인 필요)", S.classifyLesson(R("a", "done"), fd, logs.get("a")).kind === "delegate" && S.classifyLesson(R("a", "done"), fd).kind === "check");
const hb = S.classifyLesson(R("b", "done", { signatureUrl: "u/own.png" }), fd, logs.get("b"));
show("기록: 대리 예약 · 관리자 완료 → 본인(메모에 대리 이름)", hb.kind === "owner" && (hb.note || "").includes("장재혁"), hb.note || "");
show("기록: 마지막 기록(관리자 취소)이 우선", S.classifyLesson(R("c", "cancelled"), fd, logs.get("c")).kind === "owner");
show("기록이 지금 상태와 다르면 예전 기준 사용", S.classifyLesson(R("c", "done", { signatureUrl: "u/delegated/x.png" }), fd, logs.get("c")).kind === "delegate");
show("기록 없는 레슨은 예전 기준 그대로", S.classifyLesson(R("z", "done", { signatureUrl: "u/own.png" }), fd, undefined).kind === "check");
const res = [R("a", "done"), R("b", "done", { signatureUrl: "u/own.png" }), R("d", "done", { signatureUrl: "u/delegated/d.png" }), R("e", "noshow"), R("f", "noshow")];
const st = S.buildSettlement({ reservations: res as any, delegationIds: new Set(["d1"]), month: "2026-11", products: [{ id: "p1", type: "session", totalSessions: 10, price: 1000000, listPrice: 1000000, name: "PT 10회" } as any], customerNameOf: () => "김철수", transferRecipientIds: new Set(), firstDay: fd, statusLogs: logs, settings: { ...S.defaultSettlementSettings, perLesson: 30000, includeNoshow: true } });
const by = Object.fromEntries(st.lessons.map((l) => [l.id, l]));
show("정산: 대리 완료 a·d는 대상, 관리자 완료 b는 제외(본인)", by.a.eligible && by.d.eligible && !by.b.eligible && by.b.handler === "owner");
show("정산: 관리자가 노쇼 처리한 e는 노쇼 횟수·지급에서 제외, 대리 노쇼 f만", st.counts.noshow === 1 && !by.e.eligible && by.f.eligible, JSON.stringify(st.counts));
show("정산: 확인 필요 0건, 정산 대상 3회 90,000원", st.counts.check === 0 && st.counts.eligible === 3 && st.total === 90000, `${st.counts.eligible} ${st.total}`);
console.log(`\n합계: PASS ${pass} / FAIL ${fail}`); if (fail) process.exit(1);
