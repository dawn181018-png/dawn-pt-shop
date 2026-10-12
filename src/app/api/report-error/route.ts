import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";

// 화면에서 "저장 실패"·데이터 불러오기 실패·화면 오류가 나면 앱이 이 경로로 짧게 알린다.
// 1) 서버 로그(Vercel 함수 로그)에 항상 남기고  2) 사장님 이메일로 알림을 보내되, 메일이 쏟아지지 않도록
// 서버 한 대 기준 10분에 1통까지만 보낸다(그 사이 오류는 로그에만 남고 다음 메일에 건수로 합쳐진다).
// 로그인한 사용자(트레이너/대리)만 보낼 수 있고, 내용은 앱이 정한 짧은 문구뿐이다(고객 개인정보를 넣지 않는다).

const ALERT_TO_EMAIL = "dawn181018@gmail.com";
const ALERT_FROM_EMAIL = "DAWN 오류 알림 <onboarding@resend.dev>";
const MIN_INTERVAL_MS = 10 * 60 * 1000;

let lastSentAt = 0;
let suppressed: string[] = [];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role === "member") return NextResponse.json({ ok: false }, { status: 401 });

  let where = "", message = "";
  try {
    const body = (await request.json()) as { where?: unknown; message?: unknown };
    where = String(body.where ?? "").slice(0, 80);
    message = String(body.message ?? "").slice(0, 300);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });

  const role = user.app_metadata?.role === "delegate" ? "대리 트레이너" : "관리자";
  const line = `[${new Date().toISOString()}] (${role}) ${where}: ${message}`;
  console.error("[client-error]", line);

  const now = Date.now();
  if (now - lastSentAt < MIN_INTERVAL_MS || !process.env.RESEND_API_KEY) {
    suppressed.push(line);
    if (suppressed.length > 50) suppressed = suppressed.slice(-50);
    return NextResponse.json({ ok: true, emailed: false });
  }
  lastSentAt = now;
  const earlier = suppressed;
  suppressed = [];
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: ALERT_FROM_EMAIL,
      to: ALERT_TO_EMAIL,
      subject: `[앱 오류 알림] ${where || "던휘트니스 앱"}`,
      text: [
        "던휘트니스 관리앱에서 오류가 발생했어요. 저장이 안 됐을 수 있으니 해당 화면을 한 번 확인해주세요.",
        "",
        line,
        ...(earlier.length ? ["", `그 전 10분 동안 함께 발생한 오류 ${earlier.length}건:`, ...earlier] : []),
      ].join("\n"),
    });
  } catch (err) {
    console.error("[client-error] 알림 메일 실패:", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true, emailed: true });
}
