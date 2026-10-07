# Account deletion (CONTRACT §2, BRD §14; AC25). Runs last: it creates and erases its own accounts.
LEAVER_EMAIL="apitest+leaver${STAMP}@houseplan.test"
LEAVER="$(paid "$LEAVER_EMAIL" "Lee Leaver")"
TOKEN="$LEAVER"
call POST /projects 201 '{"name":"Soon gone","type":"extension","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":1,"finish_tier":"standard"}'
GONE_PROJECT="$(js 'd.data.id')"

call POST /me/deletion 403 '{"action_token":"forged.token","confirm":true}'; check 'd.error.code==="REAUTH_REQUIRED"' 'deletion needs a fresh re-authentication'
call POST /auth/reauth 200 "{\"password\":\"$PASSWORD\"}"; ACT="$(js 'd.data.action_token')"
call POST /me/deletion 400 "{\"action_token\":\"$ACT\"}"; check 'd.error.field_errors[0].field==="confirm"' 'an explicit confirmation is required'
call POST /me/deletion 200 "{\"action_token\":\"$ACT\",\"confirm\":true}"
check 'Boolean(d.data.deletion_job_id)&&d.data.receipt.email==="'"$LEAVER_EMAIL"'"' 'a deletion receipt'
TOKEN=""
call POST /auth/login 401 "{\"email\":\"$LEAVER_EMAIL\",\"password\":\"$PASSWORD\"}"; check 'd.error.code==="AUTH_INVALID_CREDENTIALS"' 'the account can no longer sign in'
TOKEN="$LEAVER"
call GET /me 401,403
call GET "/projects/$GONE_PROJECT" 401,403; check "!d.error || [\"AUTH_TOKEN_EXPIRED\",\"ACCOUNT_DISABLED\"].includes(d.error.code)" "a still-valid token is refused (no profile is recreated)"

echo "  AC25 an unpaid, unverified account can delete itself"
QUITTER_EMAIL="apitest+quitter${STAMP}@houseplan.test"
QUITTER="$(register "$QUITTER_EMAIL" "Quinn Quitter")"
TOKEN="$QUITTER"
call GET /billing/status 200; check 'd.data.access===false' 'no subscription'
call POST /auth/reauth 200 "{\"password\":\"$PASSWORD\"}"; ACT="$(js 'd.data.action_token')"
call POST /me/deletion 200 "{\"action_token\":\"$ACT\",\"confirm\":true}"
TOKEN=""
call POST /auth/login 401 "{\"email\":\"$QUITTER_EMAIL\",\"password\":\"$PASSWORD\"}"

echo "  jobs"
s="$(curl -s -o "$OUT" -w '%{http_code}' -X POST "$API/internal/jobs/run" -H "x-job-secret: $JOB_SECRET")"
[ "$s" = 200 ] && check 'typeof d.data.ran.purged_projects==="number"&&typeof d.data.ran.quote_notices==="number"' 'scheduled jobs run by hand with the job secret' || { FAIL=$((FAIL+1)); echo "    ✗ jobs $s"; }
s="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/internal/jobs/run" -H 'x-job-secret: wrong-secret-value-123')"
[ "$s" = 403 ] && { PASS=$((PASS+1)); echo "    ✓ a wrong job secret is refused"; } || { FAIL=$((FAIL+1)); echo "    ✗ wrong secret gave $s"; }
TOKEN="$OWNER_TOKEN"
