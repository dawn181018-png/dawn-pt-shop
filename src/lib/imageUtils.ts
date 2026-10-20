// 휴대폰으로 찍은 사진(영수증 등)을 올리기 전에 긴 변 기준으로 줄이고 JPEG로 바꿔 용량을 줄인다.
// 브라우저가 이 형식을 못 읽으면(예: 일부 HEIC) 원본 파일을 그대로 쓴다.
export async function shrinkImage(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob || file;
  } catch {
    return file;
  }
}
