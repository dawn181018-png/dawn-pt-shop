// 화면의 한 영역(정산서, 서명 모음)을 인쇄·PDF·PNG로 내보내는 공용 도구.
// - 인쇄/PDF: 그 영역만 담은 보이지 않는 인쇄용 창(iframe)을 만들어 인쇄 창을 연다. 인쇄 창에서 "PDF로 저장"을 고르면 PDF가 된다.
//   배경색(대리 레슨 연보라 등)이 빠지지 않도록 print-color-adjust: exact를 건다.
// - PNG: html-to-image로 그 영역을 그대로 그림 파일로 만든다(색 그대로).
// 서명 이미지는 기존처럼 잠깐만 열리는 비공개 주소(signed URL)를 그대로 쓴다 — 새 공개 링크를 만들지 않는다.

import { toBlob, toPng } from "html-to-image";

function waitForImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images);
  return Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  })))).then(() => undefined);
}

// pageCss: 인쇄 용지 설정을 바꿀 때(예: 서명 시트는 A4 한 장에 딱 맞게 여백 0).
export async function printElement(el: HTMLElement, title: string, pageCss = "@page { size:A4; margin:12mm; }"): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) { iframe.remove(); throw new Error("인쇄 창을 열 수 없어요"); }
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map((n) => n.outerHTML).join("\n");
  doc.open();
  doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title>${styles}
<style>
  html, body { background:#fff !important; margin:0; padding:0; }
  * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  ${pageCss}
  .ptm-export-area { box-shadow:none !important; max-height:none !important; overflow:visible !important; }
  .ptm-export-hide { display:none !important; }
</style></head><body class="ptm-root ptm-export-print">${el.outerHTML}</body></html>`);
  doc.close();
  await new Promise((r) => setTimeout(r, 50));
  await waitForImages(doc);
  win.focus();
  win.print();
  setTimeout(() => iframe.remove(), 1000);
}

export async function saveElementPng(el: HTMLElement, fileName: string): Promise<void> {
  const dataUrl = await toPng(el, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    filter: (node) => !(node instanceof HTMLElement && node.classList.contains("ptm-export-hide")),
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 폰의 "공유"(카카오톡 등으로 바로 보내기). 파일 공유를 지원하지 않는 브라우저면 PNG로 내려받고 "saved"를 돌려준다.
export async function shareOrSaveElementPng(el: HTMLElement, fileName: string, title: string): Promise<"shared" | "saved" | "cancelled"> {
  const name = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  const blob = await toBlob(el, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    filter: (node) => !(node instanceof HTMLElement && node.classList.contains("ptm-export-hide")),
  });
  if (!blob) throw new Error("이미지를 만들지 못했어요");
  const file = new File([blob], name, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "saved";
}

// 화면에 그려진 이미지가 모두 불러와질 때까지 기다린다(저장 전에 서명이 비어 보이지 않게).
export function waitForElementImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll("img"));
  return Promise.all(imgs.map((img) => (img.complete && img.naturalWidth > 0 ? Promise.resolve() : new Promise<void>((resolve) => {
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => resolve(), { once: true });
    setTimeout(resolve, 5000);
  })))).then(() => undefined);
}
