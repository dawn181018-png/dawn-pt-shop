// 계산 시험 전체 실행: tests/unit/*.test.mts 를 하나씩 돌리고, 하나라도 실패하면 실패로 끝난다.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL(".", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".test.mts")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", `${dir}register.mjs`, `${dir}${f}`], {
    encoding: "utf8", env: { ...process.env, TZ: "Asia/Seoul" },
  });
  const out = `${r.stdout}${r.stderr}`;
  const pass = (out.match(/^PASS /gm) || []).length;
  if (r.status !== 0) { failed++; console.log(`FAIL ${f}\n${out}`); }
  else console.log(`OK   ${f} (${pass}개 통과)`);
}
if (failed) { console.log(`\n계산 시험 실패: ${failed}개 파일`); process.exit(1); }
console.log(`\n계산 시험 ${files.length}개 파일 모두 통과`);
