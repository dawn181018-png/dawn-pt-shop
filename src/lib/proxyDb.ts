// 대리 레슨 화면(/proxy)이 쓰는 DB 호출. 대리 계정은 테이블을 직접 읽거나 쓸 권한이 없어서
// 전부 proxy_* 함수(DB에서 "지정 고객 + 유효 기간"을 매번 확인)를 통해서만 동작한다.

import { createClient } from "@/lib/supabase/client";
import { proxyErrorMessage } from "@/lib/proxyErrors";
import type { ProductType, ReservationStatus } from "@/lib/types";

const supabase = createClient();

export type ProxyDelegationInfo = { name: string; startsOn: string; endsOn: string; active: boolean; revoked: boolean };
export type ProxyCustomer = { id: string; name: string; phoneMasked: string | null };
export type ProxyProduct = {
  id: string; customerId: string; name: string; type: ProductType;
  totalSessions: number; usedSessions: number; startDate: string; endDate: string | null; createdAt: string;
};
export type ProxyReservation = {
  id: string; customerId: string; productId: string | null; seriesId: string | null;
  date: string; time: string; duration: number; status: ReservationStatus;
  workoutNote: string | null; signed: boolean; delegateName: string | null;
};
export type ProxyBusySlot = { date: string; time: string; duration: number };
export type ProxyContext = {
  today: string;
  delegations: ProxyDelegationInfo[];
  customers: ProxyCustomer[];
  products: ProxyProduct[];
  reservations: ProxyReservation[];
  busy: ProxyBusySlot[];
};


const call = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(proxyErrorMessage(error.message));
  return data as T;
};

export const loadProxyContext = () => call<ProxyContext>("proxy_context");
export const addProxyReservations = (customerId: string, productId: string, dates: string[], time: string, duration: number) =>
  call<number>("proxy_add_reservations", { p_customer_id: customerId, p_product_id: productId, p_dates: dates, p_time: time, p_duration: duration });
export const setProxyReservationStatus = (reservationId: string, status: ReservationStatus) =>
  call<{ switched: boolean; delta: number }>("proxy_set_reservation_status", { p_reservation_id: reservationId, p_status: status });
export const moveProxyReservation = (reservationId: string, date: string, time: string, duration: number) =>
  call<void>("proxy_move_reservation", { p_reservation_id: reservationId, p_date: date, p_time: time, p_duration: duration });
export const saveProxyWorkoutNote = (reservationId: string, note: string) =>
  call<void>("proxy_save_workout_note", { p_reservation_id: reservationId, p_note: note });
