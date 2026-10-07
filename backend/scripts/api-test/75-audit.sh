# Cross-cutting audit (BRD §13 threat tests, AC07, AC08, AC10): refresh-token reuse, forged social tokens,
# cross-project references, all-or-nothing scope changes, CSV formula injection, upload retries,
# caller-provided owners, unit-aware assumption text, recalculation of typed quantities.
TOKEN="$OWNER_TOKEN"

echo "  sessions (BRD 5.2: rotate on every refresh; reuse revokes the family)"
REUSE_EMAIL="apitest+reuse${STAMP}@houseplan.test"
REUSE_TOKEN="$(register "$REUSE_EMAIL" "Rae Reuse")"
TOKEN=""
call POST /auth/login 200 "{\"email\":\"$REUSE_EMAIL\",\"password\":\"$PASSWORD\"}"; R1="$(js 'd.data.refresh_token')"
call POST /auth/refresh 200 "{\"refresh_token\":\"$R1\"}"; R2="$(js 'd.data.refresh_token')"
check "d.data.refresh_token!==\"$R1\"" 'a refresh hands out a new refresh token'
call POST /auth/refresh 401 "{\"refresh_token\":\"$R1\"}"; check 'd.error.code==="AUTH_TOKEN_EXPIRED"' 'reusing a spent refresh token is refused'
call POST /auth/refresh 401 "{\"refresh_token\":\"$R2\"}"; check 'd.error.code==="AUTH_TOKEN_EXPIRED"' 'reuse revoked the whole session family'
call POST /auth/login 200 "{\"email\":\"$REUSE_EMAIL\",\"password\":\"$PASSWORD\"}"; ACCOUNTS+=("$(js 'd.data.access_token')")

echo "  forged social tokens (AC07)"
call POST /auth/social/google 400,401,412 '{"id_token":"eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIiwiYXVkIjoic29tZW9uZS1lbHNlIn0.c2ln"}'
check '!d.data&&Boolean(d.error)' 'a forged Google token gets no session'
call POST /auth/social/apple 400,401,412 '{"id_token":"eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln","nonce":"replayed-nonce"}'
check '!d.data&&Boolean(d.error)' 'a forged Apple token with a replayed nonce gets no session'
call POST /auth/social/complete 400,401,404,412 '{"code":"not-a-real-sign-in-code"}'
check '!d.data' 'an invented browser sign-in code gets no session'

TOKEN="$OWNER_TOKEN"
echo "  two projects of one owner (cross-project references)"
call POST /projects 201 '{"name":"Audit house A","type":"new_build","country_code":"US","currency":"USD","unit_system":"imperial","storeys":2,"finish_tier":"standard"}'; PA="$(js 'd.data.id')"
call POST /projects 201 '{"name":"Audit house B","type":"renovation","country_code":"US","currency":"USD","unit_system":"metric","storeys":1,"finish_tier":"standard"}'; PB="$(js 'd.data.id')"
call GET "/projects/$PA/categories" 200; A_SITE="$(js 'd.data.find(x=>x.code==="SITE").id')"; A_LAND="$(js 'd.data.find(x=>x.code==="LAND").id')"; A_FEES="$(js 'd.data.find(x=>x.code==="FEES").id')"
call GET "/projects/$PB/categories" 200; B_SITE="$(js 'd.data.find(x=>x.code==="SITE").id')"
TODAY="$(date +%Y-%m-%d)"

call POST "/projects/$PB/costs" 404,422 "{\"type\":\"invoice\",\"record_date\":\"$TODAY\",\"currency\":\"USD\",\"gross_minor\":\"10000\",\"tax_minor\":\"0\",\"allocations\":[{\"category_id\":\"$A_SITE\",\"amount_gross_minor\":\"10000\"}]}"
check 'Boolean(d.error)' 'an invoice cannot be allocated to another project category'
call POST "/projects/$PA/commitments" 201 "{\"title\":\"Groundworks\",\"allocations\":[{\"category_id\":\"$A_SITE\",\"agreed_gross_minor\":\"50000\"}]}"; A_COMMIT="$(js 'd.data.id')"
call POST "/projects/$PB/payments" 404,422 "{\"type\":\"outgoing\",\"amount_minor\":\"5000\",\"currency\":\"USD\",\"payment_date\":\"$TODAY\",\"commitment_id\":\"$A_COMMIT\"}"
check 'Boolean(d.error)' 'a payment cannot point at another project commitment'
call POST "/projects/$PA/costs" 201 "{\"type\":\"invoice\",\"record_date\":\"$TODAY\",\"currency\":\"USD\",\"gross_minor\":\"20000\",\"tax_minor\":\"0\",\"allocations\":[{\"category_id\":\"$A_SITE\",\"amount_gross_minor\":\"20000\"}]}"; A_INV="$(js 'd.data.id')"
call POST "/projects/$PA/costs/$A_INV/post" 200 '{"expected_version":1}'
call POST "/projects/$PB/payments" 201 "{\"type\":\"outgoing\",\"amount_minor\":\"5000\",\"currency\":\"USD\",\"payment_date\":\"$TODAY\"}"; B_PAY="$(js 'd.data.id')"
call POST "/projects/$PB/payments/$B_PAY/post" 404,422 "{\"expected_version\":1,\"allocations\":[{\"cost_record_id\":\"$A_INV\",\"amount_minor\":\"5000\"}]}"
check 'Boolean(d.error)' 'a payment cannot be allocated to another project invoice'
call POST "/projects/$PB/costs" 400 "{\"type\":\"invoice\",\"record_date\":\"$TODAY\",\"currency\":\"USD\",\"gross_minor\":\"100\",\"tax_minor\":\"0\",\"owner_user_id\":\"someone-else\",\"allocations\":[{\"category_id\":\"$B_SITE\",\"amount_gross_minor\":\"100\"}]}"
check 'd.error.code==="VALIDATION_ERROR"' 'a caller-provided owner is refused on money writes'

echo "  scope changes are all or nothing"
call PATCH "/projects/$PA/categories" 409 "{\"changes\":[{\"id\":\"$A_LAND\",\"inclusion\":\"excluded\",\"expected_version\":1},{\"id\":\"$A_FEES\",\"inclusion\":\"included\",\"expected_version\":9}]}"
check 'd.error.code==="VERSION_CONFLICT"' 'one stale category refuses the whole batch'
call GET "/projects/$PA/categories" 200; check 'd.data.find(x=>x.code==="LAND").inclusion==="undecided"&&d.data.find(x=>x.code==="LAND").version===1' 'the valid change in that batch was not saved'
call PATCH "/projects/$PA/categories" 400 "{\"changes\":[{\"id\":\"$A_LAND\",\"inclusion\":\"excluded\",\"expected_version\":1},{\"id\":\"$A_LAND\",\"inclusion\":\"included\",\"expected_version\":1}]}"
call PATCH "/projects/$PA/categories" 200 "{\"changes\":[{\"id\":\"$A_LAND\",\"inclusion\":\"excluded\",\"expected_version\":1},{\"id\":\"$A_FEES\",\"inclusion\":\"included\",\"expected_version\":1}]}"
check 'd.data.find(x=>x.code==="LAND").inclusion==="excluded"&&d.data.find(x=>x.code==="FEES").inclusion==="included"' 'a fully valid batch saves every change'

echo "  imperial projects read in feet (AC10, values stay metric)"
call POST /calculations/preview 200 "{\"calculator_code\":\"paint\",\"project_id\":\"$PA\",\"input\":{\"net_surface_m2\":\"80\",\"coats\":\"2\",\"coverage_m2_per_litre\":\"10\",\"can_size_litres\":\"5\",\"labour_basis\":\"none\"}}"
check 'd.data.assumptions.some(a=>a.includes("ft²"))&&d.data.quantities.litres_required==="16"' 'paint coverage is described in ft², litres stay exact'

echo "  typed quantities are never guessed from a changed room"
call POST "/projects/$PA/rooms" 201 '{"name":"Kitchen","room_type":"kitchen","length_m":"5","width_m":"4","height_m":"2.5"}'; A_ROOM="$(js 'd.data.id')"
call GET "/projects/$PA/estimates" 200; A_DRAFT="$(js 'd.data.pointers.draft_revision_id')"
call POST "/projects/$PA/estimates/$A_DRAFT/lines" 201 "{\"category_id\":\"$A_SITE\",\"mode\":\"manual_quantity\",\"label\":\"Kitchen screed\",\"unit\":\"m2\",\"quantity\":\"20\",\"net_unit_price\":\"10\",\"room_id\":\"$A_ROOM\"}"
LINE_GROSS="$(js 'd.data.line.gross_minor')"
call PATCH "/projects/$PA/rooms/$A_ROOM" 200 '{"length_m":"6","expected_version":1}'
call GET "/projects/$PA/estimates/$A_DRAFT" 200; DV="$(js 'd.data.version')"
call POST "/projects/$PA/estimates/$A_DRAFT/recalculate" 200 "{\"expected_version\":$DV,\"accept\":false}"
check "d.data.changes.length===1&&d.data.changes[0].action===\"check_by_hand\"&&d.data.changes[0].after_gross_minor===\"$LINE_GROSS\"&&d.data.changes[0].room_geometry.floor_area_m2===\"24\"" 'the typed quantity is kept and the room now measures 24 m² to check against'
call POST "/projects/$PA/estimates/$A_DRAFT/recalculate" 200 "{\"expected_version\":$DV,\"accept\":true}"
check "d.data.revision.version>$DV" 'clearing the flag moves the draft version on'

echo "  CSV formula injection (BRD 6.12)"
for L in '=1+2 cmd' '@SUM(A1)' '+44 build' '-5 discount'; do
  call POST "/projects/$PA/estimates/$A_DRAFT/lines" 201 "{\"category_id\":\"$A_SITE\",\"mode\":\"allowance\",\"label\":\"$L\",\"quantity\":\"1\",\"unit\":\"lump_sum\",\"net_unit_price\":\"100\"}"
done
call GET "/projects/$PA/estimates/$A_DRAFT" 200; DV="$(js 'd.data.version')"
call POST "/projects/$PA/estimates/$A_DRAFT/freeze" 200 "{\"expected_version\":$DV}"
call POST "/projects/$PA/exports" 202 "{\"kind\":\"csv\",\"revision_id\":\"$A_DRAFT\"}"; AUD_CSV="$(js 'd.data.id')"
call GET "/exports/$AUD_CSV" 200; curl -s -o "$OUT.audit.csv" "$(js 'd.data.download.url')"
if grep -q "'=1+2 cmd" "$OUT.audit.csv" && grep -q "'@SUM(A1)" "$OUT.audit.csv" && grep -q "'+44 build" "$OUT.audit.csv" && grep -q "'-5 discount" "$OUT.audit.csv" && ! grep -qE "(^|,)=1\+2" "$OUT.audit.csv"; then
  PASS=$((PASS+1)); echo "    ✓ cells starting with = + - @ are neutralised"
else FAIL=$((FAIL+1)); echo "    ✗ CSV formula guard"; grep -E "cmd|SUM|build|discount" "$OUT.audit.csv" | head -5; fi
rm -f "$OUT.audit.csv"

echo "  upload retries never store the file twice"
AUD_DIR="$(mktemp -d)"; command -v cygpath >/dev/null && AUD_DIR="$(cygpath -m "$AUD_DIR")"
node -e "require('fs').writeFileSync(process.argv[1]+'/receipt.png',Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4,5,6,7,8,Date.now()%256]))" "$AUD_DIR"
up() { curl -s -o "$OUT" -w '%{http_code}' -X POST "$API/attachments" -H "authorization: Bearer $TOKEN" -F "file=@$AUD_DIR/receipt.png;type=image/png" -F attachment_type=receipt -F "project_id=$PA"; }
s1="$(up)"; FIRST="$(js 'd.data.id')"
s2="$(up)"; SECOND="$(js 'd.data.id')"; REPLAYED="$(js 'd.meta.replayed===true')"
if [ "$s1" = 201 ] && [ "$s2" = 200 ] && [ "$FIRST" = "$SECOND" ] && [ "$REPLAYED" = true ]; then PASS=$((PASS+1)); echo "    ✓ the same upload again returns the stored file (201, then 200 replayed)"
else FAIL=$((FAIL+1)); echo "    ✗ upload retry: $s1/$s2 $FIRST $SECOND $REPLAYED"; fi
rm -rf "$AUD_DIR"

echo "  isolation sweep (AC08: another account sees 404 everywhere)"
TOKEN="$OUTSIDER_TOKEN"
for path in "/projects/$PA" "/projects/$PA/categories" "/projects/$PA/rooms" "/projects/$PA/estimates" "/projects/$PA/estimates/$A_DRAFT" "/projects/$PA/costs" "/projects/$PA/costs/$A_INV" "/projects/$PA/commitments" "/projects/$PA/payments" "/projects/$PA/dashboard" "/projects/$PA/forecasts" "/projects/$PA/procurement" "/projects/$PA/advice" "/projects/$PA/activity" "/attachments/$FIRST/download-url" "/exports/$AUD_CSV"; do
  call GET "$path" 404
done
call POST "/projects/$PA/costs/$A_INV/void" 404 '{"reason":"not mine"}'
call PATCH "/projects/$PA/rooms/$A_ROOM" 404 '{"name":"Mine now","expected_version":2}'
TOKEN="$OWNER_TOKEN"
