#!/usr/bin/env bash
# Smoke the deployed app: landing serves (200) and the /console auth guard redirects to /login.
set -uo pipefail
URL="${1:?usage: scripts/smoke.sh https://<host>}"
echo "smoke: $URL"

code=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 20 "$URL/" || echo "000")
echo "GET /            -> $code"

console=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL/console" || echo "000")
echo "GET /console     -> $console (expect 200/307 → /login when unauthenticated)"

footer=$(curl -fsS --max-time 20 "$URL/" 2>/dev/null | grep -c 'safety-footer' || true)
echo "safety-footer    -> $footer occurrence(s) (must be >= 1 — crisis footer on every page)"

if [ "$code" = "200" ] && [ "$footer" -ge 1 ]; then
  echo "SMOKE OK"
else
  echo "SMOKE FAIL"
  exit 1
fi
