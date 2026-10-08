"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { toLocalDateStr } from "@/lib/formatUtils";

// 대리 레슨 지정 건의 "로그인 링크 복사". 이메일 발송(Resend 도메인 미인증)을 거치지 않고, 서버가
// service_role로 그 이메일 전용 1회용 로그인 링크를 만들어 돌려준다(관리자가 카톡 등으로 직접 전달).
// - 호출자는 트레이너(관리자) 본인이어야 하고, 지정 건도 RLS로 본인 것만 읽힌다.
// - 이미 관리자/회원으로 쓰는 이메일은 대리 계정으로 바꾸지 않는다(기존 사용자의 앱 사용이 막히므로).
// - 대리 계정은 app_metadata.role = "delegate"로 만들어지고, 그 계정 id를 지정 건에 연결한다.

type AdminClient = ReturnType<typeof createAdminClient>;

async function findAuthUserByEmail(admin: AdminClient, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const found = data.users.find((u) => (u.email || "").toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function createDelegateLoginLink(delegationId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // 역할(role)이 없는 계정 = 트레이너(관리자). 회원/대리 계정은 링크를 만들 수 없다.
    if (!user || user.app_metadata?.role) return { ok: false, error: "권한이 없어요" };

    const { data: d } = await supabase
      .from("lesson_delegations")
      .select("id, delegate_email, revoked_at, ends_on")
      .eq("id", delegationId)
      .maybeSingle();
    if (!d) return { ok: false, error: "대리 지정 건을 찾을 수 없어요" };
    if (d.revoked_at) return { ok: false, error: "해제된 대리 지정이에요" };
    if (String(d.ends_on) < toLocalDateStr(new Date())) return { ok: false, error: "기간이 끝난 대리 지정이에요. 기간을 먼저 바꿔주세요" };

    const email = String(d.delegate_email || "").trim().toLowerCase();
    if (!email) return { ok: false, error: "대리 트레이너 이메일이 없어요" };
    if (email === (user.email || "").toLowerCase()) return { ok: false, error: "사장님 본인 이메일은 대리 계정으로 쓸 수 없어요" };

    const admin = createAdminClient();
    let delegateUser = await findAuthUserByEmail(admin, email);
    if (delegateUser && delegateUser.app_metadata?.role !== "delegate") {
      return { ok: false, error: "이미 관리자 또는 회원으로 쓰는 이메일이라 대리 계정으로 쓸 수 없어요. 다른 이메일로 지정해주세요" };
    }
    if (!delegateUser) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { role: "delegate" },
      });
      if (createError || !created.user) return { ok: false, error: "대리 계정을 만들지 못했어요. 잠시 후 다시 시도해주세요" };
      delegateUser = created.user;
    }

    const { error: linkUpdateError } = await admin
      .from("lesson_delegations")
      .update({ delegate_user_id: delegateUser.id })
      .eq("id", d.id);
    if (linkUpdateError) return { ok: false, error: "대리 계정 연결에 실패했어요. 잠시 후 다시 시도해주세요" };

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (linkError || !link.properties?.hashed_token) return { ok: false, error: "로그인 링크를 만들지 못했어요. 잠시 후 다시 시도해주세요" };

    const origin = (await headers()).get("origin") ?? "";
    const url = `${origin}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=magiclink&next=/proxy`;
    return { ok: true, url };
  } catch (err) {
    console.error("[delegation] 로그인 링크 생성 실패:", err instanceof Error ? err.message : err);
    return { ok: false, error: "로그인 링크를 만들지 못했어요. 잠시 후 다시 시도해주세요" };
  }
}
