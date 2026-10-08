"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// "로그인" 버튼을 눌렀을 때만 1회용 링크 토큰을 사용(verifyOtp)한다. 링크를 GET으로 여는 것만으로는 토큰을
// 쓰지 않으므로, 카카오톡 등 메신저가 미리보기를 만들려고 링크를 먼저 열어봐도 토큰이 소모되지 않는다.
export async function confirmDelegateLogin(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") || "");
  if (tokenHash) {
    const supabase = await createClient();
    // generateLink(magiclink)로 만든 토큰. 인증 서버 버전에 따라 type "email"로만 받는 경우가 있어 한 번 더 시도한다.
    let { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (error) ({ error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash }));
    if (!error) redirect("/proxy");
    console.error("[delegate-login] verifyOtp 실패:", error.message);
  }
  redirect(`/delegate-login?error=1`);
}
