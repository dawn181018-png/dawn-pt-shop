import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// resetPasswordForEmail을 서버 액션(server 클라이언트, 쿠키 기반)으로 호출했기 때문에
// PKCE code_verifier도 쿠키에 저장된다. 따라서 교환도 반드시 같은 서버 클라이언트로 해야
// "code verifier not found" 오류가 나지 않는다 (브라우저 클라이언트는 localStorage를 봄).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/reset-password";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("인증 링크가 유효하지 않아요")}`);
}
