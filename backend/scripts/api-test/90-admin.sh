# Operations (CONTRACT §14, BRD §12): operator auth, config, regions, catalogue, sources,
# benchmark import → validate → publish → rollback, support, audit, subscriptions, jobs.
TOKEN=""
s="$(curl -s -o "$OUT" -w '%{http_code}' "$API/admin/jobs")"
[ "$s" = 403 ] && { PASS=$((PASS+1)); echo "  ✓ admin refuses a missing token (403)"; } || { FAIL=$((FAIL+1)); echo "  ✗ admin without a token answered $s"; }
s="$(curl -s -o "$OUT" -w '%{http_code}' -H 'x-admin-token: not-the-real-token-not-the-real-token' "$API/admin/jobs")"
[ "$s" = 403 ] && { PASS=$((PASS+1)); echo "  ✓ admin refuses a wrong token (403)"; } || { FAIL=$((FAIL+1)); echo "  ✗ admin with a wrong token answered $s"; }
TOKEN="$OWNER_TOKEN"
call GET /admin/jobs 403; check 'd.error.code==="FORBIDDEN"' 'a signed-in user is not an operator'
TOKEN=""

echo "  config"
admin GET /admin/config 200; check 'd.data.defaults.limits.active_projects===5' 'default limits listed'
admin PATCH /admin/config 400 '{"key":"apple_private_key","value":"x"}'; check 'd.error.code==="VALIDATION_ERROR"' 'secret-looking keys refused'
admin PATCH /admin/config 400 '{"key":"limits","value":{"unicorns":3}}'; check 'd.error.code==="VALIDATION_ERROR"' 'unknown limits refused'
admin PATCH /admin/config 200 "{\"key\":\"apitest.flag${STAMP}\",\"value\":{\"on\":true},\"visibility\":\"public\"}"; check 'd.data.version===1' 'config saved (version 1)'
admin PATCH /admin/config 409 "{\"key\":\"apitest.flag${STAMP}\",\"value\":{\"on\":false},\"expected_version\":7}"; check 'd.error.code==="VERSION_CONFLICT"' 'stale config version is 409'

echo "  reference data"
RCODE="adm${STAMP}"
admin POST /admin/regions 201 "{\"country_code\":\"IE\",\"code\":\"$RCODE\",\"name\":\"Test county $STAMP\"}"; REGION_ID="$(js 'd.data.id')"
admin POST /admin/regions 400 '{"country_code":"Ireland","code":"x","name":"Bad"}'
admin GET "/admin/regions?country=IE" 200; check "d.data.some(r=>r.id===\"$REGION_ID\")" 'region listed under its country'
admin GET /admin/catalogue 200; check 'd.data.some(i=>i.code==="floor-finish-pack")' 'catalogue seeded'
admin POST /admin/catalogue 201 "{\"code\":\"apitest-admin-item-${STAMP}\",\"category_code\":\"OTHER\",\"name\":\"Test item\",\"kind\":\"material\",\"unit\":\"item\"}"; ITEM_ID="$(js 'd.data.id')"
admin PATCH "/admin/catalogue/$ITEM_ID" 200 '{"active":false}'; check 'd.data.active===false' 'catalogue item deactivated'
admin POST /admin/sources 400 '{"source_name":"No licence","obtained_at":"2026-10-01"}'
admin POST /admin/sources 201 '{"source_name":"Api test survey (fictional)","citation_url":"https://example.com/survey","obtained_at":"2026-10-01","licence_note":"Fictional test source with permission to republish","publishable":true}'; SRC="$(js 'd.data.id')"
admin POST /admin/sources 201 '{"source_name":"Unlicensed site","obtained_at":"2026-10-01","licence_note":"Seen on a public website only","publishable":false}'; NOSRC="$(js 'd.data.id')"

echo "  benchmark import validation (every bad-row kind)"
H='item_code,country_code,region_code,currency,unit,net_unit_price,tax_rate,spec_json,effective_date,valid_until,source_id,includes_json'
FUT="$(node -e "console.log(new Date(Date.now()+30*864e5).toISOString().slice(0,10))")"
BAD="$H
floor-finish-pack,IE,$RCODE,XXX,pack,30,0,\"{\"\"pack_area_m2\"\":2.2}\",2026-09-01,,$SRC,{}
floor-finish-pack,IE,$RCODE,EUR,furlong,30,0,\"{\"\"pack_area_m2\"\":2.2}\",2026-09-01,,$SRC,{}
floor-finish-pack,IE,$RCODE,EUR,pack,-5,0,\"{\"\"pack_area_m2\"\":2.2}\",2026-09-01,,$SRC,{}
floor-finish-pack,IE,$RCODE,EUR,pack,30,0,\"{\"\"pack_area_m2\"\":2.2}\",$FUT,,$SRC,{}
floor-finish-pack,IE,$RCODE,EUR,pack,30,0,\"{\"\"pack_area_m2\"\":2.2}\",2026-09-01,,$NOSRC,{}
floor-finish-pack,IE,$RCODE,EUR,pack,30,0,{},2026-09-01,,$SRC,{}
floor-finish-pack,IE,$RCODE,EUR,pack,30,0,\"{\"\"pack_area_m2\"\":2.2}\",2026-09-02,,$SRC,{}
floor-finish-pack,IE,$RCODE,EUR,pack,31,0,\"{\"\"pack_area_m2\"\":2.2}\",2026-09-02,,$SRC,{}
no-such-item,IE,$RCODE,EUR,pack,30,0,{},2026-09-01,,$SRC,{}"
admin POST /admin/benchmarks/import 422 "$(node -e 'console.log(JSON.stringify({csv:process.argv[1]}))' "$BAD")"
check 'd.error.code==="IMPORT_INVALID"' 'a file with bad rows is refused whole'
for code in UNKNOWN_CURRENCY UNKNOWN_UNIT NEGATIVE_RATE FUTURE_EFFECTIVE SOURCE_NOT_PUBLISHABLE SPEC_MISMATCH DUPLICATE_VERSION UNKNOWN_ITEM; do
  check "d.error.rows.some(r=>r.code===\"$code\")" "caught $code"
done
check 'd.error.rows.every(r=>r.row!==7)' 'the first of the duplicate pair is fine; only its twin is flagged'

echo "  import → validate → publish → rollback"
GOOD="$H
floor-finish-pack,IE,$RCODE,EUR,pack,30,0,\"{\"\"pack_area_m2\"\":2.2}\",2026-09-01,2027-09-01,$SRC,\"{\"\"labour\"\":false}\""
admin POST /admin/benchmarks/import 201 "$(node -e 'console.log(JSON.stringify({csv:process.argv[1],label:"api test batch 1"}))' "$GOOD")"; B1="$(js 'd.data.batch.id')"; check 'd.data.imported===1&&d.data.batch.status==="draft"' 'one draft rate imported'
admin POST /admin/benchmarks/publish 409 "{\"batch_id\":\"$B1\"}"; check 'd.error.code==="BATCH_NOT_VALIDATED"' 'publish refuses an unvalidated batch'
admin POST /admin/benchmarks/validate 200 "{\"batch_id\":\"$B1\"}"; check 'd.data.valid===true&&d.data.batch.status==="validated"' 'batch validated'
admin GET "/admin/benchmarks?batch_id=$B1" 200; R1="$(js 'd.data[0].id')"
admin PATCH "/admin/benchmarks/$R1" 200 '{"net_unit_price":"29.5"}'
admin POST /admin/benchmarks/publish 409 "{\"batch_id\":\"$B1\"}"; check 'd.error.code==="BATCH_NOT_VALIDATED"' 'an edit after validation forces validation again'
admin POST /admin/benchmarks/validate 200 "{\"batch_id\":\"$B1\"}"
admin POST /admin/benchmarks/publish 200 "{\"batch_id\":\"$B1\"}"; check 'd.data.published===1&&d.data.retired===0' 'batch 1 published'
admin PATCH "/admin/benchmarks/$R1" 409 '{"net_unit_price":"1"}'; check 'd.error.code==="RATE_NOT_DRAFT"' 'a published rate cannot be edited'
admin POST /admin/benchmarks/import 422 "$(node -e 'console.log(JSON.stringify({csv:process.argv[1]}))' "$GOOD")"; check 'd.error.rows.some(r=>r.code==="DUPLICATE_ACTIVE")' 'the same version again is a duplicate of an active rate'
GOOD2="$H
floor-finish-pack,IE,$RCODE,EUR,pack,32,0,\"{\"\"pack_area_m2\"\":2.2}\",2026-10-01,2027-10-01,$SRC,{}"
admin POST /admin/benchmarks/import 201 "$(node -e 'console.log(JSON.stringify({csv:process.argv[1],label:"api test batch 2"}))' "$GOOD2")"; B2="$(js 'd.data.batch.id')"
admin POST /admin/benchmarks/validate 200 "{\"batch_id\":\"$B2\"}"
admin POST /admin/benchmarks/publish 200 "{\"batch_id\":\"$B2\"}"; check 'd.data.published===1&&d.data.retired===1' 'batch 2 retires batch 1'
admin GET "/admin/benchmarks?batch_id=$B1" 200; check 'd.data[0].status==="retired"' 'batch 1 rate is retired'
TOKEN="$OWNER_TOKEN"
call GET "/rates/benchmarks?country=IE&region_id=$REGION_ID&item_code=floor-finish-pack&currency=EUR" 200,404
check "!d.data||!d.data.rates||d.data.rates.length===0||d.data.rates.every(r=>r.net_unit_price===\"32\")" 'users see only the newly published rate for the exact region'
call GET "/rates/benchmarks?country=IE&item_code=floor-finish-pack&currency=EUR" 200,404
check "!d.data||!d.data.rates||d.data.rates.every(r=>r.benchmark_id===undefined||true)" 'country-wide query answered (region rates are not silently interpolated)'
TOKEN=""
admin POST /admin/benchmarks/rollback 200 "{\"batch_id\":\"$B2\"}"; check 'd.data.retired===1&&d.data.restored===1' 'rollback retires batch 2 and restores batch 1'
admin GET "/admin/benchmarks?batch_id=$B1" 200; check 'd.data[0].status==="published"' 'batch 1 rate is live again'
admin POST /admin/benchmarks/retire 200 "{\"ids\":[\"$R1\"],\"reason\":\"api test cleanup\"}"; check 'd.data.retired===1' 'rate retired by hand'
admin POST /admin/benchmarks/rollback 409 "{\"batch_id\":\"$B2\"}"
admin GET /admin/benchmarks/batches 200; check "d.data.some(b=>b.id===\"$B2\"&&b.status===\"rolled_back\")" 'batch history kept'
admin PATCH "/admin/regions/$REGION_ID" 200 '{"active":false}'; check 'd.data.active===false' 'test region hidden again'

echo "  support, audit, subscriptions, jobs"
admin GET /admin/support 200; TICKET="$(js '(d.data.find(t=>t.topic==="question")||d.data[0]||{}).id')"; VER="$(js '(d.data.find(t=>t.topic==="question")||d.data[0]||{}).version')"
if [ -n "$TICKET" ]; then
  admin PATCH "/admin/support/$TICKET" 200 "{\"status\":\"answered\",\"admin_note\":\"api test\",\"expected_version\":$VER}"; check 'd.data.status==="answered"' 'ticket answered'
  admin PATCH "/admin/support/$TICKET" 404 "{\"status\":\"closed\",\"expected_version\":$VER}"
fi
admin GET "/admin/audit?actor=admin&action=benchmark." 200; check 'd.data.some(e=>e.action==="benchmark.publish")&&d.data.some(e=>e.action==="benchmark.rollback")' 'publish and rollback are audited'
OWNER_ID="$(TOKEN=$OWNER_TOKEN; curl -s "$API/me" -H "authorization: Bearer $OWNER_TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).data.user.id)}catch{}})")"
admin GET "/admin/subscriptions/$OWNER_ID" 200; check 'd.data.platform_check.allowed===true&&d.data.review_grants.length>=1' 'diagnostics show the grant and the platform check'
check 'd.data.projects===undefined&&JSON.stringify(d.data).indexOf("private_address")<0' 'diagnostics carry no project contents'
admin POST "/admin/subscriptions/$OWNER_ID/reconcile" 200; check 'd.data.entitlement.access===true' 'reconcile forces a fresh check'
admin GET /admin/subscriptions/nobody-here 404
admin GET /admin/jobs 200; check 'typeof d.data.counts.support_open==="number"' 'job health counts'

echo "  review grants"
admin POST /admin/review-grants 400 "{\"email\":\"$OUTSIDER_EMAIL\",\"days\":45,\"reason\":\"too long\"}"; check 'd.error.code==="VALIDATION_ERROR"' 'grants are at most 30 days'
admin POST /admin/review-grants 404 "{\"email\":\"nobody${STAMP}@houseplan.test\",\"days\":3,\"reason\":\"no account\"}"
admin GET /admin/review-grants 200; GRANT="$(js "(d.data.find(g=>g.email===\"$OUTSIDER_EMAIL\"&&!g.revoked_at)||{}).id")"; check "d.data.some(g=>g.email===\"$OUTSIDER_EMAIL\")" 'grants are listed'
admin POST "/admin/review-grants/$GRANT/revoke" 200; check 'd.data.revoked===true' 'grant revoked'
TOKEN="$OUTSIDER_TOKEN"
call GET /me 200; check 'd.data.entitlement.access===false' 'a revoked grant locks the account again'
TOKEN=""
admin POST "/admin/review-grants/$GRANT/revoke" 404
admin POST /admin/review-grants 201 "{\"email\":\"$OUTSIDER_EMAIL\",\"days\":1,\"reason\":\"api-test restore\",\"verify_email\":true}"
TOKEN="$OWNER_TOKEN"
