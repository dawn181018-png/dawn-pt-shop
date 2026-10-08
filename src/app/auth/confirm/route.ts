import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 대리 레슨 "로그인 링크"(관리자가 복사해 전달한 1회용 링크)를 여는 경로. 링크의 token_hash를 서버에서
// 확인(verifyOtp)해 쿠키 세션을 만든 뒤 대리 레슨 화면으로 보낸다. 링크는 한 번만, 짧은 시간 동안만 유효하다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const nextParam = searchParams.get("next") ?? "/proxy";
  // 외부 주소로 튕기는 것을 막기 위해 앱 내부 경로만 허용한다.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/proxy";

  if (tokenHash && type === "magiclink") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("로그인 링크가 만료됐거나 이미 사용됐어요. 담당 트레이너에게 새 링크를 요청해주세요")}`,
  );
}
