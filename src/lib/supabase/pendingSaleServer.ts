// 고객 링크 서명 화면(/sign/[token])의 서버 전용 조회 로직. 고객은 로그인하지 않으므로 pending_sales를
// anon에게 열지 않고, 서버에서 service_role(관리자 클라이언트)로 "토큰이 일치하는 한 건"만 읽은 뒤
// 화면에 필요한 필드만 골라 SignViewData로 돌려준다. 절대 클라이언트(브라우저) 코드에서 import하지 않는다.

import { createAdminClient } from "@/lib/supabase/admin";
import { isValidSignToken, type SaleProductSnapshot, type NewCustomerSnapshot, type SignViewData } from "@/lib/pendingSale";

export type PendingSaleRow = {
  id: string;
  owner_id: string;
  customer_id: string | null;
  new_customer: NewCustomerSnapshot | null;
  product: SaleProductSnapshot;
  contract_version: string;
  expires_at: string;
  status: "pending" | "signed" | "cancelled";
  signed_at: string | null;
};

export async function findPendingSaleByToken(token: string): Promise<PendingSaleRow | null> {
  if (!isValidSignToken(token)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pending_sales")
    .select("id, owner_id, customer_id, new_customer, product, contract_version, expires_at, status, signed_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PendingSaleRow | null) ?? null;
}

export async function loadSignView(token: string): Promise<SignViewData> {
  const row = await findPendingSaleByToken(token);
  if (!row) return { state: "invalid" };
  if (row.status === "cancelled") return { state: "cancelled" };
  // 이미 서명된 건은 만료와 상관없이 영수증(결제 확인서)만 보여준다.
  if (row.status === "pending" && new Date(row.expires_at).getTime() < Date.now()) return { state: "expired" };

  let customerName = row.new_customer?.name || "";
  if (row.customer_id) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("customers")
      .select("name")
      .eq("id", row.customer_id)
      .eq("owner_id", row.owner_id)
      .maybeSingle();
    customerName = (data?.name as string | undefined) || "";
  }

  return {
    state: row.status,
    customerName,
    product: row.product,
    contractVersion: row.contract_version,
    signedAt: row.signed_at,
    expiresAt: row.expires_at,
  };
}
