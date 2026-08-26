import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
      // 회원용 마이페이지 매직링크 로그인일 때만 최초 1회 customers.auth_user_id를 연결하고
      // app_metadata.role="member"를 부여한다. next가 /mypage로 시작하는 경우는 오직
      // /mypage/login의 signInWithOtp 흐름뿐이라, 트레이너 로그인(비번 로그인)이나
      // 비밀번호 재설정(next=/reset-password) 흐름에는 전혀 영향을 주지 않는다.
      if (next.startsWith("/mypage")) {
        await linkMypageMember(supabase);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("인증 링크가 유효하지 않아요")}`);
}

async function linkMypageMember(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role === "member") return;

  // service_role로 RLS를 우회해야 한다: 이 시점의 회원 계정은 아직 customers에 연결되지 않아
  // 일반 클라이언트로는 자기 customers 행을 조회할 RLS 권한이 없다.
  const admin = createAdminClient();

  const { data: alreadyLinked } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!alreadyLinked) {
    const { data: matched } = await admin
      .from("customers")
      .select("id")
      .ilike("email", user.email ?? "")
      .is("auth_user_id", null)
      .limit(1)
      .maybeSingle();
    if (!matched) return; // 매칭 실패 - /mypage 쪽에서 안내 후 로그아웃 처리
    await admin.from("customers").update({ auth_user_id: user.id }).eq("id", matched.id);
  }

  await admin.auth.admin.updateUserById(user.id, { app_metadata: { role: "member" } });
}
