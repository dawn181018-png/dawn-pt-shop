// "고객 링크 서명"(서명 대기 판매)에서 트레이너 화면과 고객 링크 화면이 함께 쓰는 타입/유틸.
// 서버 전용 조회 로직은 src/lib/supabase/pendingSaleServer.ts에 있다.

import type { PaymentMethod, ProductType } from "@/lib/types";

// 링크를 보낼 때 저장해두는 판매 입력값 스냅샷(pending_sales.product). 고객이 서명하는 순간 이 값 그대로
// 이용권(products)이 만들어진다 — 현장 서명에서 insertProduct에 넘기는 값과 같은 필드다.
export type SaleProductSnapshot = {
  name: string;
  type: ProductType;
  totalSessions: number;
  startDate: string;
  endDate: string;
  sessionDuration: number;
  listPrice: number;
  price: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
};

export type NewCustomerSnapshot = { name: string; gender: string; phone: string; birthdate: string };

// 링크 토큰은 DB가 만드는 64자 16진수. 모양이 다르면 DB 조회 전에 바로 거절한다.
export const isValidSignToken = (token: string): boolean => /^[0-9a-f]{64}$/.test(token);

export const signLinkUrl = (origin: string, token: string): string => `${origin}/sign/${token}`;

export const PAYMENT_LABELS: Record<PaymentMethod, string> = { card: "카드", cash: "현금", transfer: "계좌이체" };

// 고객 링크 화면에 내려보내는 데이터 — 그 한 건의 판매 정보와 본인 이름만 담는다(연락처/센터 매출/다른 회원 없음).
type SignViewDetail = {
  customerName: string;
  product: SaleProductSnapshot;
  contractVersion: string;
  signedAt: string | null;
  expiresAt: string;
};
export type SignViewData =
  | { state: "invalid" }
  | { state: "cancelled" }
  | { state: "expired" }
  | ({ state: "pending" } & SignViewDetail)
  | ({ state: "signed" } & SignViewDetail);
