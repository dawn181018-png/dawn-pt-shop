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

  // /sign/<token>은 고객이 문자/카톡으로 받은 계약서 링크 서명 화면이다. 로그인 여부·계정 종류(트레이너/회원)와
  // 상관없이 항상 그대로 열려야 하므로(서명 권한은 링크 토큰을 서버에서 검증해 판단) 아래 리다이렉트를 모두 건너뛴다.
  if (pathname.startsWith("/sign/")) return supabaseResponse;
  // reset-password/auth callback은 "비밀번호 재설정 중" 임시 세션으로 접근하므로
  // 로그인 여부와 무관하게 항상 허용해야 한다 (로그인 상태여도 튕겨내면 안 됨).
  // /api/cron/*은 Vercel Cron이 쿠키 세션 없이 호출하므로 여기서 로그인 리다이렉트 대상에서 제외하고,
  // 대신 각 라우트 안에서 CRON_SECRET 헤더를 직접 검증한다.
  // /mypage/login은 회원용 매직링크 로그인 페이지라 트레이너용 /login과 별도로 공개 경로에 둔다.
  // /delegate-login은 대리 레슨 "로그인 링크"(1회용 token_hash)를 여는 화면이라 로그인 전에도 열려야 한다.
  const publicPaths = ["/login", "/forgot-password", "/reset-password", "/auth/callback", "/delegate-login", "/api/cron/", "/mypage/login"];
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
    const isDelegate = user.app_metadata?.role === "delegate";
    const isProxyPath = pathname.startsWith("/proxy");

    // 대리 레슨 트레이너(role === "delegate")는 /proxy(대리 레슨 전용 화면) 밖으로 나갈 수 없다 —
    // 주소창에 관리자 경로(/ 등)나 마이페이지를 직접 입력해도 /proxy로 되돌린다. (/auth/*는 새 로그인 링크용)
    // 화면 이동만 막는 게 아니라, 데이터 자체도 DB에서 지정 고객/기간으로 제한된다(proxy_* 함수).
    if (isDelegate && !isProxyPath && !pathname.startsWith("/auth/")) {
      const url = request.nextUrl.clone();
      url.pathname = "/proxy";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (!isDelegate && isProxyPath) {
      const url = request.nextUrl.clone();
      url.pathname = isMember ? "/mypage" : "/";
      return NextResponse.redirect(url);
    }

    // 회원이 마이페이지 밖(관리자 라우트 포함)으로 나가려 하거나, 이미 로그인된 채 회원 로그인
    // 화면으로 다시 들어오면 항상 /mypage로 보낸다. 이게 회원 <-> 관리자 라우트 분리의 핵심.
    if (isMember && (!isMypagePath || isMypageLogin)) {
      const url = request.nextUrl.clone();
      url.pathname = "/mypage";
      return NextResponse.redirect(url);
    }

    // 트레이너 계정이 마이페이지 라우트로 들어오면 관리자 홈으로 되돌린다.
    if (!isMember && !isDelegate && isMypagePath && !isMypageLogin) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
