"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { findPendingSaleByToken, loadSignView } from "@/lib/supabase/pendingSaleServer";
import { isValidSignToken, type SignViewData } from "@/lib/pendingSale";

// 서명 이미지(PNG data URL) 크기 상한 — 정상적인 손글씨 서명은 수십~백 KB 수준이다.
const MAX_SIGNATURE_DATA_URL_LENGTH = 700_000;
const PNG_PREFIX = "data:image/png;base64,";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "유효하지 않은 링크예요. 담당 트레이너에게 문의해주세요",
  not_pending: "이미 서명이 완료됐거나 취소된 링크예요",
  expired: "링크 유효기간(7일)이 지났어요. 담당 트레이너에게 새 링크를 요청해주세요",
};

// 고객이 링크 화면에서 서명 완료를 누르면 호출된다. 토큰을 다시 검증하고, 서명 이미지를 그 트레이너의
// 스토리지 폴더에 올린 뒤, DB 함수 confirm_pending_sale로 고객/이용권/계약서 기록을 한 번에 확정한다.
// (업로드 후 확정이 실패하면 이미지 파일만 남고 데이터는 전혀 생기지 않는다.)
export async function signPendingSale(
  token: string,
  signatureDataUrl: string,
): Promise<{ ok: true; view: SignViewData } | { ok: false; error: string }> {
  try {
    if (!isValidSignToken(token)) return { ok: false, error: ERROR_MESSAGES.invalid_token };
    if (!signatureDataUrl.startsWith(PNG_PREFIX) || signatureDataUrl.length > MAX_SIGNATURE_DATA_URL_LENGTH) {
      return { ok: false, error: "서명 이미지를 확인할 수 없어요. 다시 서명해주세요" };
    }
    const row = await findPendingSaleByToken(token);
    if (!row) return { ok: false, error: ERROR_MESSAGES.invalid_token };
    if (row.status !== "pending") return { ok: false, error: ERROR_MESSAGES.not_pending };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: ERROR_MESSAGES.expired };

    const bytes = Buffer.from(signatureDataUrl.slice(PNG_PREFIX.length), "base64");
    if (bytes.length < 100) return { ok: false, error: "서명 이미지를 확인할 수 없어요. 다시 서명해주세요" };

    const admin = createAdminClient();
    // 현장 서명의 계약서 서명 이미지와 같은 버킷/폴더 규칙(트레이너 uid/contracts/...)을 따른다.
    const path = `${row.owner_id}/contracts/link-${row.id}-${Date.now()}.png`;
    const { error: uploadError } = await admin.storage.from("signatures").upload(path, bytes, {
      contentType: "image/png",
      upsert: false,
    });
    if (uploadError) {
      console.error("[sign] 서명 이미지 업로드 실패:", uploadError.message);
      return { ok: false, error: "서명 저장에 실패했어요. 잠시 후 다시 시도해주세요" };
    }

    const { error: confirmError } = await admin.rpc("confirm_pending_sale", { p_token: token, p_signature_url: path });
    if (confirmError) {
      const known = Object.keys(ERROR_MESSAGES).find((k) => confirmError.message.includes(k));
      if (!known) console.error("[sign] 서명 확정 실패:", confirmError.message);
      return { ok: false, error: known ? ERROR_MESSAGES[known] : "서명 저장에 실패했어요. 잠시 후 다시 시도해주세요" };
    }

    return { ok: true, view: await loadSignView(token) };
  } catch (err) {
    console.error("[sign] 예상치 못한 오류:", err instanceof Error ? err.message : err);
    return { ok: false, error: "서명 저장에 실패했어요. 잠시 후 다시 시도해주세요" };
  }
}
