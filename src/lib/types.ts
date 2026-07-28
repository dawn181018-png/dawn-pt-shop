export interface Customer {
  id: string;
  name: string;
  phone?: string;
  birthdate?: string;
  email?: string;
  memo?: string;
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

export interface Reservation {
  id: string;
  customerId: string;
  productId: string | null;
  seriesId: string | null;
  date: string;
  time: string;
  duration: number;
  memo?: string;
  status: ReservationStatus;
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
