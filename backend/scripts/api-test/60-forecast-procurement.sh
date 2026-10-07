# Forecast lifecycle and purchase preparation (CONTRACT §9–10, BRD §6.9–6.10).
TOKEN="$OWNER_TOKEN"
call POST /projects 201 '{"name":"Build Tracker","type":"renovation","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":1,"finish_tier":"standard"}'
FP2="$(js 'd.data.id')"
call GET "/projects/$FP2/categories" 200
CAT2_SITE="$(js 'd.data.find(c=>c.code==="SITE").id')"
CAT2_IDS="$(js 'JSON.stringify(d.data.filter(c=>c.inclusion==="included").map(c=>c.id))')"

echo "  dashboard before any money"
call GET "/projects/$FP2/dashboard" 200
check 'd.data.forecast.status==="none"&&d.data.actual_minor==="0"&&d.data.paid_minor==="0"' 'empty ledger: no forecast, nothing spent'
check 'd.data.undecided_categories>0&&d.data.next_actions.some(a=>a.key==="decide_scope")' 'undecided scope is a next action'
check 'd.data.next_actions.some(a=>a.key==="forecast")&&d.data.next_actions.some(a=>a.key==="add_rooms")' 'set up the forecast and add rooms are suggested'
check 'd.data.categories.length===19' 'all 19 categories appear'

echo "  forecast drafts and confirmation"
call POST "/projects/$FP2/forecasts" 201 '{}'; F1="$(js 'd.data.id')"; F1V="$(js 'd.data.version')"
check 'd.data.version_number===1&&d.data.status==="draft"' 'first draft'
call POST "/projects/$FP2/forecasts" 409 '{}'; check 'd.error.code==="DRAFT_EXISTS"' 'one draft at a time'
call PATCH "/projects/$FP2/forecasts/$F1" 400 "{\"expected_version\":$F1V,\"inputs\":[{\"category_id\":\"$CAT2_SITE\",\"uncommitted_remaining_minor\":\"-5\"}]}"
call PATCH "/projects/$FP2/forecasts/$F1" 400 "{\"expected_version\":$F1V,\"made_up\":true}"
call PATCH "/projects/$FP2/forecasts/$F1" 200 "{\"expected_version\":$F1V,\"inputs\":[{\"category_id\":\"$CAT2_SITE\",\"uncommitted_remaining_minor\":\"300000\",\"basis_note\":\"Strip-out quote pending\"}]}"
F1V="$(js 'd.data.version')"
check 'd.data.inputs.find(i=>i.code==="SITE").uncommitted_remaining_minor==="300000"' 'an uncommitted amount is entered per category'
check 'd.data.preview.complete===false&&d.data.preview.missing_inputs>0' 'AC19 other included categories are still unknown: incomplete'
check 'd.data.preview.total_minor==="300000"' 'preview sums only what is known, labelled incomplete'
call POST "/projects/$FP2/forecasts/$F1/confirm" 200 "{\"expected_version\":$F1V}"
check 'd.data.status==="confirmed"&&d.data.total_snapshot.forecast.complete===false' 'an incomplete forecast can be confirmed, and stays labelled incomplete'
F1V="$(js 'd.data.version')"
call PATCH "/projects/$FP2/forecasts/$F1" 409 "{\"expected_version\":$F1V,\"remaining_reserve_minor\":\"1\"}"; check 'd.error.code==="INVALID_STATE"' 'a confirmed forecast is a historical snapshot'
call POST "/projects/$FP2/forecasts/$F1/confirm" 409 "{\"expected_version\":$F1V}"
call POST "/projects/$FP2/forecasts" 201 '{"copy_from_latest":true}'; F2="$(js 'd.data.id')"; F2V="$(js 'd.data.version')"
check 'd.data.version_number===2&&d.data.inputs.find(i=>i.code==="SITE").uncommitted_remaining_minor==="300000"' 'a new draft copies the last inputs'
INPUTS2="$(node -e "console.log(JSON.stringify($CAT2_IDS.map(id=>({category_id:id,uncommitted_remaining_minor:'100000'}))))")"
call PATCH "/projects/$FP2/forecasts/$F2" 200 "{\"expected_version\":$F2V,\"remaining_reserve_minor\":\"50000\",\"inputs\":$INPUTS2}"; F2V="$(js 'd.data.version')"
check 'd.data.preview.missing_inputs===0' 'every included category has an amount'
call GET "/projects/$FP2/dashboard" 200; check 'd.data.forecast.version_number===1' 'the dashboard uses the last CONFIRMED forecast, not the draft'
call POST "/projects/$FP2/forecasts/$F2/confirm" 200 "{\"expected_version\":$F2V}"
call GET "/projects/$FP2/dashboard" 200; check 'd.data.forecast.version_number===2&&d.data.forecast.remaining_reserve_minor==="50000"' 'the newly confirmed forecast is live'
call GET "/projects/$FP2/forecasts/$F1" 200; check 'd.data.total_snapshot.forecast.total_minor==="300000"' 'the old snapshot is unchanged'
call GET "/projects/$FP2/forecasts" 200; check 'd.data.length===2' 'forecast history'

echo "  purchase preparation"
call POST "/projects/$FP2/procurement" 400 '{"label":"Skip hire"}'
call POST "/projects/$FP2/procurement" 201 '{"label":"Plasterboard sheets","unit":"piece","required_qty":"42","purchase_qty":"45","needed_date":"2027-04-01"}'
IT1="$(js 'd.data.id')"; IT1V="$(js 'd.data.version')"; check 'd.data.status==="planned"&&d.data.purchase_qty==="45"' 'a manual purchase item'
call PATCH "/projects/$FP2/procurement/$IT1" 400 "{\"expected_version\":$IT1V,\"status\":\"ordered\"}"; check 'd.error.code==="VALIDATION_ERROR"' 'ordering needs the ordered quantity'
call PATCH "/projects/$FP2/procurement/$IT1" 200 "{\"expected_version\":$IT1V,\"status\":\"ordered\",\"ordered_qty\":\"45\"}"; IT1V="$(js 'd.data.version')"
call POST "/projects/$FP2/procurement/$IT1/deliveries" 400 '{"quantity":"0","received_date":"2027-03-20"}'
call POST "/projects/$FP2/procurement/$IT1/deliveries" 201 '{"quantity":"20","received_date":"2027-03-20","note":"First drop"}'; check 'd.data.status==="part_received"&&d.data.received_qty==="20"' 'part received'
call POST "/projects/$FP2/procurement/$IT1/deliveries" 201 '{"quantity":"25","received_date":"2027-03-22"}'; check 'd.data.status==="received"&&d.data.deliveries.length===2' 'fully received'
call GET "/projects/$FP2/costs" 200; check 'd.data.length===0' 'a delivery never creates an expense'
call GET "/projects/$FP2/procurement/$IT1" 200; IT1V="$(js 'd.data.version')"
call PATCH "/projects/$FP2/procurement/$IT1" 400 "{\"expected_version\":$IT1V,\"status\":\"planned\"}"
call PATCH "/projects/$FP2/procurement/$IT1" 409 "{\"expected_version\":1,\"note\":\"stale\"}"; check 'd.error.code==="VERSION_CONFLICT"' 'stale item version is 409'

echo "  from a calculation: the calculation changes, the order does not"
call POST "/projects/$FP2/rooms" 201 '{"name":"Living room","room_type":"living","length_m":"5","width_m":"4","height_m":"2.5"}'
ROOM="$(js 'd.data.id')"; ROOMV="$(js 'd.data.version')"
call POST "/projects/$FP2/calculations" 201 "{\"calculator_code\":\"flooring\",\"room_id\":\"$ROOM\",\"surface\":\"floor\",\"label\":\"Living room oak\",\"input\":{\"waste_percent\":\"10\",\"pack_area_m2\":\"2.2\",\"pack_price_net\":\"30\",\"labour_basis\":\"none\"}}"
CALC="$(js 'd.data.id')"
call POST "/projects/$FP2/procurement" 201 "{\"calculation_id\":\"$CALC\",\"needed_date\":\"2027-05-01\"}"
IT2="$(js 'd.data.id')"; IT2V="$(js 'd.data.version')"
check 'd.data.purchase_qty==="10"&&d.data.unit==="pack"&&d.data.estimated_cost_minor==="30000"' 'quantities copied from the calculation (10 packs, €300 of material)'
call PATCH "/projects/$FP2/procurement/$IT2" 200 "{\"expected_version\":$IT2V,\"status\":\"ordered\",\"ordered_qty\":\"10\"}"; IT2V="$(js 'd.data.version')"
call PATCH "/projects/$FP2/rooms/$ROOM" 200 "{\"expected_version\":$ROOMV,\"length_m\":\"6\"}"
call GET "/projects/$FP2/procurement/$IT2" 200
check 'd.data.source_stale===true&&d.data.calculation_changed===true&&d.data.ordered_qty==="10"' 'room changed after ordering: flagged, ordered quantity untouched'
call PATCH "/projects/$FP2/procurement/$IT2" 409 "{\"expected_version\":$IT2V,\"ordered_qty\":\"12\"}"; check 'd.error.code==="SOURCE_CHANGED"' 'the change must be acknowledged before editing the order'
call PATCH "/projects/$FP2/procurement/$IT2" 200 "{\"expected_version\":$IT2V,\"ordered_qty\":\"12\",\"acknowledge_change\":true}"; check 'd.data.source_stale===false&&d.data.ordered_qty==="12"' 'acknowledged and changed by the person, explicitly'
call GET "/projects/$FP2/dashboard" 200; check '!d.data.next_actions.some(a=>a.key==="add_rooms")' 'next actions follow the project state'

echo "  AC14: estimate revisions never move money"
call POST "/projects/$FP2/commitments" 201 "{\"title\":\"Strip-out contract\",\"allocations\":[{\"category_id\":\"$CAT2_SITE\",\"agreed_gross_minor\":\"400000\"}]}"
call POST "/projects/$FP2/payments" 201 '{"type":"outgoing","amount_minor":"100000","currency":"EUR","payment_date":"2027-03-01"}'; PX="$(js 'd.data.id')"
call POST "/projects/$FP2/payments/$PX/post" 200 '{"expected_version":1}'
BEFORE="$(curl -s "$API/projects/$FP2/dashboard" -H "authorization: Bearer $TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;process.stdout.write([d.actual_minor,d.committed_remaining_minor,d.paid_minor].join('|'))})")"
call GET "/projects/$FP2/estimates" 200,404
if [ "$(js 'd&&d.data&&d.data.pointers?"yes":"no"')" = "yes" ]; then
  DRAFT="$(js 'd.data.pointers.draft_revision_id')"
  DV="$(curl -s "$API/projects/$FP2/estimates/$DRAFT" -H "authorization: Bearer $TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s).data.version)))")"
  call POST "/projects/$FP2/estimates/$DRAFT/freeze" 200,409 "{\"expected_version\":$DV}"
  call POST "/projects/$FP2/scenarios" 201,404,409 "{\"source_revision_id\":\"$DRAFT\",\"title\":\"Cheaper floors\"}"
fi
AFTER="$(curl -s "$API/projects/$FP2/dashboard" -H "authorization: Bearer $TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;process.stdout.write([d.actual_minor,d.committed_remaining_minor,d.paid_minor].join('|'))})")"
if [ "$BEFORE" = "$AFTER" ]; then PASS=$((PASS+1)); echo "    ✓ AC14 actual, committed and paid are unchanged by revision work ($AFTER)"; else FAIL=$((FAIL+1)); echo "    ✗ AC14 ledger moved: $BEFORE → $AFTER"; fi

echo "  privacy"
TOKEN="$OUTSIDER_TOKEN"
call GET "/projects/$FP2/procurement" 404
call GET "/projects/$FP2/procurement/$IT1" 404
call POST "/projects/$FP2/procurement/$IT1/deliveries" 404 '{"quantity":"1","received_date":"2027-03-22"}'
call POST "/projects/$FP2/forecasts" 404 '{}'
call PATCH "/projects/$FP2/forecasts/$F2" 404 '{"expected_version":1}'
TOKEN="$OWNER_TOKEN"
