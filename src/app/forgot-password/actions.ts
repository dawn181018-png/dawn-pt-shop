"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function sendResetLink(formData: FormData) {
  const email = String(formData.get("email") || "");
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  // 이메일 존재 여부를 노출하지 않기 위해 성공/실패 관계없이 동일한 안내만 표시한다.
  return { sent: true };
}
