// 잔여 횟수 기준 반복예약 계산(순수 함수). 화면(PTMemberManager / RecurringBookingSheet)이 같은 계산을 쓴다.
// 회차는 이 계산 결과대로 reservations에 한 줄씩 미리 만들고, 규칙은 reservation_series에 따로 저장한다.

import { addDays } from "@/lib/formatUtils";
import type { HolidayMap } from "@/lib/holidays";
import type { Product, Reservation } from "@/lib/types";

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
// 화면 표시는 월요일부터
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// "아직 예약 안 된 횟수" = 횟수권 잔여 합계 − 아직 처리 안 한(예약됨) 예약 수.
// - 잔여는 모든 횟수권의 (총 − 사용)을 더한다(음수는 0). 사용 횟수에는 완료/노쇼 차감, 수동조정, 양도로 넘긴
//   횟수가 이미 들어 있다. 만료일은 보지 않는다(앱 전체에서 횟수권 만료일은 쓰지 않음).
// - 예약됨은 날짜가 지났어도 아직 완료/노쇼 처리를 안 했으면 센다. 이용권 없이 잡은 상담(productId 없음)과
//   기타 일정은 차감되지 않으므로 빼고, 취소는 세지 않는다.
export function unbookedSessions(customerId: string, products: Product[], reservations: Reservation[]) {
  const remaining = products
    .filter((p) => p.customerId === customerId && p.type === "session")
    .reduce((s, p) => s + Math.max(0, p.totalSessions - p.usedSessions), 0);
  const scheduled = reservations.filter(
    (r) => r.customerId === customerId && r.type !== "misc" && r.status === "scheduled" && !!r.productId,
  ).length;
  return { remaining, scheduled, unbooked: Math.max(0, remaining - scheduled) };
}

// 시작일부터 선택한 요일마다 회차 날짜를 count개 만든다. skipHolidays면 공휴일에 걸리는 날은 건너뛰고(총 횟수는
// 그대로 맞추도록 다음 요일들로 이어감) skipped에 기록한다. 만료일은 전혀 보지 않는다.
export function generateSlotDates(opts: {
  startDate: string;
  weekdays: number[];
  count: number;
  skipHolidays: boolean;
  holidays: HolidayMap;
}): { dates: string[]; skipped: { date: string; names: readonly string[] }[] } {
  const { startDate, weekdays, count, skipHolidays, holidays } = opts;
  const dates: string[] = [];
  const skipped: { date: string; names: readonly string[] }[] = [];
  if (!startDate || weekdays.length === 0 || count <= 0) return { dates, skipped };
  const set = new Set(weekdays);
  let d = startDate;
  for (let guard = 0; dates.length < count && guard < 366 * 6; guard++, d = addDays(d, 1)) {
    if (!set.has(new Date(`${d}T00:00:00`).getDay())) continue;
    if (skipHolidays && holidays[d]) { skipped.push({ date: d, names: holidays[d] }); continue; }
    dates.push(d);
  }
  return { dates, skipped };
}

// 미리보기용 월별 회차 수
export function monthBreakdown(dates: string[]): { ym: string; count: number }[] {
  const map = new Map<string, number>();
  dates.forEach((d) => map.set(d.slice(0, 7), (map.get(d.slice(0, 7)) || 0) + 1));
  return [...map.entries()].map(([ym, count]) => ({ ym, count }));
}

export const weekdaysLabel = (weekdays: number[]) =>
  WEEKDAY_ORDER.filter((w) => weekdays.includes(w)).map((w) => WEEKDAY_LABELS[w]).join("·");
