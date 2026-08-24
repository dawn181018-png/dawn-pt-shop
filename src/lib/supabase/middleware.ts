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
  const publicPaths = ["/login", "/forgot-password", "/reset-password", "/auth/callback", "/api/cron/"];
  const guestOnlyPaths = ["/login", "/forgot-password"];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  const isGuestOnly = guestOnlyPaths.some((p) => pathname.startsWith(p));

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

  return supabaseResponse;
}
