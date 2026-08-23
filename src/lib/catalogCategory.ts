import type { CatalogCategory, PeriodUnit, ProductType } from "./types";

export const CATALOG_CATEGORIES: CatalogCategory[] = ["daily_pt", "premium", "membership", "locker"];

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  daily_pt: "데일리PT",
  premium: "프리미엄",
  membership: "회원권",
  locker: "사물함",
};

// 데일리PT/프리미엄은 횟수제, 회원권/사물함은 기간제
export function isCountBased(category: CatalogCategory): boolean {
  return category === "daily_pt" || category === "premium";
}

export function categoryToProductType(category: CatalogCategory): ProductType {
  return isCountBased(category) ? "session" : "period";
}

export function formatCatalogSummary(item: {
  category: CatalogCategory;
  sessions: number;
  months: number;
  periodUnit: PeriodUnit;
  sessionDuration?: number;
  price: number;
}): string {
  const price = `${Number(item.price || 0).toLocaleString()}원`;
  if (isCountBased(item.category)) {
    return `${item.sessions}회 · ${item.months}개월 · ${item.sessionDuration || 50}분 · ${price}`;
  }
  const unit = item.periodUnit === "day" ? "일" : "개월";
  return `${item.months}${unit} · ${price}`;
}
