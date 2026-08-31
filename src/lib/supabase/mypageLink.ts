import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 회원용 마이페이지 로그인(매직링크 또는 인증 코드)에서, 최초 1회 customers.auth_user_id를
// 연결하고 app_metadata.role="member"를 부여한다. 트레이너는 이 경로를 절대 타지 않으므로
// 트레이너 로그인/권한에는 영향이 없다.
export async function linkMypageMember(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role === "member") return;

  // service_role로 RLS를 우회해야 한다: 이 시점의 회원 계정은 아직 customers에 연결되지 않아
  // 일반 클라이언트로는 자기 customers 행을 조회할 RLS 권한이 없다.
  const admin = createAdminClient();

  const { data: alreadyLinked } = await admin
    .from("customers")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!alreadyLinked) {
    // 같은 이메일을 쓰는 미연결 고객이 2명 이상이면 임의로 아무나 연결하지 않는다 —
    // requestMypageLink에서 이미 이 경우를 걸러내지만, 방어적으로 여기서도 한 번 더 확인한다.
    const { data: matched } = await admin
      .from("customers")
      .select("id")
      .ilike("email", user.email ?? "")
      .is("auth_user_id", null);
    if (!matched || matched.length !== 1) return; // 매칭 실패/중복 - /mypage 쪽에서 안내 후 로그아웃 처리
    await admin.from("customers").update({ auth_user_id: user.id }).eq("id", matched[0].id);
  }

  await admin.auth.admin.updateUserById(user.id, { app_metadata: { role: "member" } });
}
