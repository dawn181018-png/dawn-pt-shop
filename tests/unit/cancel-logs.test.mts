// 예약 취소 내역 화면 계산 시험(가짜 데이터): 방식 이름표, 이번 달/전체 건수, 기간·이름·담당 강사 걸러 보기.
import * as C from "@/lib/cancelLogs";

let fail = 0;
const show = (label: string, ok: boolean, detail = "") => { if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", label, detail); };

const L = (x: Partial<C.ReservationCancelLog>): C.ReservationCancelLog => ({
  id: "l", reservationId: "r", customerId: "c1", customerName: "김철수", productId: "p1", productName: "PT 30회", reservationType: "pt",
  reservationDate: "2026-11-20", reservationTime: "10:00", duration: 50, trainerEmail: "owner", trainerName: "대표", seriesId: null,
  fromSeries: false, oldStatus: "scheduled", cancelKind: "single", memo: null, actorRole: "owner", actorName: null,
  cancelledAt: "2026-11-16T05:00:00Z", ...x,
});
const logs = [
  L({ id: "a", cancelledAt: "2026-11-16T05:00:00Z" }),
  L({ id: "b", customerName: "이영희", trainerEmail: "Jang@test.com", trainerName: "장재혁", cancelKind: "series", fromSeries: true, cancelledAt: "2026-11-01T00:30:00Z" }),
  L({ id: "c", customerName: "박지민", trainerEmail: null, cancelKind: "pushed", actorRole: "delegate", actorName: "장재혁", cancelledAt: "2026-10-31T15:30:00Z" }), // 한국 11/1 00:30
  L({ id: "d", cancelKind: "delete", oldStatus: "done", cancelledAt: "2026-10-20T03:00:00Z" }),
];

show("방식 이름표", C.cancelKindLabel(logs[0]) === "한 건 취소" && C.cancelKindLabel(logs[1]) === "반복 예약 취소" && C.cancelKindLabel(logs[2]) === "새 예약에 밀려 취소");
show("완료 레슨 삭제는 '(완료였음)' 표시", C.cancelKindLabel(logs[3]) === "예약 삭제 (완료였음)", C.cancelKindLabel(logs[3]));
show("취소한 사람: 대표 / 대리 이름", C.cancelActorLabel(logs[0]) === "대표" && C.cancelActorLabel(logs[2]) === "대리 장재혁");
show("담당 키: 비어 있음·owner → 대표, 이메일은 소문자", C.cancelTrainerKey(logs[2]) === "owner" && C.cancelTrainerKey(logs[1]) === "jang@test.com");
show("취소 날짜는 한국 날짜 기준(10/31 15:30Z → 11/1)", C.cancelledDateOf(logs[2]) === "2026-11-01");

const sum = C.cancelSummary(logs, "2026-11-17");
show("이번 달 3건 / 전체 4건", sum.month === 3 && sum.total === 4, JSON.stringify(sum));

const all = C.filterCancelLogs(logs, {});
show("최근 취소부터 정렬", all.map((l) => l.id).join() === "a,b,c,d", all.map((l) => l.id).join());
show("기간: 11/1~11/30", C.filterCancelLogs(logs, { from: "2026-11-01", to: "2026-11-30" }).map((l) => l.id).join() === "a,b,c");
show("기간 끝 날짜 포함(11/16)", C.filterCancelLogs(logs, { from: "2026-11-16", to: "2026-11-16" }).map((l) => l.id).join() === "a");
show("이름 검색(일부)", C.filterCancelLogs(logs, { name: " 영희 " }).map((l) => l.id).join() === "b");
show("담당 강사: 대표", C.filterCancelLogs(logs, { trainer: "owner" }).map((l) => l.id).join() === "a,c,d");
show("담당 강사: 장재혁", C.filterCancelLogs(logs, { trainer: "jang@test.com" }).map((l) => l.id).join() === "b");
show("담당 강사: 전체", C.filterCancelLogs(logs, { trainer: "all" }).length === 4);
show("원본 목록은 바꾸지 않음", logs.map((l) => l.id).join() === "a,b,c,d");

if (fail) { console.log(`\n${fail}개 실패`); process.exit(1); }
