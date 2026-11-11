<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working solo, hands-off (this is a standing project rule)

The owner runs this project solo, often mid-PT-session on a phone, and can't babysit permission prompts. `.claude/settings.json` is configured accordingly (`defaultMode: "auto"`, broad `allow` list for routine dev work). Match that spirit in how you work:

- **Don't ask before**: editing/reading/writing files, adding features, UI changes, `npm install`, running tests, `git add`/`git commit`, `git push` to `main`, and other everyday dev work. Just do it. (Owner explicitly lifted the push-confirmation requirement on 2026-09-01 — see below.)
- **Regular `git push` no longer needs confirmation.** Push to `main` right after committing, then always check the Vercel deploy status and report success/failure back in plain language — don't just say "pushed."
- **Do stop and ask first** — every time, no standing approval — for anything that could destroy or irreversibly change existing data:
  - `DROP TABLE`, `TRUNCATE`, unconditional `DELETE FROM` (no `WHERE`), dropping/recreating a column or table, any direct write to the production Supabase database outside normal app code paths
  - `git push --force` (or any history-rewriting push) — this stays a stop-and-ask case, the owner only lifted confirmation for regular pushes
  - bulk/recursive file or folder deletion

## Reporting back to the owner

The owner is non-technical and does not read code — file:line references and diff-style summaries don't land. After making a change, report in plain language: what was wrong/what was added (one line), what to check on screen (one line). Skip code references entirely unless the owner asks to see the code.

## Self-check before schema/deploy work

For anything touching the Supabase schema or a deploy, work through this yourself before calling it done:

1. **Analyze**: what does this change touch, and could it affect existing data or existing features?
2. **Implement**: make the change.
3. **Verify**: re-read what you just did specifically looking for (a) breakage in other features that touch the same table/component, (b) any risk of existing data being lost or corrupted.

If step 3 turns up something you're not sure about, stop and ask — that's the one exception to working hands-off. If it checks out, proceed and report back briefly: what you checked and why it's safe. Don't skip the report even when nothing was wrong — the owner isn't watching the screen while it happens.

## 자동 점검 (2026-11-11 도입 — 오류 예방 규칙)

- 코드를 GitHub에 올리면 Actions "자동 점검"이 타입·lint·계산 시험(`tests/unit`)·빈 시험용 DB 회귀 시험(`tests/db`)·빌드를 돌린다.
  **빨간 X(실패)면 main에 합치지 않는다.** 합치기 전에 그 브랜치의 점검 결과를 확인하고 사장님께 같이 알린다.
- 새 기능·버그 수정에는 그 내용을 확인하는 시험을 같이 추가한다(자세한 규칙: `docs/CHECKLIST.md` 9·12·13번).
- 회귀 시험은 매번 새로 만든 빈 시험용 DB에서만 돈다. `tests/db/run.sh`는 로컬/CI 시험 서버가 아니면 멈춘다 — 운영 DB에 시험을 돌리지 않는다.
