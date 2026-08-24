import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

// 매일 새벽 Vercel Cron이 호출하는 전체 데이터 백업 → 이메일 발송 엔드포인트.
// vercel.json의 crons 설정과 짝을 이룬다.

const BACKUP_TO_EMAIL = "dawn181018@gmail.com";
const BACKUP_FROM_EMAIL = "DAWN 백업 시스템 <onboarding@resend.dev>";

const TABLES = [
  "customers",
  "catalog_items",
  "products",
  "reservations",
  "payroll_settings",
  "renewal_forecasts",
  "contract_signatures",
] as const;

// 서버는 UTC로 도는 경우가 많아 new Date()의 로컬 기준을 쓰면 날짜가 밀릴 수 있다.
// UTC 시각에 9시간을 더해 한국 날짜를 직접 계산한다.
function todayKstDateStr() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function sendFailureAlert(resend: Resend, message: string) {
  try {
    await resend.emails.send({
      from: BACKUP_FROM_EMAIL,
      to: BACKUP_TO_EMAIL,
      subject: `[백업 실패] 던휘트니스 데이터 백업 - ${todayKstDateStr()}`,
      text: `자동 백업 작업 중 오류가 발생해 오늘 백업 메일이 발송되지 않았습니다.\n\n오류 내용: ${message}\n\nSupabase 대시보드에서 데이터 상태를 직접 확인해주세요.`,
    });
  } catch {
    // 실패 알림 메일마저 실패하면 더 할 수 있는 조치가 없다 — Vercel 함수 로그의 console.error만 남는다.
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let resend: Resend;
  try {
    resend = new Resend(process.env.RESEND_API_KEY);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[backup-cron] Resend 초기화 실패:", message);
    return NextResponse.json({ ok: false, error: `Resend 초기화 실패: ${message}` }, { status: 500 });
  }

  try {
    const supabase = createAdminClient();
    const tables: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    for (const table of TABLES) {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
      tables[table] = data ?? [];
      counts[table] = data?.length ?? 0;
    }

    const dateStr = todayKstDateStr();
    const backupJson = JSON.stringify({ generatedAt: new Date().toISOString(), tables }, null, 2);
    const summary = TABLES.map((t) => `- ${t}: ${counts[t]}건`).join("\n");

    const { error: sendError } = await resend.emails.send({
      from: BACKUP_FROM_EMAIL,
      to: BACKUP_TO_EMAIL,
      subject: `던휘트니스 데이터 백업 - ${dateStr}`,
      text: `${dateStr} 기준 전체 데이터 백업입니다.\n\n${summary}\n\n첨부된 JSON 파일에 전체 데이터가 들어있습니다.`,
      attachments: [
        { filename: `dawn-backup-${dateStr}.json`, content: Buffer.from(backupJson, "utf-8") },
      ],
    });
    if (sendError) throw new Error(`메일 발송 실패: ${sendError.message}`);

    return NextResponse.json({ ok: true, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[backup-cron] failed:", message);
    await sendFailureAlert(resend, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
