# Suppliers, quotes, commitments, costs, payments, credits, refunds and the dashboard (CONTRACT §8–9, BRD §6.8–6.9).
# Amounts are EUR minor units: 5000000 = €50,000.00.
TOKEN="$OWNER_TOKEN"

# money_post PATH BODY → POST with a fixed key; prints status (for the concurrency test)
money_post() { curl -s -o "$3" -w '%{http_code}' -X POST "$API$1" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -H "idempotency-key: $(uuid)" --data "$2"; }

echo "  a project to spend money on"
call POST /projects 201 '{"name":"Money House","type":"new_build","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":2,"finish_tier":"standard","target_budget_minor":"12000000"}'
FP="$(js 'd.data.id')"
call GET "/projects/$FP/categories" 200
CAT_STRUCT="$(js 'd.data.find(c=>c.code==="STRUCTURE").id')"
CAT_KITCHEN="$(js 'd.data.find(c=>c.code==="KITCHEN").id')"
CAT_FLOOR="$(js 'd.data.find(c=>c.code==="FLOORING").id')"
CAT_IDS="$(js 'JSON.stringify(d.data.filter(c=>c.inclusion==="included").map(c=>c.id))')"

echo "  suppliers"
call POST /suppliers 201 '{"name":"Oak & Stone Builders","trade":"Main contractor","email":"office@oakstone.test"}'; SUP1="$(js 'd.data.id')"; SUP1V="$(js 'd.data.version')"
call POST /suppliers 201 '{"name":"Hearth Kitchens"}'; SUP2="$(js 'd.data.id')"
call POST /suppliers 400 '{"name":"Bad","email":"not-an-email"}'
call POST /suppliers 400 '{"name":"X","bank_account":"123"}'; check 'd.error.code==="VALIDATION_ERROR"' 'unknown supplier fields refused'
call PATCH "/suppliers/$SUP1" 200 "{\"expected_version\":$SUP1V,\"phone\":\"+353 1 555 0100\"}"; check 'd.data.phone==="+353 1 555 0100"' 'supplier updated'
call PATCH "/suppliers/$SUP1" 409 "{\"expected_version\":$SUP1V,\"phone\":\"x\"}"; check 'd.error.code==="VERSION_CONFLICT"' 'stale supplier version is 409'
call GET "/suppliers?q=oak" 200; check 'd.data.length===1&&d.data[0].name==="Oak & Stone Builders"' 'supplier search'

echo "  quotes (BRD 6.8)"
call POST "/projects/$FP/quotes" 422 "{\"title\":\"Wrong currency\",\"quote_date\":\"2026-10-01\",\"currency\":\"USD\",\"lines\":[{\"category_id\":\"$CAT_STRUCT\",\"description\":\"Frame\",\"quantity\":\"1\",\"net_unit_price\":\"1\"}]}"; check 'd.error.code==="CURRENCY_MISMATCH"' 'a quote must use the project currency'
call POST "/projects/$FP/quotes" 400 "{\"title\":\"No lines\",\"quote_date\":\"2026-10-01\",\"currency\":\"EUR\",\"lines\":[]}"
call POST "/projects/$FP/quotes" 201 "{\"supplier_id\":\"$SUP1\",\"title\":\"Shell and kitchen\",\"reference\":\"Q-100\",\"quote_date\":\"2026-10-01\",\"valid_until\":\"2099-12-31\",\"currency\":\"EUR\",\"included_scope\":\"Frame, roof, kitchen fit\",\"excluded_scope\":\"Flooring\",\"lines\":[{\"category_id\":\"$CAT_STRUCT\",\"description\":\"Timber frame and structure\",\"unit\":\"lump_sum\",\"quantity\":\"1\",\"net_unit_price\":\"70000\"},{\"category_id\":\"$CAT_KITCHEN\",\"description\":\"Kitchen fit\",\"quantity\":\"1\",\"net_unit_price\":\"15000\"},{\"category_id\":\"$CAT_FLOOR\",\"description\":\"Floors (optional)\",\"quantity\":\"80\",\"net_unit_price\":\"40\",\"included\":false}]}"
Q1="$(js 'd.data.id')"; Q1L1="$(js 'd.data.lines.find(l=>l.description.startsWith("Timber")).id')"; Q1L2="$(js 'd.data.lines.find(l=>l.description==="Kitchen fit").id')"; Q1L3="$(js 'd.data.lines.find(l=>l.included===false).id')"
check 'd.data.gross_minor==="8500000"&&d.data.lines.length===3' 'quote total counts included lines only (excluded scope stays visible)'
call POST "/projects/$FP/quotes" 201 "{\"supplier_id\":\"$SUP2\",\"title\":\"Structure only\",\"quote_date\":\"2026-10-02\",\"currency\":\"EUR\",\"lines\":[{\"category_id\":\"$CAT_STRUCT\",\"description\":\"Frame\",\"quantity\":\"1\",\"net_unit_price\":\"72000\",\"tax_rate\":\"13.5\"}]}"
Q2="$(js 'd.data.id')"; check 'd.data.tax_minor==="972000"&&d.data.gross_minor==="8172000"' 'tax rounds per line (13.5% of 72,000)'
call POST "/projects/$FP/quote-comparison" 200 "{\"quote_ids\":[\"$Q1\",\"$Q2\"]}"
check 'd.data.complete===false&&d.data.rows.some(r=>r.key==="KITCHEN"&&r.cells[Object.keys(r.cells)[1]]===null)' 'comparison shows missing scope, not a winner'
check "d.data.excluded_scope[\"$Q1\"]===\"Flooring\"" 'excluded scope stays visible in the comparison'
call POST "/projects/$FP/quote-comparison" 400 "{\"quote_ids\":[\"$Q1\"]}"
call GET "/projects/$FP/quotes" 200; check 'd.data.length===2' 'quotes listed'

echo "  accepting creates an obligation, not money"
call POST "/projects/$FP/quotes/$Q1/accept" 400 "{\"lines\":[{\"quote_line_id\":\"$Q1L3\"}]}"; check 'd.error.code==="VALIDATION_ERROR"' 'an excluded line cannot be accepted'
call POST "/projects/$FP/quotes/$Q1/accept" 400 "{\"lines\":[{\"quote_line_id\":\"$Q1L1\",\"amount_gross_minor\":\"9000000\"}]}"; check 'd.error.code==="VALIDATION_ERROR"' 'cannot approve more than the quoted line'
call POST "/projects/$FP/quotes/$Q1/accept" 201 "{\"lines\":[{\"quote_line_id\":\"$Q1L1\"}],\"title\":\"Main contract: structure\"}"
C1="$(js 'd.data.commitment.id')"
check 'd.data.commitment.agreed_gross_minor==="7000000"&&d.data.quote.status==="part_accepted"' 'partial approval: one line → part accepted'
call POST "/projects/$FP/quotes/$Q1/accept" 409 "{\"lines\":[{\"quote_line_id\":\"$Q1L1\"}]}"; check 'd.error.code==="ALREADY_ACCEPTED"' 'a line is accepted once'
call GET "/projects/$FP/costs" 200; check 'd.data.length===0' 'accepting a quote created no cost'
call GET "/projects/$FP/payments" 200; check 'd.data.length===0' 'accepting a quote created no payment'
Q1V="$(curl -s "$API/projects/$FP/quotes/$Q1" -H "authorization: Bearer $TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s).data.version)))")"
call PATCH "/projects/$FP/quotes/$Q1" 409 "{\"expected_version\":$Q1V,\"title\":\"Changed\"}"; check 'd.error.code==="QUOTE_LOCKED"' 'an accepted quote is immutable'
call POST "/projects/$FP/quotes" 201 "{\"supplier_id\":\"$SUP1\",\"title\":\"Shell and kitchen (amended)\",\"quote_date\":\"2026-10-05\",\"currency\":\"EUR\",\"parent_quote_id\":\"$Q1\",\"lines\":[{\"category_id\":\"$CAT_KITCHEN\",\"description\":\"Kitchen fit, revised\",\"quantity\":\"1\",\"net_unit_price\":\"16000\"}]}"
QA="$(js 'd.data.id')"; check "d.data.parent_quote_id===\"$Q1\"" 'an amendment is a new quote linked to its parent'
call GET "/projects/$FP/quotes/$Q1" 200; check 'd.data.status==="part_accepted"' 'the accepted source is preserved'
call POST "/projects/$FP/quotes" 201 "{\"title\":\"Old offer\",\"quote_date\":\"2020-01-01\",\"valid_until\":\"2020-02-01\",\"currency\":\"EUR\",\"lines\":[{\"category_id\":\"$CAT_FLOOR\",\"description\":\"Floors\",\"quantity\":\"1\",\"net_unit_price\":\"100\"}]}"
Q3="$(js 'd.data.id')"; Q3L="$(js 'd.data.lines[0].id')"; check 'd.data.expired===true' 'an expired quote is flagged'
call POST "/projects/$FP/quotes/$Q3/accept" 409 "{\"lines\":[{\"quote_line_id\":\"$Q3L\"}]}"; check 'd.error.code==="QUOTE_EXPIRED"' 'an expired quote needs the stale terms confirmed'
call POST "/projects/$FP/quotes/$Q3/accept" 201 "{\"lines\":[{\"quote_line_id\":\"$Q3L\"}],\"stale_reason\":\"Supplier confirmed by phone on 2026-10-06\"}"
C3="$(js 'd.data.commitment.id')"; C3V="$(js 'd.data.commitment.version')"; check 'd.data.commitment.stale_terms_reason.length>0' 'stale terms recorded on the commitment'
call POST "/projects/$FP/commitments/$C3/status" 200 "{\"status\":\"cancelled\",\"expected_version\":$C3V}"; check 'd.data.status==="cancelled"&&d.data.remaining_minor==="0"' 'a cancelled commitment owes nothing'
call PATCH "/projects/$FP/quotes/$Q2" 200 "{\"expected_version\":1,\"status\":\"rejected\"}"; check 'd.data.status==="rejected"' 'a quote can be rejected'

echo "  manual commitments and adjustments"
call POST "/projects/$FP/commitments" 201 "{\"title\":\"Kitchen order\",\"supplier_id\":\"$SUP2\",\"allocations\":[{\"category_id\":\"$CAT_KITCHEN\",\"agreed_gross_minor\":\"100000\"}]}"
CM="$(js 'd.data.id')"; CMV="$(js 'd.data.version')"
call POST "/projects/$FP/commitments/$CM/adjustments" 422 "{\"category_id\":\"$CAT_KITCHEN\",\"amount_delta_minor\":\"-200000\",\"reason\":\"Too much\",\"effective_date\":\"2026-10-06\"}"; check 'd.error.code==="ADJUSTMENT_TOO_LARGE"' 'a reduction cannot exceed what is agreed'
call POST "/projects/$FP/commitments/$CM/adjustments" 201 "{\"category_id\":\"$CAT_KITCHEN\",\"amount_delta_minor\":\"-100000\",\"reason\":\"Order cancelled in full\",\"effective_date\":\"2026-10-06\"}"; check 'd.data.obligation_minor==="0"&&d.data.remaining_minor==="0"' 'an append-only adjustment takes the obligation to zero'
call GET "/projects/$FP/commitments/$CM" 200; CMV="$(js 'd.data.version')"
call POST "/projects/$FP/commitments/$CM/status" 200 "{\"status\":\"completed\",\"expected_version\":$CMV}"

echo "  invoices: split must add up before posting"
call POST "/projects/$FP/costs" 422 "{\"type\":\"invoice\",\"record_date\":\"2027-02-01\",\"currency\":\"USD\",\"gross_minor\":\"100\",\"allocations\":[]}"; check 'd.error.code==="CURRENCY_MISMATCH"' 'costs use the project currency'
call POST "/projects/$FP/costs" 400 "{\"type\":\"invoice\",\"record_date\":\"2027-02-01\",\"currency\":\"EUR\",\"net_minor\":\"100\",\"tax_minor\":\"20\",\"gross_minor\":\"130\"}"; check 'd.error.code==="VALIDATION_ERROR"' 'net + tax must equal gross'
call POST "/projects/$FP/costs" 201 "{\"type\":\"invoice\",\"supplier_id\":\"$SUP1\",\"reference\":\"INV-17\",\"record_date\":\"2027-02-01\",\"currency\":\"EUR\",\"gross_minor\":\"5000000\",\"tax_minor\":\"0\",\"allocations\":[{\"category_id\":\"$CAT_STRUCT\",\"commitment_id\":\"$C1\",\"amount_gross_minor\":\"4000000\"}]}"
INV1="$(js 'd.data.id')"; INV1V="$(js 'd.data.version')"; check 'd.data.status==="draft"&&d.meta.allocation_balanced===false' 'draft saved; the split does not add up yet'
call POST "/projects/$FP/costs/$INV1/post" 422 "{\"expected_version\":$INV1V}"; check 'd.error.code==="ALLOCATION_MISMATCH"' 'cannot post until allocations equal gross'
call PATCH "/projects/$FP/costs/$INV1" 200 "{\"expected_version\":$INV1V,\"allocations\":[{\"category_id\":\"$CAT_STRUCT\",\"commitment_id\":\"$C1\",\"amount_gross_minor\":\"5000000\"}]}"; INV1V="$(js 'd.data.version')"
check 'd.meta.allocation_balanced===true' 'the split adds up'
call POST "/projects/$FP/costs/$INV1/post" 200 "{\"expected_version\":$INV1V}"; check 'd.data.status==="posted"&&d.data.payment_status==="unpaid"' 'invoice posted, unpaid'
INV1V="$(js 'd.data.version')"
call PATCH "/projects/$FP/costs/$INV1" 409 "{\"expected_version\":$INV1V,\"note\":\"edit\"}"; check 'd.error.code==="RECORD_POSTED"' 'a posted invoice cannot be edited'
call DELETE "/projects/$FP/costs/$INV1" 409 "{\"expected_version\":$INV1V}"
call POST "/projects/$FP/costs" 201 "{\"type\":\"invoice\",\"supplier_id\":\"$SUP1\",\"reference\":\"inv-17\",\"record_date\":\"2027-02-02\",\"currency\":\"EUR\",\"gross_minor\":\"100\"}"
DUP="$(js 'd.data.id')"; check 'd.meta.duplicate_reference===true' 'a repeated reference is flagged (advisory)'
call DELETE "/projects/$FP/costs/$DUP" 200 '{"expected_version":1}'; check 'd.data.deleted===true' 'a draft can be deleted'

echo "  payments: a deposit is cash, not a cost (AC15)"
call POST "/projects/$FP/payments" 201 "{\"type\":\"outgoing\",\"amount_minor\":\"1000000\",\"currency\":\"EUR\",\"payment_date\":\"2027-01-15\",\"method\":\"bank\",\"supplier_id\":\"$SUP1\",\"commitment_id\":\"$C1\",\"reference\":\"Deposit\"}"
DEP="$(js 'd.data.id')"
call POST "/projects/$FP/payments/$DEP/post" 200 '{"expected_version":1}'; check 'd.data.status==="posted"&&d.data.unallocated_minor==="1000000"' 'deposit posted as an unallocated advance'
call POST "/projects/$FP/payments" 201 "{\"type\":\"outgoing\",\"amount_minor\":\"3000000\",\"currency\":\"EUR\",\"payment_date\":\"2027-02-10\",\"supplier_id\":\"$SUP1\",\"reference\":\"PAY-1\"}"
PAY1="$(js 'd.data.id')"
call POST "/projects/$FP/payments/$PAY1/post" 409 "{\"expected_version\":1,\"allocations\":[{\"cost_record_id\":\"$INV1\",\"amount_minor\":\"6000000\"}]}"; check 'd.error.code==="OVER_ALLOCATED"' 'cannot allocate more than the payment'
call POST "/projects/$FP/payments/$PAY1/post" 200 "{\"expected_version\":1,\"allocations\":[{\"cost_record_id\":\"$INV1\",\"amount_minor\":\"3000000\"}]}"
call GET "/projects/$FP/costs/$INV1" 200; check 'd.data.payment_status==="partial"&&d.data.open_minor==="2000000"' 'invoice partly paid: 20k open'
call GET "/projects/$FP/commitments/$C1" 200; check 'd.data.remaining_minor==="2000000"&&d.data.advances_minor==="1000000"' 'commitment: 20k still owed, 10k advance held'

echo "  forecast: AC18 exactly"
call POST "/projects/$FP/forecasts" 201 '{}'
FC="$(js 'd.data.id')"; FCV="$(js 'd.data.version')"
check 'd.data.inputs.every(i=>i.uncommitted_remaining_minor===null)' 'AC19 uncommitted work starts unknown, never zero'
check 'd.data.preview.complete===false&&d.data.preview.missing_inputs>0' 'AC19 an empty forecast is visibly incomplete'
INPUTS="$(node -e "const ids=$CAT_IDS;console.log(JSON.stringify(ids.map(id=>({category_id:id,uncommitted_remaining_minor:id==='$CAT_KITCHEN'?'2500000':'0',basis_note:id==='$CAT_KITCHEN'?'Kitchen not yet ordered':'Nothing left'}))))")"
call PATCH "/projects/$FP/forecasts/$FC" 200 "{\"expected_version\":$FCV,\"remaining_reserve_minor\":\"500000\",\"inputs\":$INPUTS}"; FCV="$(js 'd.data.version')"
check 'd.data.preview.total_minor==="10000000"' 'preview: 50k + 20k + 25k + 5k = 100k'
call PATCH "/projects/$FP/forecasts/$FC" 409 "{\"expected_version\":1,\"remaining_reserve_minor\":\"1\"}"
call POST "/projects/$FP/forecasts/$FC/confirm" 200 "{\"expected_version\":$FCV}"; check 'd.data.status==="confirmed"&&d.data.total_snapshot.forecast.total_minor==="10000000"' 'confirmed with a historical snapshot'
call GET "/projects/$FP/dashboard" 200
check 'd.data.actual_minor==="5000000"' 'AC18 A = 50k actual'
check 'd.data.committed_remaining_minor==="2000000"' 'AC18 C = 20k remaining commitment'
check 'd.data.forecast.uncommitted_minor==="2500000"&&d.data.forecast.remaining_reserve_minor==="500000"' 'AC18 U = 25k, reserve 5k'
check 'd.data.forecast.total_minor==="10000000"' 'AC18 forecast = 100k'
check 'd.data.paid_minor==="4000000"&&d.data.forecast.cash_still_needed_minor==="6000000"' 'AC18 40k paid → 60k cash still needed'
check 'd.data.unallocated_advances_minor==="1000000"' 'AC15 the 10k deposit increased paid but is not an invoice'
check 'd.data.forecast.budget_variance_minor==="2000000"&&d.data.forecast.review_required===false' 'variance against the 120k target; no review needed yet'
check 'Array.isArray(d.data.next_actions)&&typeof d.data.phases.total==="number"' 'next actions and phase summary'

echo "  the deposit meets its invoice without new cash (AC15)"
call POST "/projects/$FP/payments/$DEP/allocate" 200 "{\"expected_version\":2,\"allocations\":[{\"cost_record_id\":\"$INV1\",\"amount_minor\":\"1000000\"}]}"; check 'd.data.unallocated_minor==="0"' 'deposit allocated'
call GET "/projects/$FP/dashboard" 200; check 'd.data.actual_minor==="5000000"&&d.data.paid_minor==="4000000"&&d.data.forecast.cash_still_needed_minor==="6000000"' 'AC15 no double count: same actual, same paid'
call GET "/projects/$FP/payments" 200; check 'd.data.length===2' 'no extra payment was created'

echo "  concurrent payments cannot over-allocate (AC16)"
call POST "/projects/$FP/costs" 201 "{\"type\":\"expense\",\"supplier_id\":\"$SUP2\",\"reference\":\"EXP-1\",\"record_date\":\"2027-03-01\",\"currency\":\"EUR\",\"gross_minor\":\"1000000\",\"allocations\":[{\"category_id\":\"$CAT_KITCHEN\",\"amount_gross_minor\":\"1000000\"}]}"
EXP1="$(js 'd.data.id')"
call POST "/projects/$FP/costs/$EXP1/post" 200 '{"expected_version":1}'
call GET "/projects/$FP/dashboard" 200; check 'd.data.forecast.review_required===true' 'ledger changed after confirmation → Review required'
check 'd.data.actual_minor==="6000000"' 'the expense is an actual cost'
call POST "/projects/$FP/payments" 201 "{\"type\":\"outgoing\",\"amount_minor\":\"800000\",\"currency\":\"EUR\",\"payment_date\":\"2027-03-02\",\"supplier_id\":\"$SUP2\"}"; PA="$(js 'd.data.id')"
call POST "/projects/$FP/payments" 201 "{\"type\":\"outgoing\",\"amount_minor\":\"800000\",\"currency\":\"EUR\",\"payment_date\":\"2027-03-02\",\"supplier_id\":\"$SUP2\"}"; PB="$(js 'd.data.id')"
OA="$(mktemp)"; OB="$(mktemp)"; SA="$(mktemp)"; SB="$(mktemp)"
( money_post "/projects/$FP/payments/$PA/post" "{\"expected_version\":1,\"allocations\":[{\"cost_record_id\":\"$EXP1\",\"amount_minor\":\"800000\"}]}" "$OA" > "$SA" ) &
( money_post "/projects/$FP/payments/$PB/post" "{\"expected_version\":1,\"allocations\":[{\"cost_record_id\":\"$EXP1\",\"amount_minor\":\"800000\"}]}" "$OB" > "$SB" ) &
wait
STATUSES="$(cat "$SA") $(cat "$SB")"
if [ "$STATUSES" = "200 409" ] || [ "$STATUSES" = "409 200" ]; then PASS=$((PASS+1)); echo "    ✓ AC16 two concurrent posts: one succeeds, one is refused ($STATUSES)"; else FAIL=$((FAIL+1)); echo "    ✗ AC16 concurrent posts gave $STATUSES"; cat "$OA" "$OB"; fi
call GET "/projects/$FP/costs/$EXP1" 200; check 'd.data.paid_minor==="800000"&&d.data.open_minor==="200000"' 'AC16 the invoice is paid once, never over'
PAID_OK="$(grep -q '"status":"posted"' "$OA" && echo "$PA" || echo "$PB")"
rm -f "$OA" "$OB" "$SA" "$SB"

echo "  retries never duplicate money (AC29)"
call POST "/projects/$FP/payments" 201 "{\"type\":\"outgoing\",\"amount_minor\":\"50000\",\"currency\":\"EUR\",\"payment_date\":\"2027-03-03\"}"; PR="$(js 'd.data.id')"
KEY="$(uuid)"
call POST "/projects/$FP/payments/$PR/post" 200 '{"expected_version":1}'
call POST "/projects/$FP/payments/$PR/post" 200 '{"expected_version":1}'; check 'd.meta.replayed===true&&d.data.status==="posted"' 'AC29 the same key replays the original answer'
call POST "/projects/$FP/payments/$PR/post" 409 '{"expected_version":2}'; check 'd.error.code==="IDEMPOTENCY_MISMATCH"' 'the same key with a different body is 409'
KEY=""
call POST "/projects/$FP/payments/$PR/post" 409 '{"expected_version":2}'; check 'd.error.code==="RECORD_POSTED"' 'a fresh retry of an already-posted payment is refused'
call GET "/projects/$FP/dashboard" 200; check 'd.data.paid_minor==="4850000"' 'AC29 paid counts each payment once (40k + 8k + 0.5k)'

echo "  credits and refunds (AC17)"
call POST "/projects/$FP/costs" 201 "{\"type\":\"credit\",\"supplier_id\":\"$SUP2\",\"reference\":\"CR-1\",\"record_date\":\"2027-03-05\",\"currency\":\"EUR\",\"gross_minor\":\"-2000000\",\"original_cost_id\":\"$EXP1\",\"allocations\":[{\"category_id\":\"$CAT_KITCHEN\",\"amount_gross_minor\":\"-2000000\"}]}"
CRX="$(js 'd.data.id')"
call POST "/projects/$FP/costs/$CRX/post" 422 '{"expected_version":1}'; check 'd.error.code==="CREDIT_TOO_LARGE"' 'a credit cannot take an invoice below zero'
call DELETE "/projects/$FP/costs/$CRX" 200 '{"expected_version":1}'
call POST "/projects/$FP/costs" 400 "{\"type\":\"credit\",\"record_date\":\"2027-03-05\",\"currency\":\"EUR\",\"gross_minor\":\"200000\",\"original_cost_id\":\"$EXP1\"}"; check 'd.error.code==="VALIDATION_ERROR"' 'a credit is negative'
call POST "/projects/$FP/costs" 201 "{\"type\":\"credit\",\"supplier_id\":\"$SUP2\",\"reference\":\"CR-1\",\"record_date\":\"2027-03-05\",\"currency\":\"EUR\",\"gross_minor\":\"-200000\",\"original_cost_id\":\"$EXP1\",\"allocations\":[{\"category_id\":\"$CAT_KITCHEN\",\"amount_gross_minor\":\"-200000\"}]}"
CR1="$(js 'd.data.id')"
call POST "/projects/$FP/costs/$CR1/post" 200 '{"expected_version":1}'
call GET "/projects/$FP/dashboard" 200; check 'd.data.actual_minor==="5800000"&&d.data.paid_minor==="4850000"' 'AC17 a credit lowers actual cost, cash is unchanged'
call GET "/projects/$FP/costs/$EXP1" 200; check 'd.data.open_minor==="0"&&d.data.payment_status==="paid"' 'credit + payment settle the expense'
call POST "/projects/$FP/costs" 201 "{\"type\":\"credit\",\"supplier_id\":\"$SUP1\",\"reference\":\"CR-2\",\"record_date\":\"2027-03-06\",\"currency\":\"EUR\",\"gross_minor\":\"-500000\",\"original_cost_id\":\"$INV1\",\"allocations\":[{\"category_id\":\"$CAT_STRUCT\",\"commitment_id\":\"$C1\",\"amount_gross_minor\":\"-500000\"}]}"
CR2="$(js 'd.data.id')"
call POST "/projects/$FP/costs/$CR2/post" 400 '{"expected_version":1}'; check 'd.error.code==="CREDIT_EFFECT_REQUIRED"' 'a credit on a commitment must say what it means for the work'
call PATCH "/projects/$FP/costs/$CR2" 200 "{\"expected_version\":1,\"allocations\":[{\"category_id\":\"$CAT_STRUCT\",\"commitment_id\":\"$C1\",\"amount_gross_minor\":\"-500000\",\"credit_effect\":\"replacement_pending\"}]}"
call POST "/projects/$FP/costs/$CR2/post" 200 '{"expected_version":2}'
call GET "/projects/$FP/commitments/$C1" 200; check 'd.data.remaining_minor==="2500000"' 'AC17 work still owed: the credit reopens 5k of the obligation'
call POST "/projects/$FP/payments" 201 "{\"type\":\"refund\",\"amount_minor\":\"9000000\",\"currency\":\"EUR\",\"payment_date\":\"2027-03-07\",\"supplier_id\":\"$SUP1\",\"original_payment_id\":\"$PAY1\"}"; RFX="$(js 'd.data.id')"
call POST "/projects/$FP/payments/$RFX/post" 422 '{"expected_version":1}'; check 'd.error.code==="REFUND_TOO_LARGE"' 'refunds cannot exceed the original payment'
call DELETE "/projects/$FP/payments/$RFX" 200 '{"expected_version":1}'
call POST "/projects/$FP/payments" 400 "{\"type\":\"refund\",\"amount_minor\":\"100\",\"currency\":\"EUR\",\"payment_date\":\"2027-03-07\"}"
call POST "/projects/$FP/payments" 201 "{\"type\":\"refund\",\"amount_minor\":\"500000\",\"currency\":\"EUR\",\"payment_date\":\"2027-03-07\",\"supplier_id\":\"$SUP1\",\"original_payment_id\":\"$PAY1\",\"reference\":\"RF-1\"}"; RF1="$(js 'd.data.id')"
call POST "/projects/$FP/payments/$RF1/post" 200 '{"expected_version":1}'
call GET "/projects/$FP/dashboard" 200; check 'd.data.paid_minor==="4350000"&&d.data.refunds_minor==="500000"' 'AC17 a refund lowers cash paid, separately from costs'
call POST "/projects/$FP/payments/$PAY1/void" 409 '{"reason":"test"}'; check 'd.error.code==="HAS_REFUNDS"' 'a refunded payment cannot be voided first'

echo "  voids keep the evidence"
call POST "/projects/$FP/costs/$EXP1/void" 200 '{"preview":true}'; check 'd.data.can_void===false&&d.data.blocked_by_credits===1' 'preview: credits must be voided first'
call POST "/projects/$FP/costs/$CR1/void" 200 '{"reason":"Entered against the wrong invoice"}'; check 'd.data.status==="void"' 'credit voided'
call POST "/projects/$FP/costs/$EXP1/void" 200 '{"preview":true}'; check 'd.data.can_void===true&&d.data.detached_payments_minor==="800000"' 'preview shows 8k going back to advances'
call POST "/projects/$FP/costs/$EXP1/void" 400 '{}'
call POST "/projects/$FP/costs/$EXP1/void" 200 '{"reason":"Duplicate of a supplier invoice"}'; check 'd.data.status==="void"&&d.data.void_reason.length>0' 'voided, never deleted'
call GET "/projects/$FP/payments/$PAID_OK" 200; check 'd.data.unallocated_minor==="800000"' 'the payment became an unallocated advance'
call GET "/projects/$FP/costs?status=void" 200; check 'd.data.length===2' 'void records stay listed'
call POST "/projects/$FP/costs/$EXP1/void" 409 '{"reason":"again"}'

echo "  privacy and gates (AC08, AC01)"
TOKEN="$OUTSIDER_TOKEN"
for p in "/projects/$FP/quotes" "/projects/$FP/quotes/$Q1" "/projects/$FP/commitments" "/projects/$FP/costs" "/projects/$FP/costs/$INV1" "/projects/$FP/payments" "/projects/$FP/payments/$PAY1" "/projects/$FP/dashboard" "/projects/$FP/forecasts" "/projects/$FP/forecasts/$FC" "/suppliers/$SUP1"; do call GET "$p" 404; done
call POST "/projects/$FP/payments/$PA/post" 404 '{"expected_version":1}'
call POST "/projects/$FP/costs/$INV1/void" 404 '{"reason":"steal"}'
call PATCH "/suppliers/$SUP1" 404 '{"expected_version":2,"name":"Mine now"}'
call GET /suppliers 200; check 'd.data.length===0' 'AC08 suppliers are private to their owner'
TOKEN="$UNPAID_TOKEN"
call GET /suppliers 403
call GET "/projects/$FP/costs" 403
TOKEN="$OWNER_TOKEN"
