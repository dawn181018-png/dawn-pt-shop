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
      // TODO: 원인 확인되면 사용자 노출용 일반 메시지로 되돌리기
      return { ok: false, error: `[진단용] customers 조회 실패: ${lookupError.message}` };
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
    // TODO: 원인 확인되면 사용자 노출용 일반 메시지로 되돌리기
    return { ok: false, error: `[진단용] 예상치 못한 오류: ${message}` };
  }
}
