// 휴대폰 화면 모양 회귀 시험(파일 내용 검사). 2026-11-12 아이폰에서 화면이 폭보다 넓어지던 원인이 다시 들어오지 않게 막는다.
// - 화면 폭 설정: 기기 폭에 맞추고, 손가락 확대·축소는 막지 않는다.
// - 입력칸 16px: 아이폰 Safari 자동 확대 방지(휴대폰 폭에서만).
// - 화면 속에 직접 박은 "1fr" 칸 나누기 금지: 휴대폰용 설정이 덮어쓰지 못해 큰 금액이 화면을 옆으로 밀었다.
// - 휴대폰 시간표: 50분 수업 카드가 두 줄(이름·시간 / 상태·이용권·잔여)을 다 보여주는 크기인지.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(root + p, "utf8");
let fail = 0;
const show = (label: string, ok: boolean, detail = "") => { if (!ok) fail++; console.log(ok ? "PASS" : "FAIL", label, detail); };

const layout = read("src/app/layout.tsx");
const vp = layout.match(/export const viewport[^=]*=\s*\{([\s\S]*?)\};/);
show("화면 폭 설정이 있다(기기 폭, 처음 배율 1)", !!vp && /width:\s*"device-width"/.test(vp[1]) && /initialScale:\s*1\b/.test(vp[1]));
show("손가락 확대·축소를 막지 않는다", !!vp && !/maximumScale|userScalable|minimumScale/.test(vp[1]));

const globals = read("src/app/globals.css");
const m = globals.match(/@media\s*\(max-width:\s*640px\)\s*\{\s*input,\s*select,\s*textarea\s*\{([^}]*)\}/);
show("휴대폰 폭 입력칸 글자 16px", !!m && /font-size:\s*16px/.test(m[1]));

const ptm = read("src/components/PTMemberManager.tsx");
const inlineFr = ptm.match(/gridTemplateColumns:\s*"[^"]*\b1fr\b[^"]*"/g) || [];
show("큰 화면 파일에 직접 박은 1fr 칸 나누기가 없다", inlineFr.length === 0, inlineFr.join(" , "));

const mms = read("src/components/MobileMonthSchedule.tsx");
const px = Number((mms.match(/PX_PER_MIN\s*=\s*([\d.]+)/) || [])[1]);
const compactAt = Number((mms.match(/height\s*<\s*(\d+)\s*\?\s*"compact"/) || [])[1]);
const card50 = Math.max(26, 50 * px - 2);
show("시간표 1시간 높이 60px 이하(달력과 한 화면)", px > 0 && px * 60 <= 60, `1시간=${px * 60}px`);
show("50분 수업 카드는 두 줄(요약 아님)로 보인다", compactAt > 0 && card50 >= compactAt, `카드=${card50}px, 한 줄 기준<${compactAt}px`);
show("50분 카드가 너무 작지 않다(글자 두 줄 들어갈 높이)", card50 >= 44, `${card50}px`);

const css = read("src/components/ptm.css");
const cellMin = Number((css.match(/\.ptm-mcal-cell \{[^}]*min-height:(\d+)px/) || [])[1]);
show("휴대폰 달력 날짜 줄은 낮게(시간표가 더 보이게)", cellMin > 0 && cellMin <= 32, `날짜 줄 최소 ${cellMin}px`);
show("스케줄 화면은 실제 보이는 높이(dvh)로 나눠 시간표가 아래까지 채운다", /\.ptm-root\.ptm-msched \{[^}]*height:100dvh/.test(css) && /\.ptm-mtl-scroll \{[^}]*flex:1 1 0/.test(css));
show("시간표 높이를 스크립트로 한 번만 재지 않는다(아이폰에서 아래가 비던 원인)", !/style\.height\s*=/.test(mms));

// 2026-11-27 휴대폰 창 겹침: 창 배경이 화면 위 "백업 받기/로그아웃"(z-index 100)보다 위에 있어야 하고, 닫기 버튼은 44px.
const page = read("src/app/page.tsx");
const topZ = Number((page.match(/zIndex:\s*(\d+)/) || [])[1]);
const mobileOverlay = css.match(/@media \(max-width:640px\) \{\s*\.ptm-overlay \{[^}]*z-index:(\d+)/);
show("휴대폰 창 배경이 백업/로그아웃 버튼보다 위층", !!mobileOverlay && Number(mobileOverlay[1]) > topZ, `배경 ${mobileOverlay?.[1]} > 버튼 ${topZ}`);
show("휴대폰 창은 아이폰 시계 영역(안전 영역)을 피함", /\.ptm-overlay \{[^}]*safe-area-inset-top/.test(css));
show("휴대폰 닫기(X) 버튼 44px", /\.ptm-sheet-head \.ptm-icon-btn:has\(> svg\.lucide-x\) \{[^}]*width:44px; height:44px/.test(css));
show("로그아웃 전에 확인창", /confirm\("로그아웃 하시겠습니까\?"\)/.test(read("src/app/LogoutButton.tsx")) && page.includes("<LogoutButton"));
show("창 공통 동작(끌어서 닫기·입력 중 잠금·뒤 화면 고정)이 화면에 붙어 있음", ptm.includes("<MobileSheetBehavior />"));

if (fail) { console.log(`\n${fail}개 실패`); process.exit(1); }
