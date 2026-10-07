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

// pending = 대기중, missed = 실패(재등록 불발), postponed = 다음달로 연기. "달성"은 실제 등록금액으로
// 자동 판정하므로 저장하지 않는다(done은 예전부터 허용된 값이지만 앱에서 쓰지 않음).
export type ForecastStatus = "pending" | "done" | "missed" | "postponed";

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
  carriedFromId?: string | null; // "다음달로 미루기"로 만들어진 항목이면 원본(이전 달) 항목 id
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

// 한 이용권(product)의 잔여 횟수를 다른 고객에게 넘긴 이력 — 수령인이 여러 명이면 건마다 한 행씩 생긴다.
export interface PassTransfer {
  id: string;
  sourceProductId: string;
  sourceCustomerId: string;
  recipientCustomerId: string;
  recipientProductId: string;
  sessionsTransferred: number;
  amount: number;
  paymentMethod: PaymentMethod;
  createdAt?: number;
}

// 양도 모달에서 수령인 한 명을 입력받는 형태 — 기존 고객이면 customerId, 신규면 newCustomerName/Phone.
export type TransferRecipientInput = {
  customerId?: string;
  newCustomerName?: string;
  newCustomerPhone?: string;
  sessions: number;
  amount: number;
  paymentMethod: PaymentMethod;
};

// 상품판매에서 "링크 복사"로 고객 서명을 기다리는 판매 건(pending_sales). 고객이 서명하기 전까지는
// 이용권(products)이 만들어지지 않아 횟수/매출/통계/매출계획 어디에도 잡히지 않는다.
export type PendingSaleStatus = "pending" | "signed" | "cancelled";
export interface PendingSale {
  id: string;
  customerId: string | null; // 기존 고객 재등록이면 연결
  newCustomer: { name: string; gender: string; phone: string; birthdate: string } | null; // 신규 고객 입력값
  product: {
    name: string; type: ProductType; totalSessions: number; startDate: string; endDate: string;
    sessionDuration: number; listPrice: number; price: number; paidAmount: number; paymentMethod: PaymentMethod;
  };
  contractVersion: string;
  token: string;
  expiresAt: string;
  status: PendingSaleStatus;
  createdAt?: number;
}
