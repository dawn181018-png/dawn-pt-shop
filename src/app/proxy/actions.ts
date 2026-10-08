"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { proxyErrorMessage } from "@/lib/proxyErrors";

const MAX_SIGNATURE_DATA_URL_LENGTH = 700_000;
const PNG_PREFIX = "data:image/png;base64,";

// 대리 트레이너의 "완료(서명)" 처리. 대리 계정은 원래 트레이너의 서명 폴더에 직접 올릴 수 없으므로:
// 1) 대리 계정 권한으로 proxy_reservation_owner를 호출해 "지금 이 예약을 대리로 처리할 수 있는지" 확인하고
//    원래 트레이너 id를 받는다(지정 고객/기간/해제 여부를 DB가 확인).
// 2) 서버(service_role)가 그 트레이너 폴더(<트레이너 uid>/delegated/...)에 서명 이미지를 올린다.
// 3) 다시 대리 계정 권한으로 proxy_set_reservation_status를 호출해 완료 + 세션 차감을 한 번에 처리한다.
export async function proxyCompleteWithSignature(
  reservationId: string,
  signatureDataUrl: string,
  workoutNote: string,
): Promise<{ ok: true; switched: boolean } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.app_metadata?.role !== "delegate") return { ok: false, error: "권한이 없어요" };
    if (!signatureDataUrl.startsWith(PNG_PREFIX) || signatureDataUrl.length > MAX_SIGNATURE_DATA_URL_LENGTH) {
      return { ok: false, error: "서명 이미지를 확인할 수 없어요. 다시 서명해주세요" };
    }

    const { data: ownerId, error: ownerError } = await supabase.rpc("proxy_reservation_owner", { p_reservation_id: reservationId });
    if (ownerError || !ownerId) return { ok: false, error: proxyErrorMessage(ownerError?.message || "not_delegated") };

    const bytes = Buffer.from(signatureDataUrl.slice(PNG_PREFIX.length), "base64");
    if (bytes.length < 100) return { ok: false, error: "서명 이미지를 확인할 수 없어요. 다시 서명해주세요" };
    const path = `${ownerId}/delegated/${reservationId}-${Date.now()}.png`;
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage.from("signatures").upload(path, bytes, { contentType: "image/png", upsert: false });
    if (uploadError) {
      console.error("[proxy] 서명 업로드 실패:", uploadError.message);
      return { ok: false, error: "서명 저장에 실패했어요. 다시 시도해주세요" };
    }

    const { data, error } = await supabase.rpc("proxy_set_reservation_status", {
      p_reservation_id: reservationId,
      p_status: "done",
      p_signature_url: path,
      p_workout_note: workoutNote.trim() ? workoutNote : null,
    });
    if (error) return { ok: false, error: proxyErrorMessage(error.message) };
    return { ok: true, switched: !!(data as { switched?: boolean } | null)?.switched };
  } catch (err) {
    console.error("[proxy] 완료 처리 오류:", err instanceof Error ? err.message : err);
    return { ok: false, error: "처리 실패, 다시 시도해주세요" };
  }
}

export async function logoutProxy() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
