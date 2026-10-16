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

// "신규 고객" 판단 — 스케줄 색 구분 등 여러 화면이 같은 기준을 쓰도록 여기 한 곳에서만 계산한다.
// 신규 = 아직 이용권을 한 번도 사지 않은 고객(등록 전 체험·상담 레슨). 이용권을 사면 첫 레슨부터 기존 회원으로 본다.
// allProducts에는 보관된 이용권까지 모두 넣어야 한다(이용권을 보관한 기존 회원이 신규로 잘못 잡히지 않게).
export function isNewCustomer(customerId: string, allProducts: Product[]): boolean {
  return !allProducts.some((p) => p.customerId === customerId);
}

// 이용권 이름에 적힌 횟수(예: "PT 20회", "half 20", "Premium Conditioning 20s")와 실제 총 횟수가 다르면 이름 속 숫자를
// 돌려준다(같으면 null). "half 20"인데 횟수가 10으로 저장돼 판매된 일이 있어, 이용권 만들기·판매·수정 화면에서 경고한다.
export function nameSessionMismatch(name: string, sessions: number): number | null {
  const m = (name || "").match(/(d{1,3})/);
  if (!m || !(Number(sessions) > 0)) return null;
  const inName = Number(m[1]);
  return inName > 0 && inName !== Number(sessions) ? inName : null;
}
