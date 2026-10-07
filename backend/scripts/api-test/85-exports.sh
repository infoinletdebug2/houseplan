# Exports and the portability archive (CONTRACT §13, BRD §6.12, §14; AC01, AC08, AC23).
TOKEN="$OWNER_TOKEN"
call POST /projects 201 '{"name":"Export test house","type":"renovation","country_code":"IE","currency":"EUR","unit_system":"imperial","storeys":1,"finish_tier":"standard","target_budget_minor":"9000000","private_address":"42 Private Street","postal_code":"D02 XY12"}'
EPROJ="$(js 'd.data.id')"

call POST "/projects/$EPROJ/exports" 202 '{"kind":"pdf","sections":["estimate","exclusions","contingency","provenance","finance","forecast"]}'
EPDF="$(js 'd.data.id')"; check 'd.data.status==="ready"&&d.data.filename.endsWith(".pdf")' 'a PDF export is ready'
call GET "/exports/$EPDF" 200; EURL="$(js 'd.data.download.url')"
check 'Date.parse(d.data.download.expires_at)-Date.now()<=600e3+5000' 'AC23 a 10-minute signed link'
curl -s -o "$OUT" "$EURL"
HTML="$(cat "$OUT")"
if [[ "$HTML" == *"Known subtotal"* && "$HTML" == *"Not in this total"* && "$HTML" != *"Private Street"* && "$HTML" != *"https://fonts"* && "$HTML" == *"Price missing"* ]]; then
  PASS=$((PASS+1)); echo "    ✓ AC23 self-contained report: known subtotal, exclusions first, unpriced lines shown, address omitted, no remote fonts"
else FAIL=$((FAIL+1)); echo "    ✗ PDF content"; echo "$HTML" | head -c 600; echo; fi

call POST "/projects/$EPROJ/exports" 202 '{"kind":"pdf","include_address":true}'
call GET "/exports/$(js 'd.data.id')" 200; curl -s -o "$OUT.html" "$(js 'd.data.download.url')"
grep -q "Private Street" "$OUT.html" && { PASS=$((PASS+1)); echo "    ✓ the address appears only when asked for"; } || { FAIL=$((FAIL+1)); echo "    ✗ include_address"; }

call POST "/projects/$EPROJ/exports" 202 '{"kind":"csv"}'; ECSV="$(js 'd.data.id')"
call GET "/exports/$ECSV" 200; curl -s -o "$OUT.csv" "$(js 'd.data.download.url')"
if head -c 400 "$OUT.csv" | grep -q "quantity_si,unit_si,quantity_display,unit_display" && grep -q "known_subtotal_gross" "$OUT.csv"; then PASS=$((PASS+1)); echo "    ✓ CSV with SI and display units and a summary"; else FAIL=$((FAIL+1)); echo "    ✗ CSV content"; head -c 400 "$OUT.csv"; echo; fi

echo "  signed links (AC23)"
s="$(curl -s -o /dev/null -w '%{http_code}' "${EURL%%sig=*}sig=$(printf 'b%.0s' {1..64})")"; [ "$s" = 403 ] && { PASS=$((PASS+1)); echo "    ✓ a forged signature fails"; } || { FAIL=$((FAIL+1)); echo "    ✗ forged $s"; }
s="$(curl -s -o /dev/null -w '%{http_code}' "$API/exports/$EPDF/content")"; [ "$s" = 403 ] && { PASS=$((PASS+1)); echo "    ✓ an unsigned link fails"; } || { FAIL=$((FAIL+1)); echo "    ✗ unsigned $s"; }
s="$(curl -s -o /dev/null -w '%{http_code}' "$API/exports/$EPDF/content?exp=100&sig=$(printf 'c%.0s' {1..64})")"; [ "$s" = 403 ] && { PASS=$((PASS+1)); echo "    ✓ an expired link fails"; } || { FAIL=$((FAIL+1)); echo "    ✗ expired $s"; }

call POST "/projects/$EPROJ/exports" 400 '{"kind":"docx"}'
call POST "/projects/$EPROJ/exports" 400 '{"kind":"pdf","sections":["everything"]}'
call POST "/projects/$EPROJ/exports" 404 '{"kind":"pdf","revision_id":"00000000-0000-4000-8000-000000000000"}'
call GET /exports 200; check 'd.data.length>=3' 'my exports are listed'

echo "  isolation and the paywall (AC01, AC08)"
TOKEN="$OUTSIDER_TOKEN"
call GET "/exports/$EPDF" 404
call POST "/projects/$EPROJ/exports" 404 '{"kind":"pdf"}'
TOKEN="$UNPAID_TOKEN"
call POST "/projects/$EPROJ/exports" 403 '{"kind":"pdf"}'
call GET /exports 200; check 'd.data.length===0' 'an unpaid account still sees its export list'

echo "  portability (no paywall)"
call POST /me/portability-export 403 '{"action_token":"nope"}'; check 'd.error.code==="REAUTH_REQUIRED"' 'portability needs a fresh re-authentication'
call POST /auth/reauth 200 "{\"password\":\"$PASSWORD\"}"; ACT="$(js 'd.data.action_token')"
call POST /me/portability-export 202 "{\"action_token\":\"$ACT\"}"; PORT_JOB="$(js 'd.data.id')"
call GET "/exports/$PORT_JOB" 200; check 'Boolean(d.data.download)' 'AC01 an unpaid account downloads its archive'
curl -s -o "$OUT.json" "$(js 'd.data.download.url')"
node -e "const a=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^﻿/,''));process.exit(a.format==='houseplan-portability'&&Array.isArray(a.projects)&&a.profile.length===1?0:1)" "$OUT.json" \
  && { PASS=$((PASS+1)); echo "    ✓ machine-readable archive of own records"; } || { FAIL=$((FAIL+1)); echo "    ✗ archive"; }
TOKEN="$OWNER_TOKEN"
call POST /auth/reauth 200 "{\"password\":\"$PASSWORD\"}"; ACT="$(js 'd.data.action_token')"
call POST /me/portability-export 202 "{\"action_token\":\"$ACT\"}"
call GET "/exports/$(js 'd.data.id')" 200; curl -s -o "$OUT.json" "$(js 'd.data.download.url')"
node -e "const a=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const s=JSON.stringify(a);process.exit(a.projects.length>=1&&a.estimate_revision.length>=1&&!s.includes('storage_key')?0:1)" "$OUT.json" \
  && { PASS=$((PASS+1)); echo "    ✓ the archive carries projects and estimates, never storage keys"; } || { FAIL=$((FAIL+1)); echo "    ✗ owner archive"; }
rm -f "$OUT.html" "$OUT.csv" "$OUT.json"
