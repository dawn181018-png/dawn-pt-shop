#!/usr/bin/env bash
# DB 회귀 시험 실행기 — 매번 "새 빈 시험용 DB"를 만들어 전체 구조(supabase/schema.sql)를 설치하고 시험한 뒤 지운다.
# 운영 DB에는 절대 연결하지 않는다: 접속 대상이 로컬/CI 시험 서버(localhost, 127.0.0.1, 유닉스 소켓, postgres)가 아니면 멈춘다.
# 사용: PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres bash tests/db/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

host="${PGHOST:-localhost}"
case "$host" in
  localhost|127.0.0.1|postgres|/*) ;;
  *) echo "멈춤: 시험은 로컬/CI 시험용 Postgres에서만 돌린다 (PGHOST=$host)"; exit 2 ;;
esac
if [[ "${PGDATABASE:-}" == *supabase* || "$host" == *supabase* ]]; then echo "멈춤: 운영 DB로 보이는 접속 정보"; exit 2; fi

db="ptshop_check_$$"
psql -X -q -d postgres -c "create database $db" >/dev/null
trap 'psql -X -q -d postgres -c "drop database if exists $db" >/dev/null 2>&1 || true' EXIT

psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f tests/db/00_mock_supabase.sql >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/schema.sql >/dev/null 2>&1 || {
  echo "실패: supabase/schema.sql 이 빈 DB에 설치되지 않음"; psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/schema.sql 2>&1 | grep -iE "error" | head -5; exit 1; }
# 변경 파일(apply-*.sql)은 "다시 실행해도 안전"해야 한다 — 전체 구조 위에 한 번 더 실행해 본다.
for f in supabase/apply-*.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$f" >/dev/null 2>&1 || { echo "실패: $f 를 다시 실행하면 오류"; exit 1; }
done
echo "OK  전체 구조 설치 + 변경 파일 재실행 안전"
out=$(psql -X -v ON_ERROR_STOP=1 -d "$db" -f tests/db/10_regression.sql 2>&1) || { echo "$out" | grep -E "PASS|FAIL|ERROR|==" ; exit 1; }
echo "$out" | grep -E "PASS|==" | sed 's/^/    /'
echo "OK  DB 회귀 시험 $(echo "$out" | grep -c PASS)개 통과"
