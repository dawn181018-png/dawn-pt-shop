// 운동일지: reservations.workout_note를 고객별로 모아서 다루는 순수 함수들.
// UI(운동일지 탭)와 향후 AI 분석 기능이 동일한 함수로 같은 데이터를 가져다 쓰도록
// 여기 한 곳에 모아둔다. 실제 AI 호출 코드는 아직 없음 — 나중에 getCustomerWorkoutLogs()의
// 결과를 그대로 프롬프트 입력으로 넘기면 된다.

import type { Reservation } from "@/lib/types";

export interface WorkoutLogEntry {
  reservationId: string;
  date: string;
  time: string;
  note: string;
}

// 부위 키워드 → 배지 매칭용. 필요하면 항목만 추가하면 된다.
export const BODY_PART_KEYWORDS = ["하체", "등", "가슴", "어깨", "팔", "복근", "유산소"];

export function getCustomerWorkoutLogs(reservations: Reservation[], customerId: string): WorkoutLogEntry[] {
  return reservations
    .filter((r): r is Reservation & { workoutNote: string } => r.customerId === customerId && !!r.workoutNote && !!r.workoutNote.trim())
    .map((r) => ({ reservationId: r.id, date: r.date, time: r.time, note: r.workoutNote.trim() }))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

export function matchBodyPartTags(note: string): string[] {
  return BODY_PART_KEYWORDS.filter((kw) => note.includes(kw));
}
