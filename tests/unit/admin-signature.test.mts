// 관리자 서명 입력 계산 시험(가짜 데이터): 관리자 입력 판별, 서명 그림 정리(바탕 흰색·펜 자국·잘라 내기), 크기 맞추기, 파일 형식.
import * as A from "@/lib/adminSignature";

let fail = 0;
const show = (label: string, ok: boolean, detail = "") => { if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", label, detail); };

// ---- 관리자 입력 판별 ----
const E = (id: string, reservationId: string, action: "add" | "remove", path: string, at: string): A.SignatureAdminEntry =>
  ({ id, reservationId, action, signaturePath: path, method: action === "add" ? "paste" : null, actorId: "u", createdAt: at });
const entries = [
  E("1", "r1", "add", "u/admin/r1-1.png", "2026-11-20T01:00:00Z"),
  E("2", "r2", "add", "u/admin/r2-1.png", "2026-11-20T01:00:00Z"),
  E("3", "r2", "remove", "u/admin/r2-1.png", "2026-11-20T02:00:00Z"),
  E("4", "r3", "add", "u/admin/r3-1.png", "2026-11-20T01:00:00Z"),
];
const res = [
  { id: "r1", signatureUrl: "u/admin/r1-1.png" }, // 관리자 입력
  { id: "r2", signatureUrl: null },               // 넣었다가 지움
  { id: "r3", signatureUrl: "u/r3-own.png" },     // 기록과 다른 서명(고객 서명)
  { id: "r4", signatureUrl: "u/r4-own.png" },     // 기록 없음(고객 서명)
];
const cur = A.currentAdminSignatures(entries, res);
show("관리자가 넣은 서명만 '관리자 입력'", [...cur.keys()].join() === "r1", [...cur.keys()].join());
show("지운 뒤에는 관리자 입력 아님", !cur.has("r2"));
show("고객이 직접 한 서명은 관리자 입력 아님", !cur.has("r3") && !cur.has("r4"));
show("기록 순서가 뒤섞여도 마지막 기록 기준", !A.currentAdminSignatures([entries[2], entries[1]], res).has("r2"));

// ---- 서명 그림 정리 ----
// 회색 바탕(사진 같은 200) 40x20 그림에 진한 선(30)을 (10~29, 8~11)에 그린다
const W = 40, H = 20;
const px = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { px[i * 4] = 200; px[i * 4 + 1] = 195; px[i * 4 + 2] = 190; px[i * 4 + 3] = 255; }
for (let y = 8; y <= 11; y++) for (let x = 10; x <= 29; x++) { const i = (y * W + x) * 4; px[i] = 30; px[i + 1] = 30; px[i + 2] = 40; }
const box = A.cleanSignaturePixels(px, W, H);
show("펜 자국 영역을 찾음(여백 포함)", !!box && box.x <= 10 && box.y <= 8 && box.x + box.w >= 30 && box.y + box.h >= 12 && box.w < W, JSON.stringify(box));
show("회색 바탕은 흰색으로", px[0] === 255 && px[1] === 255 && px[2] === 255);
const ink = (9 * W + 15) * 4;
show("펜 자국은 진하게(어둡게)", px[ink] < 60 && px[ink] === px[ink + 1], String(px[ink]));
show("모두 불투명", px.every((v, i) => i % 4 !== 3 || v === 255));
const blank = new Uint8ClampedArray(W * H * 4).fill(240);
show("서명이 없는 그림 → null", A.cleanSignaturePixels(blank, W, H) === null);
const transparent = new Uint8ClampedArray(W * H * 4); // 전부 투명(=흰 바탕)
for (let y = 5; y <= 6; y++) for (let x = 5; x <= 30; x++) { const i = (y * W + x) * 4; transparent[i + 3] = 255; }
show("투명 바탕 PNG도 처리(투명=흰색)", !!A.cleanSignaturePixels(transparent, W, H) && transparent[3] === 255 && transparent[0] === 255);

// ---- 크기 ----
show("큰 그림은 600x200 안으로 비율 유지", JSON.stringify(A.fitSignatureSize(1200, 300)) === JSON.stringify({ w: 600, h: 150 }));
show("세로로 긴 그림도 높이 200 안으로", JSON.stringify(A.fitSignatureSize(300, 600)) === JSON.stringify({ w: 100, h: 200 }));
show("작은 그림은 늘리지 않음", JSON.stringify(A.fitSignatureSize(120, 40)) === JSON.stringify({ w: 120, h: 40 }));

// ---- 형식 ----
show("PNG·JPG만 허용", A.isAllowedSignatureType("image/png") && A.isAllowedSignatureType("image/jpeg") && !A.isAllowedSignatureType("image/gif") && !A.isAllowedSignatureType("image/heic") && !A.isAllowedSignatureType("application/pdf"));

if (fail) { console.log(`\n${fail}개 실패`); process.exit(1); }
