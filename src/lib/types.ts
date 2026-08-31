export type Gender = "male" | "female";

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  birthdate?: string | null;
  email?: string;
  memo?: string;
  gender?: Gender | null;
  isDormant?: boolean;
  createdAt?: number;
}

export type ProductType = "session" | "period";
export type PaymentMethod = "card" | "cash" | "transfer";

export interface Product {
  id: string;
  customerId: string;
  name: string;
  type: ProductType;
  totalSessions: number;
  usedSessions: number;
  startDate: string;
  endDate?: string | null;
  sessionDuration: number;
  listPrice: number;
  price: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  createdAt?: number;
}

export type ReservationStatus = "scheduled" | "done" | "noshow" | "cancelled";
export type ReservationType = "pt" | "misc";

export interface Reservation {
  id: string;
  customerId: string | null;
  productId: string | null;
  seriesId: string | null;
  date: string;
  time: string;
  duration: number;
  memo?: string;
  status: ReservationStatus;
  type: ReservationType;
  signatureUrl?: string | null; // Storage 내 서명 이미지 경로 (signed URL이 아니라 경로를 저장)
  workoutNote?: string | null; // 출석 서명 직전에 남긴 "오늘 운동 내용" 메모
}

export type CatalogCategory = "daily_pt" | "premium" | "membership" | "locker";
export type PeriodUnit = "month" | "day";

export interface CatalogItem {
  id: string;
  name: string;
  category: CatalogCategory;
  sessions: number;
  months: number;
  periodUnit: PeriodUnit;
  sessionDuration?: number;
  price: number;
  createdAt?: number;
}

export interface PayrollSettings {
  baseSalary: number;
  commissionRate: number;
  deductionRate: number;
}

export type ForecastStatus = "pending" | "done" | "missed";

export interface RenewalForecast {
  id: string;
  customerId?: string | null; // 없으면 아직 등록 안 된 신규 고객 예정 (prospectName 사용)
  prospectName?: string | null;
  targetMonth: string; // 'YYYY-MM'
  expectedSessions?: number | null;
  expectedAmount: number;
  note?: string;
  status: ForecastStatus;
  actualAmount?: number;
  actualProductId?: string | null;
  createdAt?: number;
}

// "상품판매" 화면에서 PT 상품을 신규/재등록 판매하며 함께 받는 계약서 서명 기록.
export interface ContractSignature {
  id: string;
  customerId: string;
  productId?: string | null;
  isNewCustomer: boolean;
  signatureUrl: string; // Storage 내 서명 이미지 경로 (signed URL이 아니라 경로를 저장)
  contractVersion: string;
  signedAt: string;
  createdAt?: number;
}
