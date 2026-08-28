"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkMypageMember } from "@/lib/supabase/mypageLink";

export async function requestMypageLink(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { ok: false, error: "이메일을 입력해주세요" };

  // createAdminClient()가 환경변수 누락 등으로 던지는 예외까지 전부 잡아서, 화면에서
  // "전송 중..."에 멈춰있지 않고 항상 결과(성공/에러 메시지)가 뜨도록 한다.
  try {
    // 로그인 전 이메일 매칭이라 일반 클라이언트로는 customers를 조회할 RLS 권한이 없다 -> admin 클라이언트 필요.
    const admin = createAdminClient();
    const { data: matched, error: lookupError } = await admin
      .from("customers")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.error("[mypage-login] customers 조회 실패:", lookupError.message);
      return { ok: false, error: "확인 중 오류가 발생했어요. 잠시 후 다시 시도해주세요" };
    }
    if (!matched) return { ok: false, error: "등록된 회원 정보가 없습니다" };

    // 링크 클릭 방식은 메일 앱 내장 브라우저에서 PKCE 세션 저장소가 달라져 실패하는 경우가 많아,
    // 이메일에 같이 오는 인증 코드(숫자)를 입력받는 방식을 기본으로 쓴다. emailRedirectTo는 혹시
    // 메일 클라이언트가 링크로도 접근할 경우를 위한 보조 경로로 남겨둔다.
    const supabase = await createClient();
    const origin = (await headers()).get("origin") ?? "http://localhost:3000";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/mypage`,
      },
    });

    if (error) {
      console.error("[mypage-login] signInWithOtp 실패:", error.name, error.status, error.message);
      const detail = error.message || error.name || `status ${error.status}` || "unknown";
      // TODO: 원인 확인되면 사용자 노출용 일반 메시지로 되돌리기
      return { ok: false, error: `[진단용] ${detail}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}));
    console.error("[mypage-login] 예상치 못한 오류:", err);
    // TODO: 원인 확인되면 사용자 노출용 일반 메시지로 되돌리기
    return { ok: false, error: `[진단용] 예상치 못한 오류: ${message}` };
  }
}

export async function verifyMypageCode(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = String(formData.get("email") || "").trim();
  const code = String(formData.get("code") || "").trim();
  if (!code) return { ok: false, error: "인증 코드를 입력해주세요" };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) return { ok: false, error: "인증 코드가 올바르지 않거나 만료됐어요. 다시 시도해주세요" };

    await linkMypageMember(supabase);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mypage-login] 코드 확인 중 오류:", message);
    return { ok: false, error: "확인 중 오류가 발생했어요. 잠시 후 다시 시도해주세요" };
  }
}
