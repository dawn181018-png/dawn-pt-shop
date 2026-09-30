// 스케줄표에서 토/일/공휴일("쉬는 날")을 강조 표시하기 위한 판단 로직.
// 공휴일은 @hyunbinseo/holidays-kr(우주항공청 월력요항 = 정부 공식 발표를 그대로 옮긴 목록)을 쓴다.
// 대체공휴일/선거일/임시공휴일까지 포함되지만, 라이브러리에 들어있는 연도까지만 알 수 있다.
// → 매년 하반기(다음 해 월력요항 발표 후) `npm install @hyunbinseo/holidays-kr@latest`로 갱신해야 한다.
//   갱신을 놓쳐도 앱은 멈추지 않고, 그 해의 공휴일 강조만 빠진다(토/일 강조는 그대로).

import { getHolidayPreset } from "@hyunbinseo/holidays-kr";

export type HolidayMap = Record<string, readonly string[]>; // "YYYY-MM-DD" -> 공휴일 명칭(들)

// 주어진 연도들의 공휴일을 불러온다. 라이브러리에 데이터가 없는 연도(RangeError)는 조용히 건너뛴다.
export async function loadHolidays(years: string[]): Promise<HolidayMap> {
  const presets = await Promise.all(
    years.map((y) => getHolidayPreset(y).catch(() => ({}) as HolidayMap)),
  );
  return Object.assign({}, ...presets);
}

// "YYYY-MM-DD"를 로컬 자정 기준으로 해석해 요일을 판단한다(UTC 파싱으로 요일이 밀리는 것 방지).
export function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  return day === 0 || day === 6;
}
