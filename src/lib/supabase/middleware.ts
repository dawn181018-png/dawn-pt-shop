import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  // reset-password/auth callback은 "비밀번호 재설정 중" 임시 세션으로 접근하므로
  // 로그인 여부와 무관하게 항상 허용해야 한다 (로그인 상태여도 튕겨내면 안 됨).
  // /api/cron/*은 Vercel Cron이 쿠키 세션 없이 호출하므로 여기서 로그인 리다이렉트 대상에서 제외하고,
  // 대신 각 라우트 안에서 CRON_SECRET 헤더를 직접 검증한다.
  // /mypage/login은 회원용 매직링크 로그인 페이지라 트레이너용 /login과 별도로 공개 경로에 둔다.
  const publicPaths = ["/login", "/forgot-password", "/reset-password", "/auth/callback", "/api/cron/", "/mypage/login"];
  const guestOnlyPaths = ["/login", "/forgot-password"];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  const isGuestOnly = guestOnlyPaths.some((p) => pathname.startsWith(p));
  const isMypagePath = pathname.startsWith("/mypage");
  const isMypageLogin = pathname.startsWith("/mypage/login");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isGuestOnly) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // 회원(마이페이지) 계정과 트레이너(관리자) 계정의 라우트를 분리한다.
  // app_metadata.role === "member"인 계정만 회원이고, 그 값이 없는(기존) 계정은 전부 트레이너로
  // 취급한다 — 기존 트레이너 로그인 동작을 절대 바꾸지 않기 위한 안전한 기본값이다.
  if (user) {
    const isMember = user.app_metadata?.role === "member";

    // 회원이 마이페이지 밖(관리자 라우트 포함)으로 나가려 하거나, 이미 로그인된 채 회원 로그인
    // 화면으로 다시 들어오면 항상 /mypage로 보낸다. 이게 회원 <-> 관리자 라우트 분리의 핵심.
    if (isMember && (!isMypagePath || isMypageLogin)) {
      const url = request.nextUrl.clone();
      url.pathname = "/mypage";
      return NextResponse.redirect(url);
    }

    // 트레이너 계정이 마이페이지 라우트로 들어오면 관리자 홈으로 되돌린다.
    if (!isMember && isMypagePath && !isMypageLogin) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
