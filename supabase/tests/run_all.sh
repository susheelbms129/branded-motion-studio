#!/usr/bin/env bash
# Runs every database test suite against a THROWAWAY local Postgres (each suite builds and drops its own test database).
# Never point this at a real project.
#   PGHOST=localhost PGUSER=postgres bash supabase/tests/run_all.sh        (set PSQL_BIN if psql is not on your PATH)
set -u
cd "$(dirname "$0")"
bad=0
for t in invite_only onboarding verification directory separation; do
  printf "%-14s" "$t"
  out=$(python3 "$t/run_tests.py" 2>&1 | tail -1)
  echo "$out"
  case "$out" in *" 0 failed"*) ;; *) bad=1 ;; esac
done
exit $bad
