export interface Customer {
  id: string;
  name: string;
  phone?: string;
  birthdate?: string;
  email?: string;
  memo?: string;
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
  endDate?: string;
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
}

export interface CatalogItem {
  id: string;
  name: string;
  sessions: number;
  months: number;
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
  expectedSessions?: number;
  expectedAmount: number;
  note?: string;
  status: ForecastStatus;
  actualAmount?: number;
  actualProductId?: string | null;
  createdAt?: number;
}
