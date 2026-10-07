#!/usr/bin/env bash
# Export the web build against the harness stub, serve it, shoot every screen.
#   bash harness/run.sh            # all screens
#   bash harness/run.sh --only=20-paywall-list-price,30-projects-empty
#   bash harness/run.sh --dark
# Ports: web 8093, stub 8795, Chrome 9233 (8080/8091 belong to other apps).
set -euo pipefail
cd "$(dirname "$0")/.."
export HARNESS_WEB_PORT="${HARNESS_WEB_PORT:-8093}" HARNESS_API_PORT="${HARNESS_API_PORT:-8795}" HARNESS_CDP_PORT="${HARNESS_CDP_PORT:-9233}"
if [ "${SKIP_EXPORT:-}" != "1" ]; then
  # --clear: Metro caches the inlined env between exports (blueprint F2).
  EXPO_PUBLIC_API_URL="http://localhost:${HARNESS_API_PORT}" npx expo export --platform web --output-dir dist-web --clear > harness/export.log 2>&1 || { tail -30 harness/export.log; exit 1; }
fi
node harness/serve.mjs > harness/serve.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -s "http://localhost:${HARNESS_API_PORT}/health" > /dev/null && break; sleep 0.25; done
# A fresh Chrome profile each run: no cached false passes (blueprint J).
rm -rf harness/.chrome-profile
node harness/shoot.mjs "$@"
