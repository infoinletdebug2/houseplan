# Estimates, revisions, baseline, scenarios (CONTRACT §7). Needs PROJECT_ID, ROOM_ID, CALC_ID, category ids from 20/30.
TOKEN="$OWNER_TOKEN"
P="/projects/$PROJECT_ID"

echo "  the first draft"
call GET "$P/estimates" 200; DRAFT="$(js 'd.data.pointers.draft_revision_id')"
check 'd.data.revisions.length===1&&d.data.revisions[0].status==="draft"&&d.data.pointers.current_revision_id===null' 'a new project has one draft and no current revision'
call GET "$P/estimates/$DRAFT" 200
check 'd.data.categories.length===19&&d.data.missing_line_count===3&&d.data.gross_known_minor==="0"' 'starter allowances are unpriced: missing, not zero'
check 'd.data.categories.find(c=>c.code==="SITE").lines[0].price_missing===true' 'a missing price is flagged on the line'
SITE_LINE="$(js 'd.data.categories.find(c=>c.code==="SITE").lines[0].id')"; FOUND_LINE="$(js 'd.data.categories.find(c=>c.code==="FOUNDATION").lines[0].id')"; STRUCT_LINE="$(js 'd.data.categories.find(c=>c.code==="STRUCTURE").lines[0].id')"

echo "  lines"
call POST "$P/estimates/$DRAFT/lines" 400 "{\"category_id\":\"$SITE_CAT\",\"mode\":\"teleport\",\"label\":\"x\"}"
call POST "$P/estimates/$DRAFT/lines" 404 "{\"category_id\":\"$(uuid)\",\"mode\":\"allowance\",\"label\":\"x\",\"net_unit_price\":\"10\"}"
call POST "$P/estimates/$DRAFT/lines" 201 "{\"calculation_id\":\"$CALC_ID\"}"; CALC_LINE="$(js 'd.data.line.id')"
check 'd.data.line.gross_minor==="54000"&&d.data.line.rate_origin==="calculation"&&d.data.line.category_code==="FLOORING"&&d.data.line.room_name==="Living room"' 'a calculation becomes a line with its own result'
call POST "$P/estimates/$DRAFT/lines" 201 "{\"category_id\":\"$OPEN_CAT\",\"mode\":\"manual_quantity\",\"label\":\"Front door\",\"unit\":\"item\",\"quantity\":\"1\",\"entered_gross_unit_price\":\"1230\",\"tax_rate\":\"23\"}"
check 'd.data.line.net_unit_price==="1000"&&d.data.line.net_minor==="100000"&&d.data.line.tax_minor==="23000"&&d.data.line.gross_minor==="123000"' 'tax-inclusive entry: net from its explicit rate, tax recomputed'
check 'd.data.line.rate_snapshot.entered_gross_unit_price==="1230"' 'the entered gross price is kept'
DOOR_LINE="$(js 'd.data.line.id')"
call POST "$P/estimates/$DRAFT/lines" 400 "{\"category_id\":\"$KITCHEN_CAT\",\"mode\":\"allowance\",\"label\":\"Donated units\",\"net_unit_price\":\"0\"}"; check 'd.error.code==="ZERO_COST_REASON_REQUIRED"' 'a zero-cost line needs a reason'
call POST "$P/estimates/$DRAFT/lines" 201 "{\"category_id\":\"$KITCHEN_CAT\",\"mode\":\"allowance\",\"label\":\"Donated units\",\"net_unit_price\":\"0\",\"zero_cost_reason\":\"Provided at no cost by family\"}"
check 'd.data.line.gross_minor==="0"&&d.data.line.quantity==="1"&&d.data.line.unit==="lump_sum"' 'an allowance is one lump sum'
call POST "$P/estimates/$DRAFT/lines" 422 "{\"category_id\":\"$KITCHEN_CAT\",\"mode\":\"manual_quantity\",\"label\":\"Worktop\",\"unit\":\"m\",\"quantity\":\"4.2\",\"user_rate_id\":\"$OAK_RATE\"}"; check 'd.error.code==="UNIT_MISMATCH"' 'a per-pack rate cannot price metres'
call POST "$P/estimates/$DRAFT/lines" 201 "{\"category_id\":\"$FLOOR_CAT\",\"mode\":\"manual_quantity\",\"label\":\"Hall oak packs\",\"unit\":\"pack\",\"quantity\":\"3\",\"user_rate_id\":\"$OAK_RATE\",\"extras\":[{\"label\":\"Delivery\",\"amount_net\":\"25\"}]}"
check 'd.data.line.rate_origin==="private_rate"&&d.data.line.net_minor==="12100"&&d.data.line.extras.length===1' 'a private rate prices quantity plus itemised extras'
RATE_LINE="$(js 'd.data.line.id')"
call POST "$P/estimates/$DRAFT/lines" 201 "{\"category_id\":\"$LAND_ID\",\"mode\":\"allowance\",\"label\":\"Plot\",\"net_unit_price\":\"90000\"}"
check 'd.data.revision.gross_known_minor===String(54000+123000+12100)' 'excluded categories never count toward the known total'
call POST "$P/estimates/$DRAFT/lines" 201 "{\"category_id\":\"$PAINT_CAT\",\"mode\":\"manual_quantity\",\"label\":\"Paint, price to follow\",\"unit\":\"m2\",\"quantity\":\"120\"}"
check 'd.data.line.price_missing===true&&d.data.revision.missing_line_count===4' 'a quantity without a price is missing, never zero (AC11)'
PAINT_LINE="$(js 'd.data.line.id')"; RV="$(js 'd.data.revision.version')"

echo "  editing a draft"
call PATCH "$P/estimates/$DRAFT/lines/$SITE_LINE" 200 '{"expected_version":1,"net_unit_price":"8000"}'; check 'd.data.line.gross_minor==="800000"&&d.data.line.mode==="allowance"' 'pricing the site allowance'
call PATCH "$P/estimates/$DRAFT/lines/$FOUND_LINE" 200 '{"expected_version":1,"net_unit_price":"25000","tax_rate":"13.5"}'; check 'd.data.line.tax_minor==="337500"' 'allowance with tax'
call PATCH "$P/estimates/$DRAFT/lines/$STRUCT_LINE" 200 '{"expected_version":1,"net_unit_price":"60000"}'
call PATCH "$P/estimates/$DRAFT/lines/$STRUCT_LINE" 409 '{"expected_version":1,"net_unit_price":"1"}'; check 'd.error.code==="VERSION_CONFLICT"' 'stale line version is 409'
IFMATCH=1
call PATCH "$P/estimates/$DRAFT/lines/$PAINT_LINE" 200 '{"net_unit_price":"9"}'; check 'd.data.line.gross_minor==="108000"&&d.data.revision.missing_line_count===0' 'If-Match on lines; pricing clears the missing count'
IFMATCH=""
call PATCH "$P/estimates/$DRAFT/lines/$PAINT_LINE" 200 '{"expected_version":2,"deferred":true}'; check 'd.data.revision.deferred_minor==="108000"' 'a deferred line is delayed, reported separately'
call PATCH "$P/estimates/$DRAFT/lines/$PAINT_LINE" 200 '{"expected_version":3,"deferred":false}'
call POST "$P/estimates/$DRAFT/lines" 201 "{\"category_id\":\"$SITE_CAT\",\"mode\":\"allowance\",\"label\":\"Temporary\",\"net_unit_price\":\"1\"}"; TMP_LINE="$(js 'd.data.line.id')"
call DELETE "$P/estimates/$DRAFT/lines/$TMP_LINE" 200 '{"expected_version":1}'; check 'd.data.revision.line_count>0' 'a draft line can be removed'
call PATCH "$P/estimates/$DRAFT/settings" 400 '{"expected_version":1,"contingency_percent":"45"}'; check 'd.error.field_errors[0].field==="contingency_percent"' 'contingency is limited to 0–30%'
call GET "$P/estimates/$DRAFT" 200; RV="$(js 'd.data.version')"; GROSS="$(js 'd.data.gross_known_minor')"
call PATCH "$P/estimates/$DRAFT/settings" 200 "{\"expected_version\":$RV,\"contingency_percent\":\"10\",\"title\":\"Planning estimate\"}"
check 'd.data.reserve_minor===String(Math.round(Number(d.data.contingency_base_minor)/10))&&d.data.title==="Planning estimate"' 'the reserve is 10% of the selected priced categories, applied once'
check 'BigInt(d.data.total_with_reserve_minor)===BigInt(d.data.gross_known_minor)+BigInt(d.data.reserve_minor)' 'total with reserve is labelled separately'
RV="$(js 'd.data.version')"
TOKEN="$OUTSIDER_TOKEN"
call GET "$P/estimates/$DRAFT" 404; call PATCH "$P/estimates/$DRAFT/lines/$SITE_LINE" 404 '{"expected_version":2,"net_unit_price":"1"}'; check 'd.error.code==="NOT_FOUND"' 'AC08 another account cannot read or edit my estimate'
TOKEN="$OWNER_TOKEN"

echo "  save, current and baseline"
call POST "$P/estimates/$DRAFT/freeze" 409 '{"expected_version":1}'; check 'd.error.code==="VERSION_CONFLICT"' 'freezing checks the version'
call GET "$P/estimates/$DRAFT" 200; check 'd.data.categories.find(c=>c.code==="FLOORING").lines.find(l=>l.id==="'"$CALC_LINE"'").stale===false' 'calculation line is fresh'
call POST "$P/estimates/$DRAFT/freeze" 200 "{\"expected_version\":$RV}"; check 'd.data.status==="frozen"&&d.data.frozen_at!==null' 'saved: the revision is frozen'
REV1="$DRAFT"; REV1_GROSS="$(js 'd.data.gross_known_minor')"
call PATCH "$P/estimates/$REV1/lines/$SITE_LINE" 409 '{"expected_version":2,"net_unit_price":"1"}'; check 'd.error.code==="REVISION_FROZEN"' 'a saved revision cannot change'
call POST "$P/estimates/$REV1/lines" 409 "{\"category_id\":\"$SITE_CAT\",\"mode\":\"allowance\",\"label\":\"x\",\"net_unit_price\":\"1\"}"
call POST "$P/estimates/$REV1/set-baseline" 400 '{}'; check 'd.error.code==="CONFIRMATION_REQUIRED"' 'baseline needs explicit confirmation'
call POST "$P/estimates/$REV1/set-baseline" 200 '{"confirm":true}'; check 'd.data.pointers.baseline_revision_id==="'"$REV1"'"' 'baseline pinned'
call POST "$P/estimates/$REV1/set-current" 200; check 'd.data.pointers.current_revision_id==="'"$REV1"'"&&d.data.pointers.draft_revision_id===null' 'current set; no draft'

echo "  a second draft and AC13"
call POST "$P/estimates" 201 "{\"source_revision_id\":\"$REV1\",\"title\":\"After architect\"}"; REV2="$(js 'd.data.id')"
check 'd.data.revision_number===2&&d.data.status==="draft"&&d.data.gross_known_minor==="'"$REV1_GROSS"'"' 'a new draft forks from the saved revision with the same totals'
call POST "$P/estimates" 409 "{\"source_revision_id\":\"$REV1\"}"; check 'd.error.code==="DRAFT_EXISTS"&&d.error.fields.draft_revision_id==="'"$REV2"'"' 'one draft at a time; the error names it'
call POST "$P/estimates" 409 "{\"source_revision_id\":\"$REV2\"}"
call GET "$P/rooms" 200; RV_ROOM="$(js 'd.data.find(r=>r.id==="'"$ROOM_ID"'").version')"
call PATCH "$P/rooms/$ROOM_ID" 200 "{\"expected_version\":$RV_ROOM,\"length_m\":\"6\"}"; check 'd.meta.stale_lines>=1' 'AC13 changing the room flags dependent draft lines'
call GET "$P/estimates/$REV1" 200; check 'd.data.gross_known_minor==="'"$REV1_GROSS"'"&&d.data.categories.find(c=>c.code==="FLOORING").lines.every(l=>l.stale===false)' 'AC13 the saved baseline is unchanged'
call GET "$P/estimates/$REV2" 200; R2V="$(js 'd.data.version')"; check 'd.data.categories.find(c=>c.code==="FLOORING").lines.some(l=>l.stale===true&&l.label==="Living room oak")' 'the draft line is stale'
call POST "$P/estimates/$REV2/freeze" 409 "{\"expected_version\":$R2V}"; check 'd.error.code==="STALE_LINES"' 'a draft with stale lines cannot be saved'
call POST "$P/estimates/$REV2/recalculate" 200 "{\"expected_version\":$R2V,\"accept\":false}"
check 'd.data.applied===false&&d.data.changes.some(x=>x.label==="Living room oak"&&x.before_gross_minor==="54000"&&x.after_gross_minor!=="54000")' 'recalculation previews the new amount first'
call POST "$P/estimates/$REV2/recalculate" 200 "{\"expected_version\":$R2V,\"accept\":true}"; check 'd.data.applied===true' 'accepted'
call GET "$P/estimates/$REV2" 200; R2V="$(js 'd.data.version')"
check 'd.data.categories.every(c=>c.lines.every(l=>!l.stale))&&d.data.gross_known_minor!=="'"$REV1_GROSS"'"' 'the recomputed draft has a new total and no stale lines'
call GET "$P/estimate-diff?from=$REV1&to=$REV2" 200
check 'd.data.comparable===true&&d.data.categories.find(c=>c.code==="FLOORING").delta_minor!=="0"&&d.data.lines.some(l=>l.change==="changed")' 'revision diff by category and line'
call POST "$P/estimates/$REV2/freeze" 200 "{\"expected_version\":$R2V}"
call POST "$P/estimates/$REV2/set-current" 200; check 'd.data.pointers.current_revision_id==="'"$REV2"'"&&d.data.pointers.baseline_revision_id==="'"$REV1"'"' 'current moves; baseline never changes implicitly'

echo "  scenarios"
call POST "$P/scenarios" 400 "{\"source_revision_id\":\"$REV2\",\"title\":\"\"}"
call POST "$P/scenarios" 201 "{\"source_revision_id\":\"$REV2\",\"title\":\"Oak floors to vinyl\",\"change_summary\":\"Vinyl in the living room\",\"tradeoffs\":[{\"kind\":\"plus\",\"text\":\"Easier care\"},{\"kind\":\"minus\",\"text\":\"Cannot be refinished\"}]}"
SCEN="$(js 'd.data.id')"; SREV="$(js 'd.data.scenario_revision_id')"; check 'd.data.status==="draft"&&d.data.revision.kind==="scenario"&&d.data.tradeoffs.length===2' 'an independent scenario draft'
call GET "$P/estimates" 200; check 'd.data.pointers.draft_revision_id===null' 'a scenario draft is not the project draft'
call GET "$P/estimates/$SREV" 200; SFLOOR="$(js 'd.data.categories.find(c=>c.code==="FLOORING").lines.find(l=>l.label==="Living room oak").id')"; SFV="$(js 'd.data.categories.find(c=>c.code==="FLOORING").lines.find(l=>l.label==="Living room oak").version')"
call PATCH "$P/estimates/$SREV/lines/$SFLOOR" 200 "{\"expected_version\":$SFV,\"calculation_id\":null,\"mode\":\"manual_quantity\",\"unit\":\"m2\",\"quantity\":\"24\",\"net_unit_price\":\"15\",\"label\":\"Living room vinyl\"}"
check 'd.data.line.gross_minor==="36000"&&d.data.line.calculation_id===null' 'a scenario line changes the finish'
call GET "$P/scenarios/$SCEN/compare?against=current" 200; check 'd.data.savings_minor!==null' 'a priced, same-scope scenario shows a saving'
SAVE="$(js 'd.data.savings_minor')"; check 'Number(d.data.savings_minor)>0&&d.data.conflicts.length===0' 'cheaper, and no accepted obligations conflict'
call POST "$P/scenarios/$SCEN/adopt" 409; check 'd.error.code==="REVISION_NOT_FROZEN"' 'an unsaved scenario cannot be adopted'
call GET "$P/estimates/$SREV" 200; SV="$(js 'd.data.version')"
call POST "$P/estimates/$SREV/freeze" 200 "{\"expected_version\":$SV}"
call POST "$P/estimates/$SREV/set-current" 409; check 'd.error.code==="SCENARIO_REVISION"' 'a scenario becomes current only by adoption'
call PATCH "$P/scenarios/$SCEN" 200 '{"expected_version":1,"title":"Vinyl in the living room"}'
call POST "$P/scenarios/$SCEN/adopt" 201; NEWREV="$(js 'd.data.revision.id')"
check 'd.data.revision.kind==="current"&&d.data.revision.status==="frozen"&&d.data.pointers.current_revision_id===d.data.revision.id' 'AC14 adoption creates a new frozen current revision'
check 'd.data.pointers.baseline_revision_id==="'"$REV1"'"' 'AC14 the baseline is untouched'
call POST "$P/scenarios/$SCEN/adopt" 409; check 'd.error.code==="ALREADY_ADOPTED"' 'a scenario is adopted once'
call GET "$P/scenarios" 200; check 'd.data[0].status==="adopted"&&d.data[0].adopted_revision_id==="'"$NEWREV"'"' 'listed as adopted'
call GET "$P/estimates?kind=current" 200; check 'd.data.revisions.length===3&&d.data.revisions.every(r=>r.kind==="current")' 'revision history: three saved estimate revisions'
call GET "$P/estimate-diff?from=$REV1&to=$NEWREV" 200; check 'd.data.lines.some(l=>l.change==="added"&&l.label==="Living room vinyl")' 'the history diff shows the adopted change'
TOKEN="$OUTSIDER_TOKEN"; call GET "$P/scenarios/$SCEN/compare" 404; call POST "$P/scenarios/$SCEN/adopt" 404; TOKEN="$OWNER_TOKEN"
