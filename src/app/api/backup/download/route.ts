import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 트레이너(관리자)가 버튼 한 번으로 내려받는 전체 데이터 백업(JSON). 매일 새벽 이메일 백업과 같은 표 목록을,
// 관리자 키가 아니라 로그인한 본인 권한(RLS: 본인 데이터만)으로 읽기만 한다 — 데이터를 바꾸지 않는다.
// 회원/대리 계정은 앱 입구(미들웨어)에서 이 경로까지 오지 못하고, 와도 여기서 거절한다.

const TABLES = [
  "customers", "catalog_items", "products", "reservations", "payroll_settings", "renewal_forecasts",
  "contract_signatures", "pass_transfers", "pending_sales", "lesson_delegations", "reservation_series",
  // 나중에 추가된 기록 표 — 아직 없으면(SQL 실행 전) 건너뛴다
  "payment_edit_logs", "product_delete_logs", "payment_receipts",
] as const;
const PAGE_SIZE = 1000;

function todayKstDateStr() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role) return NextResponse.json({ error: "권한이 없어요" }, { status: 403 });

  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  try {
    for (const table of TABLES) {
      const orderColumn = table === "payroll_settings" ? "owner_id" : "id";
      const rows: unknown[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase.from(table).select("*").order(orderColumn, { ascending: true }).range(from, from + PAGE_SIZE - 1);
        if (error) {
          if (["PGRST205", "42P01"].includes(error.code || "")) break; // 아직 없는 표
          throw new Error(`${table} 조회 실패: ${error.message}`);
        }
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE_SIZE) break;
      }
      tables[table] = rows;
      counts[table] = rows.length;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[backup-download] 실패:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const dateStr = todayKstDateStr();
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), counts, tables }, null, 2);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dawn-backup-${dateStr}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
