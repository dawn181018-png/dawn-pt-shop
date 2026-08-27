"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

    const supabase = await createClient();
    const origin = (await headers()).get("origin") ?? "http://localhost:3000";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/mypage`,
      },
    });

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mypage-login] 예상치 못한 오류:", message);
    return { ok: false, error: "서버 설정 오류로 로그인 링크를 보내지 못했어요. 잠시 후 다시 시도해주세요" };
  }
}
