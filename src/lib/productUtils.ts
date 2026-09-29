// 이용권(product)의 잔여 횟수/남은 기간/임박도 계산을 한 곳에 모은 것.
// 트레이너 화면(PTMemberManager), 회원 마이페이지(MyPageView), 양도 모달(PassTransferModal)이
// 각자 같은 계산식을 복사해 쓰고 있었는데, 한쪽만 고치면 화면마다 숫자가 달라지는 원인이 되므로
// 전부 여기 있는 함수를 가져다 쓴다. (계산식은 기존 트레이너 화면의 것을 그대로 옮겼다.)

import { today } from "@/lib/formatUtils";
import type { Product } from "@/lib/types";

export function daysBetween(a: string, b: string): number {
  return Math.ceil((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}
export function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - new Date(today()).getTime()) / 86400000);
}

// 횟수권의 잔여 횟수 = 총 횟수 - 사용 횟수. used_sessions는 출석/노쇼 차감, 수동조정, 양도로 넘긴
// 횟수까지 전부 반영된 DB 값이라, 잔여 횟수는 항상 이 값 하나로만 계산한다(예약 건수로 다시 세지 않음).
export function remainingSessions(p: Pick<Product, "totalSessions" | "usedSessions">): number {
  return p.totalSessions - p.usedSessions;
}

export function urgency(p?: Product | null): "ok" | "critical" | "warn" {
  if (!p) return "ok";
  if (p.type === "session") {
    const remain = remainingSessions(p);
    if (remain <= 1) return "critical";
    if (remain <= 3) return "warn";
    return "ok";
  }
  const remain = daysUntil(p.endDate as string);
  if (remain <= 3) return "critical";
  if (remain <= 10) return "warn";
  return "ok";
}
export function remainLabel(p: Product): string {
  if (p.type === "session") return `${remainingSessions(p)}회 남음 / 총 ${p.totalSessions}회`;
  const remain = daysUntil(p.endDate as string);
  return remain < 0 ? `만료 ${Math.abs(remain)}일 지남` : `${remain}일 남음`;
}
export function shortRemain(p: Product): string {
  if (p.type === "session") return `${remainingSessions(p)}회`;
  const remain = daysUntil(p.endDate as string);
  return remain < 0 ? "만료" : `${remain}일`;
}
export function progressPct(p: Product): number {
  if (p.type === "session") return Math.max(0, Math.min(100, (p.usedSessions / p.totalSessions) * 100));
  const total = daysBetween(p.endDate as string, p.startDate) || 1;
  const used = daysBetween(today(), p.startDate);
  return Math.max(0, Math.min(100, (used / total) * 100));
}
// 횟수권은 잔여 0 이하, 기간권은 만료일이 지난 경우 "소진"으로 본다.
export function isDepleted(p: Product): boolean {
  if (p.type === "session") return remainingSessions(p) <= 0;
  return daysUntil(p.endDate as string) < 0;
}
export function sortProductsByUsage(list: Product[]): Product[] {
  return [...list].sort((a, b) => Number(isDepleted(a)) - Number(isDepleted(b)));
}
