// 서명 시트 "관리자 서명 입력" 공용 함수.
// - 서명 그림 정리(순수 계산): 사진·스캔본의 밝은 바탕을 흰색으로, 펜 자국은 진하게 바꾸고 서명이 있는 부분만 남긴다.
// - 관리자 입력 판별: 기록(signature_admin_entries)의 마지막 줄이 "넣음"이고 그 그림이 지금 서명과 같으면 관리자 입력.
// 저장·권한 검사는 DB 함수(admin_attach_signature / admin_remove_signature)가 한다.

export const ADMIN_SIGNATURE_MAX_BYTES = 20 * 1024 * 1024; // 받는 파일 최대 20MB(그보다 크면 막음)
export const ADMIN_SIGNATURE_TYPES = ["image/png", "image/jpeg"] as const; // PNG·JPG만
export const SIGNATURE_OUT_MAX_W = 600; // 저장 크기(서명 칸에 맞게 줄임)
export const SIGNATURE_OUT_MAX_H = 200;

export type SignatureAdminEntry = {
  id: string;
  reservationId: string;
  action: "add" | "remove";
  signaturePath: string;
  method: "paste" | "file" | null;
  actorId: string;
  createdAt: string;
};

export const isAllowedSignatureType = (type: string) => (ADMIN_SIGNATURE_TYPES as readonly string[]).includes(type.toLowerCase());

// 지금 "관리자 입력"인 서명: 예약 id → 마지막 "넣음" 기록. 예약의 지금 서명 경로와 같을 때만(지웠거나 다른 서명이면 아님).
export function currentAdminSignatures(
  entries: SignatureAdminEntry[],
  reservations: { id: string; signatureUrl?: string | null }[],
): Map<string, SignatureAdminEntry> {
  const last = new Map<string, SignatureAdminEntry>();
  [...entries]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .forEach((e) => last.set(e.reservationId, e));
  const out = new Map<string, SignatureAdminEntry>();
  reservations.forEach((r) => {
    const e = last.get(r.id);
    if (e && e.action === "add" && r.signatureUrl && e.signaturePath === r.signatureUrl) out.set(r.id, e);
  });
  return out;
}

// 서명 그림 정리: RGBA 픽셀(width*height*4)을 제자리에서 흰 바탕 + 진한 펜 자국으로 바꾸고, 펜 자국이 있는 영역(여백 포함)을 돌려준다.
// 바탕 밝기는 밝은 쪽 픽셀(상위 10%)로 어림잡고, 그보다 충분히 어두운 픽셀만 펜 자국으로 본다(그림자·종이 결은 흰색으로).
// 펜 자국이 거의 없으면 null(서명이 안 보이는 그림).
export function cleanSignaturePixels(data: Uint8ClampedArray, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  const n = width * height;
  if (n === 0) return null;
  const lum = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    // 투명한 부분은 흰 바탕으로 본다
    const r = data[i * 4] * a + 255 * (1 - a), g = data[i * 4 + 1] * a + 255 * (1 - a), b = data[i * 4 + 2] * a + 255 * (1 - a);
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = l;
    hist[Math.min(255, Math.round(l))]++;
  }
  let acc = 0, bg = 255;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.1) { bg = v; break; } }
  const threshold = Math.max(40, bg * 0.72); // 바탕보다 28% 이상 어두우면 펜 자국
  let minX = width, minY = height, maxX = -1, maxY = -1, ink = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const isInk = lum[i] < threshold;
      // 펜 자국은 원래 진하기를 살려 더 진하게(0~90), 나머지는 흰색
      const v = isInk ? Math.round((lum[i] / threshold) * 90) : 255;
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
      if (isInk) {
        ink++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (ink < Math.max(12, n * 0.0002)) return null;
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.06) + 2;
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  return { x, y, w: Math.min(width, maxX + pad + 1) - x, h: Math.min(height, maxY + pad + 1) - y };
}

// 잘라 낸 영역을 서명 칸 크기 안으로 줄일 때의 크기(늘리지는 않는다).
export function fitSignatureSize(w: number, h: number, maxW = SIGNATURE_OUT_MAX_W, maxH = SIGNATURE_OUT_MAX_H): { w: number; h: number } {
  const s = Math.min(1, maxW / w, maxH / h);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

// 브라우저 전용: 파일·클립보드 그림 → 정리된 PNG. 새 캔버스에 다시 그려 저장하므로 사진의 위치·촬영 정보(EXIF)는 남지 않는다.
export async function prepareAdminSignature(file: Blob): Promise<Blob> {
  if (!isAllowedSignatureType(file.type)) throw new Error("PNG 또는 JPG 이미지만 넣을 수 있어요");
  if (file.size > ADMIN_SIGNATURE_MAX_BYTES) throw new Error("이미지가 너무 커요(20MB 이하)");
  const bmp = await createImageBitmap(file); // 사진 방향(회전)은 브라우저가 맞춰 준다
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)); // 정리 작업용으로 먼저 줄임
  const work = document.createElement("canvas");
  work.width = Math.max(1, Math.round(bmp.width * scale));
  work.height = Math.max(1, Math.round(bmp.height * scale));
  const wctx = work.getContext("2d", { willReadFrequently: true });
  if (!wctx) throw new Error("이미지를 처리하지 못했어요");
  wctx.fillStyle = "#fff";
  wctx.fillRect(0, 0, work.width, work.height);
  wctx.drawImage(bmp, 0, 0, work.width, work.height);
  bmp.close?.();
  const img = wctx.getImageData(0, 0, work.width, work.height);
  const box = cleanSignaturePixels(img.data, work.width, work.height);
  if (!box) throw new Error("서명이 잘 보이지 않아요. 더 진하게 찍힌 이미지를 넣어주세요");
  wctx.putImageData(img, 0, 0);
  const size = fitSignatureSize(box.w, box.h);
  const out = document.createElement("canvas");
  out.width = size.w;
  out.height = size.h;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("이미지를 처리하지 못했어요");
  octx.fillStyle = "#fff";
  octx.fillRect(0, 0, size.w, size.h);
  octx.imageSmoothingQuality = "high";
  octx.drawImage(work, box.x, box.y, box.w, box.h, 0, 0, size.w, size.h);
  return await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지를 처리하지 못했어요"))), "image/png"));
}
