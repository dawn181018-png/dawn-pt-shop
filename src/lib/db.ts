import { createClient } from "@/lib/supabase/client";
import { toSnake, toCamel, withEpochCreatedAt } from "@/lib/caseConvert";
import type { Customer, Product, Reservation, CatalogItem, PayrollSettings, RenewalForecast, ContractSignature, PassTransfer, TransferRecipientInput, PendingSale, LessonDelegation } from "@/lib/types";

const supabase = createClient();

function mapCustomer(row: Record<string, unknown>): Customer {
  return withEpochCreatedAt(toCamel<Customer>(row));
}
function mapProduct(row: Record<string, unknown>): Product {
  return withEpochCreatedAt(toCamel<Product>(row));
}
function mapReservation(row: Record<string, unknown>): Reservation {
  return toCamel<Reservation>(row);
}
function mapCatalogItem(row: Record<string, unknown>): CatalogItem {
  return withEpochCreatedAt(toCamel<CatalogItem>(row));
}
function mapSettings(row: Record<string, unknown>): PayrollSettings {
  return toCamel<PayrollSettings>(row);
}
function mapForecast(row: Record<string, unknown>): RenewalForecast {
  return withEpochCreatedAt(toCamel<RenewalForecast>(row));
}
function mapContractSignature(row: Record<string, unknown>): ContractSignature {
  return withEpochCreatedAt(toCamel<ContractSignature>(row));
}
function mapPassTransfer(row: Record<string, unknown>): PassTransfer {
  return withEpochCreatedAt(toCamel<PassTransfer>(row));
}

function must<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------- customers ----------
export async function listCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: true });
  return must(data, error).map(mapCustomer);
}
export async function insertCustomer(data: Partial<Customer>): Promise<Customer> {
  const { data: row, error } = await supabase.from("customers").insert(toSnake(data)).select().single();
  return mapCustomer(must(row, error));
}
export async function insertCustomers(rows: Partial<Customer>[]): Promise<Customer[]> {
  const { data, error } = await supabase.from("customers").insert(rows.map(toSnake)).select();
  return must(data, error).map(mapCustomer);
}
export async function updateCustomer(id: string, data: Partial<Customer>): Promise<Customer> {
  const { data: row, error } = await supabase.from("customers").update(toSnake(data)).eq("id", id).select().single();
  return mapCustomer(must(row, error));
}
export async function deleteCustomer(id: string): Promise<void> {
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- products ----------
export async function listProducts(): Promise<Product[]> {
  const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: true });
  return must(data, error).map(mapProduct);
}
export async function insertProduct(customerId: string, data: Partial<Product>): Promise<Product> {
  const { data: row, error } = await supabase
    .from("products")
    .insert({ ...toSnake(data), customer_id: customerId })
    .select()
    .single();
  return mapProduct(must(row, error));
}
export async function updateProduct(id: string, data: Partial<Product>): Promise<Product> {
  const { data: row, error } = await supabase.from("products").update(toSnake(data)).eq("id", id).select().single();
  return mapProduct(must(row, error));
}
export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
// 세션 사용횟수 원자적 증감(DB에서 현재값+delta 계산) — 동시에 여러 건을 처리해도 누락되지 않는다.
export async function adjustUsedSessions(productId: string, delta: number): Promise<Product> {
  const { data, error } = await supabase.rpc("adjust_used_sessions", { p_product_id: productId, p_delta: delta });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return mapProduct(row);
}

// ---------- reservations ----------
// PostgREST는 요청 1건당 최대 1000행까지만 반환한다(기본 db-max-rows).
// 예약이 1000건을 넘으면 정렬 없는 select("*") 한 번으로는 어떤 행이 잘려나갈지 보장이 없어서,
// 방금 새로 만든 예약이 새로고침 후 감쪽같이 사라져 보이는 문제가 있었다. range()로 전부 페이징해서 가져온다.
export async function listReservations(): Promise<Reservation[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("reservations")
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    const page = must(data, error);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map(mapReservation);
}
export async function insertReservations(rows: Partial<Reservation>[]): Promise<Reservation[]> {
  const { data, error } = await supabase.from("reservations").insert(rows.map(toSnake)).select();
  return must(data, error).map(mapReservation);
}
export async function updateReservation(id: string, data: Partial<Reservation>): Promise<Reservation> {
  const { data: row, error } = await supabase.from("reservations").update(toSnake(data)).eq("id", id).select().single();
  return mapReservation(must(row, error));
}
export async function deleteReservation(id: string): Promise<void> {
  const { error } = await supabase.from("reservations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// 예약 상태 변경/삭제와 세션 차감을 DB 함수(set_reservation_status / delete_reservation) 안에서 한 트랜잭션으로
// 처리한다 — 중간에 끊겨도 "예약만 바뀌고 차감은 빠진" 반쪽 저장이 생기지 않는다. 그 함수가 아직 DB에
// 설치되지 않았으면(PostgREST 오류 PGRST202) null을 돌려주고, 호출한 쪽은 예전 방식(두 번 요청)으로 처리한다.
const isMissingFunction = (error: { code?: string }) => error.code === "PGRST202";
export async function setReservationStatusAtomic(
  reservationId: string, status: string, productId: string | null, extra: Partial<Reservation> = {},
): Promise<{ reservation: Reservation; product: Product | null } | null> {
  const { data, error } = await supabase.rpc("set_reservation_status", {
    p_reservation_id: reservationId, p_status: status, p_product_id: productId, p_extra: toSnake(extra),
  });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw new Error(error.message);
  }
  const result = data as { reservation: Record<string, unknown>; product: Record<string, unknown> | null };
  return { reservation: mapReservation(result.reservation), product: result.product ? mapProduct(result.product) : null };
}
export async function deleteReservationAtomic(reservationId: string): Promise<{ product: Product | null } | null> {
  const { data, error } = await supabase.rpc("delete_reservation", { p_reservation_id: reservationId });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw new Error(error.message);
  }
  const result = data as { product: Record<string, unknown> | null };
  return { product: result.product ? mapProduct(result.product) : null };
}

// 출석(완료) 서명 이미지 업로드 → signature_url 컬럼에 저장할 스토리지 경로를 반환.
// signatures 버킷은 private이라, 조회 시엔 getSignatureUrl로 그때그때 signed URL을 새로 발급받는다.
export async function uploadSignature(reservationId: string, blob: Blob): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다");
  const path = `${user.id}/${reservationId}-${Date.now()}.png`;
  const { error } = await supabase.storage.from("signatures").upload(path, blob, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return path;
}
export async function getSignatureUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("signatures").createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
export async function cancelReservationSeriesFrom(seriesId: string, fromDate: string): Promise<void> {
  const { error } = await supabase
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("series_id", seriesId)
    .gte("date", fromDate)
    .neq("status", "cancelled");
  if (error) throw new Error(error.message);
}
export async function deleteReservationSeriesFrom(seriesId: string, fromDate: string): Promise<void> {
  const { error } = await supabase.from("reservations").delete().eq("series_id", seriesId).gte("date", fromDate);
  if (error) throw new Error(error.message);
}

// ---------- catalog_items ----------
export async function listCatalog(): Promise<CatalogItem[]> {
  const { data, error } = await supabase.from("catalog_items").select("*").order("created_at", { ascending: true });
  return must(data, error).map(mapCatalogItem);
}
export async function insertCatalogItem(data: Partial<CatalogItem>): Promise<CatalogItem> {
  const { data: row, error } = await supabase.from("catalog_items").insert(toSnake(data)).select().single();
  return mapCatalogItem(must(row, error));
}
export async function updateCatalogItem(id: string, data: Partial<CatalogItem>): Promise<CatalogItem> {
  const { data: row, error } = await supabase.from("catalog_items").update(toSnake(data)).eq("id", id).select().single();
  return mapCatalogItem(must(row, error));
}
export async function deleteCatalogItem(id: string): Promise<void> {
  const { error } = await supabase.from("catalog_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- payroll_settings ----------
export async function getSettings(): Promise<PayrollSettings | null> {
  const { data, error } = await supabase.from("payroll_settings").select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSettings(data) : null;
}
export async function upsertSettings(data: PayrollSettings): Promise<PayrollSettings> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: row, error } = await supabase
    .from("payroll_settings")
    .upsert({ ...toSnake(data), owner_id: user?.id }, { onConflict: "owner_id" })
    .select()
    .single();
  return mapSettings(must(row, error));
}

// ---------- renewal_forecasts ----------
export async function listRenewalForecasts(): Promise<RenewalForecast[]> {
  const { data, error } = await supabase.from("renewal_forecasts").select("*").order("created_at", { ascending: true });
  return must(data, error).map(mapForecast);
}
export async function insertRenewalForecast(data: Partial<RenewalForecast>): Promise<RenewalForecast> {
  const { data: row, error } = await supabase.from("renewal_forecasts").insert(toSnake(data)).select().single();
  return mapForecast(must(row, error));
}
export async function updateRenewalForecast(id: string, data: Partial<RenewalForecast>): Promise<RenewalForecast> {
  const { data: row, error } = await supabase.from("renewal_forecasts").update(toSnake(data)).eq("id", id).select().single();
  return mapForecast(must(row, error));
}
// 다음달로 미루기: 원본을 'postponed'로 바꾸고 다음달에 같은 내용의 'pending' 항목을 만드는 것을
// DB 함수(postpone_forecast) 안에서 한 트랜잭션으로 처리한다.
export async function postponeRenewalForecast(id: string): Promise<{ original: RenewalForecast; created: RenewalForecast }> {
  const { data, error } = await supabase.rpc("postpone_forecast", { p_forecast_id: id });
  if (error) throw new Error(error.message);
  const result = data as { original: Record<string, unknown>; created: Record<string, unknown> };
  return { original: mapForecast(result.original), created: mapForecast(result.created) };
}
export async function deleteRenewalForecast(id: string): Promise<void> {
  const { error } = await supabase.from("renewal_forecasts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- contract_signatures (상품판매 계약서 서명) ----------
// 서명 이미지는 출석 서명과 같은 'signatures' 버킷의 contracts/ 하위 경로에 저장하고,
// signed_url 발급은 기존 getSignatureUrl을 그대로 재사용한다(경로만 다를 뿐 버킷/정책은 동일).
export async function uploadContractSignature(customerId: string, blob: Blob): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다");
  const path = `${user.id}/contracts/${customerId}-${Date.now()}.png`;
  const { error } = await supabase.storage.from("signatures").upload(path, blob, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return path;
}
export async function insertContractSignature(data: Partial<ContractSignature>): Promise<ContractSignature> {
  const { data: row, error } = await supabase.from("contract_signatures").insert(toSnake(data)).select().single();
  return mapContractSignature(must(row, error));
}

// ---------- pass_transfers (이용권 양도) ----------
export async function listPassTransfers(): Promise<PassTransfer[]> {
  const { data, error } = await supabase.from("pass_transfers").select("*").order("created_at", { ascending: true });
  return must(data, error).map(mapPassTransfer);
}
// 잔여 횟수 검증 + 수령인별 고객/이용권 생성 + 이력 기록 + 원본 차감을 DB 함수(transfer_pass) 안에서
// 하나의 트랜잭션으로 처리한다 — 중간에 실패하면 전부 롤백되고, 잔여 횟수 재검증도 서버(DB)에서 다시 한다.
export async function transferPass(sourceProductId: string, recipients: TransferRecipientInput[]): Promise<{ totalTransferred: number }> {
  const { data, error } = await supabase.rpc("transfer_pass", {
    p_source_product_id: sourceProductId,
    p_recipients: recipients.map((r) => ({
      customer_id: r.customerId ?? null,
      new_customer_name: r.newCustomerName ?? null,
      new_customer_phone: r.newCustomerPhone ?? null,
      sessions: r.sessions,
      amount: r.amount,
      payment_method: r.paymentMethod,
    })),
  });
  if (error) throw new Error(error.message);
  return data as { totalTransferred: number };
}

// ---------- pending_sales (고객 링크 서명 대기) ----------
function mapPendingSale(row: Record<string, unknown>): PendingSale {
  return withEpochCreatedAt(toCamel<PendingSale>(row));
}
export async function listPendingSales(): Promise<PendingSale[]> {
  const { data, error } = await supabase
    .from("pending_sales")
    .select("id, customer_id, new_customer, product, contract_version, token, expires_at, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  return must(data, error).map(mapPendingSale);
}
// 토큰/만료일은 DB 기본값으로 생성된다(64자 랜덤, 7일).
export async function insertPendingSale(data: Pick<PendingSale, "customerId" | "newCustomer" | "product" | "contractVersion">): Promise<PendingSale> {
  const { data: row, error } = await supabase.from("pending_sales").insert(toSnake(data)).select().single();
  return mapPendingSale(must(row, error));
}
// 대기 상태일 때만 취소된다 — 이미 고객이 서명했다면 0건이 바뀌므로 그 사실을 알려준다.
export async function cancelPendingSale(id: string): Promise<void> {
  const { data, error } = await supabase
    .from("pending_sales")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("이미 고객이 서명했거나 취소된 건이에요");
}
// 새 토큰/만료일로 바꿔 옛 링크를 즉시 무효화한다(product를 주면 판매 입력값도 교체).
export async function reissuePendingSale(id: string, product?: PendingSale["product"]): Promise<PendingSale> {
  const { data, error } = await supabase.rpc("reissue_pending_sale", { p_id: id, p_product: product ?? null });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return mapPendingSale(row as Record<string, unknown>);
}

// ---------- lesson_delegations (대리 레슨 지정) ----------
function mapDelegation(row: Record<string, unknown>): LessonDelegation {
  return withEpochCreatedAt(toCamel<LessonDelegation>(row));
}
export async function listDelegations(): Promise<LessonDelegation[]> {
  const { data, error } = await supabase.from("lesson_delegations").select("*").order("created_at", { ascending: false });
  return must(data, error).map(mapDelegation);
}
export async function insertDelegation(data: Pick<LessonDelegation, "delegateName" | "delegateEmail" | "customerIds" | "startsOn" | "endsOn">): Promise<LessonDelegation> {
  const { data: row, error } = await supabase.from("lesson_delegations").insert(toSnake(data)).select().single();
  return mapDelegation(must(row, error));
}
// 이메일이 바뀌면 예전 이메일로 연결돼 있던 대리 계정 연결(delegate_user_id)을 끊는다 — 그 순간부터 예전 계정은
// proxy_* 함수에서 이 지정을 쓸 수 없고, 새 이메일로 "로그인 링크 복사"를 다시 해야 새 계정이 연결된다.
export async function updateDelegation(
  id: string,
  data: Pick<LessonDelegation, "delegateName" | "delegateEmail" | "customerIds" | "startsOn" | "endsOn">,
  emailChanged: boolean,
): Promise<LessonDelegation> {
  const payload = emailChanged ? { ...toSnake(data), delegate_user_id: null } : toSnake(data);
  const { data: row, error } = await supabase.from("lesson_delegations").update(payload).eq("id", id).select().single();
  return mapDelegation(must(row, error));
}
// 즉시 해제: revoked_at이 찍히는 순간부터 DB의 proxy_* 함수가 이 지정을 더 이상 인정하지 않는다.
export async function revokeDelegation(id: string): Promise<LessonDelegation> {
  const { data: row, error } = await supabase
    .from("lesson_delegations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  return mapDelegation(must(row, error));
}
