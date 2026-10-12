# 새 기능 추가 전 점검 체크리스트 (Claude Code에 그대로 붙여넣기)

아래 순서를 지켜서 작업해줘. 코딩을 모르는 사장님이 쓰는 앱이야.

1. **되돌릴 지점**: 시작 전에 `git tag before-<작업이름>-<날짜>` 를 만들고 push해줘.
2. **백업**: 관리자 화면 오른쪽 위 [백업 받기]로 받은 최신 파일이 있는지 물어봐줘.
3. **위험 구역 확인**: `docs/DANGER_ZONES.md`를 먼저 읽고, 이번 작업이 거기 적힌 곳을 건드리는지 알려줘.
4. **DB 변경은 "추가만"**: 표/칸 삭제·변경, DELETE·TRUNCATE·DROP·조건 없는 UPDATE는 절대 직접 실행하지 말고,
   필요하면 `supabase/schema.sql` 끝에 "추가만 하는" SQL로 남긴 뒤 나한테 실행을 부탁해줘.
5. **돈·횟수 계산**: 잔여 횟수는 `src/lib/productUtils.ts`의 `remainingSessions`, 아직 예약 안 된 횟수는
   `src/lib/recurring.ts`의 `unbookedSessions`만 써. 매출 합계는 "실제 결제(입금)금액" 기준(미수금 별도).
   계산 방식이 바뀌는 변경은 먼저 나한테 물어봐줘.
6. **세션 차감**: 완료/노쇼/취소/삭제는 DB 함수(set_reservation_status, delete_reservation 등)로 한 번에 처리해.
   예약 저장과 차감을 따로 두 번 요청하는 코드를 새로 만들지 마.
7. **삭제 대신 보관**: 고객·이용권은 지우지 말고 archived_at(보관)을 써.
8. **권한**: 새 표를 만들면 RLS(본인 데이터만) 정책과 GRANT를 같이 넣고, anon(로그인 안 한 사용자)에게는 열지 마.
9. **한 문제 = 커밋 하나**, 작업 후 `npx tsc --noEmit`, `npx eslint .`, `npx next build` 통과 확인.
10. **배포 확인**: main에 push 후 Vercel 배포 성공 여부를 확인하고, 결과를 쉬운 말로 보고해줘
    (무엇이 바뀌었는지 한 줄 + 내가 화면에서 확인할 곳 한 줄).
11. **점검 쿼리**: 큰 작업 뒤에는 `supabase/checks/row_counts.sql`(행 개수)과 `integrity_checks.sql`(어긋난 데이터)을
    내가 SQL Editor에서 돌릴 수 있게 안내해줘.
