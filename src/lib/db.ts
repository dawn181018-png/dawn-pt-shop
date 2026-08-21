import { createClient } from "@/lib/supabase/client";
import { toSnake, toCamel, withEpochCreatedAt } from "@/lib/caseConvert";
import type { Customer, Product, Reservation, CatalogItem, PayrollSettings, RenewalForecast, ContractSignature } from "@/lib/types";

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
