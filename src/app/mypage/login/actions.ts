"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function requestMypageLink(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { ok: false, error: "이메일을 입력해주세요" };

  // 로그인 전 이메일 매칭이라 일반 클라이언트로는 customers를 조회할 RLS 권한이 없다 -> admin 클라이언트 필요.
  const admin = createAdminClient();
  const { data: matched, error: lookupError } = await admin
    .from("customers")
    .select("id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (lookupError) return { ok: false, error: "확인 중 오류가 발생했어요. 잠시 후 다시 시도해주세요" };
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
}
