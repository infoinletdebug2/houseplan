# Shared helpers for scripts/api-test.sh. Sourced, not run.
API="${API:-http://localhost:8797}/api/v1"
ROOT="${API%/api/v1}"
PASSWORD="api-test-Password-12"
STAMP="$(date +%s)$RANDOM"
VARS="$(dirname "${BASH_SOURCE[0]}")/../../.dev.vars"
JOB_SECRET="${JOB_SECRET:-$(grep -E '^JOB_SECRET=.' "$VARS" 2>/dev/null | tail -1 | cut -d= -f2-)}"
ADMIN_TOKEN="${ADMIN_TOKEN:-$(grep -E '^ADMIN_TOKEN=.' "$VARS" 2>/dev/null | tail -1 | cut -d= -f2-)}"
OUT="$(mktemp)"
PASS=0
FAIL=0
TOKEN=""
KEY=""
IFMATCH=""
ACCOUNTS=()   # "token" entries to delete on exit

uuid() { node -e "console.log(require('crypto').randomUUID())"; }
# js EXPR → evaluates EXPR against the last response body as `d`
js() { node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')||'null');const v=($1);process.stdout.write(v===undefined||v===null?'':typeof v==='object'?JSON.stringify(v):String(v))" "$OUT"; }

# call METHOD PATH EXPECTED_STATUS[,ALT] [JSON_BODY]
# POSTs get a fresh Idempotency-Key unless KEY is set; IFMATCH adds If-Match.
call() {
  local method="$1" path="$2" expect="$3" body="${4:-}"
  local args=(-s -o "$OUT" -w '%{http_code}' -X "$method" "$API$path" -H 'content-type: application/json' -H 'x-timezone: Europe/Dublin')
  [ -n "$TOKEN" ] && args+=(-H "authorization: Bearer $TOKEN")
  [ "$method" = "POST" ] && args+=(-H "idempotency-key: ${KEY:-$(uuid)}")
  [ -n "$IFMATCH" ] && args+=(-H "if-match: $IFMATCH")
  [ -n "$body" ] && args+=(--data "$body")
  local status tries=0
  status="$(curl "${args[@]}")"
  # wait out the platform's sign-in rate limit instead of failing (auth routes allow 10 a minute)
  while [ "$status" = 429 ] && [[ ",$expect," != *",429,"* ]] && [ $tries -lt 4 ]; do
    tries=$((tries + 1)); printf '    … rate limited, waiting 20s\n'; sleep 20; status="$(curl "${args[@]}")"
  done
  # A transient gateway failure (retryable 502/503) is retried the way the app does it: the SAME
  # request with the SAME Idempotency-Key, so a write that did land is replayed, never doubled.
  tries=0
  while [[ "$status" =~ ^50[23]$ ]] && [[ ",$expect," != *",$status,"* ]] && [ $tries -lt 2 ] && [ "$(js 'd&&d.error&&d.error.retryable===true')" = true ]; do
    tries=$((tries + 1)); printf '    … gateway hiccup (%s), retrying with the same key\n' "$status"; sleep 2; status="$(curl "${args[@]}")"
  done
  if [[ ",$expect," == *",$status,"* ]]; then
    PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %-6s %-70s %s\n' "$method" "${path:0:70}" "$status"
  else
    FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %-6s %-70s %s (expected %s)\n' "$method" "${path:0:70}" "$status" "$expect"
    head -c 900 "$OUT"; echo
  fi
}

# admin METHOD PATH EXPECTED [BODY]
admin() {
  local method="$1" path="$2" expect="$3" body="${4:-}"
  local args=(-s -o "$OUT" -w '%{http_code}' -X "$method" "$API$path" -H 'content-type: application/json' -H "x-admin-token: $ADMIN_TOKEN")
  [ -n "$body" ] && args+=(--data "$body")
  local status; status="$(curl "${args[@]}")"
  if [[ ",$expect," == *",$status,"* ]]; then PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m ADMIN  %-70s %s\n' "$method ${path:0:62}" "$status"
  else FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m ADMIN  %-70s %s (expected %s)\n' "$method ${path:0:62}" "$status" "$expect"; head -c 900 "$OUT"; echo; fi
}

check() {
  if [ "$(js "$1")" = "true" ]; then PASS=$((PASS + 1)); printf '    \033[32m✓\033[0m %s\n' "$2"
  else FAIL=$((FAIL + 1)); printf '    \033[31m✗\033[0m %s\n' "$2"; head -c 900 "$OUT"; echo; fi
}

page() { # page PATH → GET a website page, expect 200
  local s; s="$(curl -sL -o /dev/null -w '%{http_code}' "$ROOT$1")"
  if [ "$s" = 200 ]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m GET    %-70s 200\n' "$1"; else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m GET    %-70s %s\n' "$1" "$s"; fi
}

# register EMAIL [NAME] → prints the access token; the account is deleted on exit
register() {
  local t="" tries=0
  while [ -z "$t" ] && [ $tries -lt 5 ]; do
    [ $tries -gt 0 ] && sleep 20
    curl -s -X POST "$API/auth/register" -H 'content-type: application/json' -H "idempotency-key: $(uuid)" \
      --data "{\"display_name\":\"${2:-Api Tester}\",\"email\":\"$1\",\"password\":\"$PASSWORD\",\"accept_terms\":true}" -o "$OUT" >/dev/null
    t="$(js 'd&&d.data&&d.data.access_token')"
    tries=$((tries + 1))
  done
  echo "$t"
}

# paid EMAIL → register, then an operator review grant (verified email + 1 day of access). Prints the token.
paid() {
  local t; t="$(register "$1" "${2:-Api Tester}")"
  curl -s -o /dev/null -X POST "$API/admin/review-grants" -H 'content-type: application/json' -H "x-admin-token: $ADMIN_TOKEN" \
    --data "{\"email\":\"$1\",\"days\":1,\"reason\":\"api-test\",\"verify_email\":true}"
  echo "$t"
}

delete_account() { # delete_account TOKEN
  local t="$1"; [ -z "$t" ] && return
  local action
  action="$(curl -s -X POST "$API/auth/reauth" -H 'content-type: application/json' -H "authorization: Bearer $t" -H "idempotency-key: $(uuid)" --data "{\"password\":\"$PASSWORD\"}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).data.action_token||'')}catch{}})")"
  [ -n "$action" ] && curl -s -o /dev/null -X POST "$API/me/deletion" -H 'content-type: application/json' -H "authorization: Bearer $t" -H "idempotency-key: $(uuid)" --data "{\"action_token\":\"$action\",\"confirm\":true}"
}

cleanup() {
  for t in "${ACCOUNTS[@]:-}"; do delete_account "$t"; done
  rm -f "$OUT"
}
trap cleanup EXIT

summary() {
  echo
  if [ "$FAIL" -eq 0 ]; then printf '\033[32mALL GREEN: %d passed\033[0m\n' "$PASS"; else printf '\033[31m%d failed\033[0m, %d passed\n' "$FAIL" "$PASS"; fi
  [ "$FAIL" -eq 0 ]
}
