# Rooms and geometry, the rate book, benchmarks and calculators (CONTRACT §5–§6). Needs PROJECT_ID from 20-projects.
TOKEN="$OWNER_TOKEN"
if [ -z "${PROJECT_ID:-}" ]; then
  call POST /projects 201 '{"name":"Rooms test","type":"new_build","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":2}'; PROJECT_ID="$(js 'd.data.id')"
fi
P="/projects/$PROJECT_ID"

echo "  rooms"
call POST "$P/rooms" 400 '{"name":"Bad","room_type":"living","length_m":"-5"}'; check 'd.error.field_errors[0].field==="length_m"' 'negative dimensions are refused'
call POST "$P/rooms" 400 '{"name":"Huge","room_type":"living","length_m":"500"}'; check 'd.error.field_errors[0].field==="length_m"' 'implausible dimensions are refused'
call POST "$P/rooms" 400 '{"name":"Bad type","room_type":"ballroom"}'
call POST "$P/rooms" 201 '{"name":"Living room","room_type":"living","storey_index":0,"length_m":"5","width_m":"4","height_m":"2.5"}'; ROOM_ID="$(js 'd.data.id')"
check 'd.data.geometry.floor_area_m2==="20"&&d.data.geometry.perimeter_m==="18"&&d.data.geometry.net_wall_area_m2==="45"' 'geometry from measurements'
check 'd.data.geometry.complete===true&&d.data.measurement_source==="measured"' 'measured and complete'
call POST "$P/rooms/$ROOM_ID/openings" 201 '{"opening_type":"door","width_m":"0.9","height_m":"2.1","count":1}'
call POST "$P/rooms/$ROOM_ID/openings" 201 '{"opening_type":"window","width_m":"1.2","height_m":"1.2","count":2,"wall_label":"South"}'
check 'd.data.geometry.wall_openings_m2==="4.77"&&d.data.geometry.net_wall_area_m2==="40.23"&&d.data.geometry.door_width_total_m==="0.9"' 'openings come off the walls, doors off the skirting'
check 'd.data.geometry_revision===3' 'each opening change bumps the geometry revision'
WINDOW_ID="$(js 'd.data.openings.find(o=>o.opening_type==="window").id')"
call POST "$P/rooms/$ROOM_ID/openings" 422 '{"opening_type":"window","width_m":"10","height_m":"5","count":2}'; check 'd.error.code==="CALCULATION_INVALID"' 'openings larger than the walls are refused'
call POST "$P/rooms/$ROOM_ID/openings" 400 '{"opening_type":"floor_cutout"}'
call PATCH "$P/rooms/$ROOM_ID/openings/$WINDOW_ID" 200 '{"expected_version":1,"count":1}'; check 'd.data.geometry.wall_openings_m2==="3.33"' 'an opening edit recomputes'
call POST "$P/rooms" 201 '{"name":"Hall","room_type":"hall","length_m":"3","width_m":"1.2"}'; HALL_ID="$(js 'd.data.id')"
check 'd.data.geometry.net_wall_area_m2===null&&d.data.geometry.missing.includes("height_m")&&d.data.geometry.complete===false' 'a missing height leaves walls incomplete, not zero'
call POST "$P/rooms" 201 '{"name":"Odd snug","room_type":"other","manual_floor_area_m2":"14.5","manual_perimeter_m":"16","height_m":"2.4"}'; check 'd.data.measurement_source==="manual"&&d.data.geometry.floor_area_m2==="14.5"&&d.data.geometry.warnings.length===1' 'irregular rooms take manual areas with a warning'
call POST "$P/rooms/$ROOM_ID/duplicate" 201 '{"name":"Bedroom 1"}'; BED_ID="$(js 'd.data.id')"; check 'd.data.openings.length===2&&d.data.geometry.floor_area_m2==="20"' 'duplicate copies measurements and openings'
call PATCH "$P/rooms/$BED_ID" 200 '{"expected_version":1,"room_type":"bedroom","width_m":"3.5"}'; check 'd.data.geometry.floor_area_m2==="17.5"&&d.data.geometry_revision===2' 'resizing recomputes'
call PATCH "$P/rooms/$BED_ID" 409 '{"expected_version":1,"name":"Stale"}'
call GET "$P/rooms" 200; check 'd.data.length===4' 'four rooms listed'
TOKEN="$OUTSIDER_TOKEN"
call GET "$P/rooms" 404; call PATCH "$P/rooms/$ROOM_ID" 404 '{"expected_version":1,"name":"x"}'; check 'd.error.code==="NOT_FOUND"' 'AC08 another account cannot touch my rooms'
TOKEN="$OWNER_TOKEN"
call DELETE "$P/rooms/$HALL_ID" 200 '{"expected_version":1}'; check 'd.data.deleted===true&&d.data.hidden===false' 'an unused room is removed'

echo "  rate book"
call GET /catalogue 200; check 'd.data.some(i=>i.code==="floor-finish-pack")' 'calculator specifications in the catalogue'
call GET /regions?country=IE 200
call POST /suppliers 201,404 '{"name":"Oak & Co","trade":"flooring"}'; SUPPLIER_ID="$(js 'd.data&&d.data.id')"
call POST /rates/private 400 '{"name":"Oak","category_code":"FLOORING","unit":"pack","currency":"EUR","net_unit_price":"-3","price_date":"2026-09-01"}'
call POST /rates/private 400 '{"name":"Oak","category_code":"FLOORING","unit":"bucket","currency":"EUR","net_unit_price":"30","price_date":"2026-09-01"}'
call POST /rates/private 400 '{"name":"Oak","category_code":"FLOORING","unit":"pack","currency":"EUR","net_unit_price":"30","price_date":"2026-09-01","includes":{"magic":true}}'
call POST /rates/private 201 '{"name":"Engineered oak, 2.2 m² pack","category_code":"FLOORING","kind":"material","unit":"pack","currency":"EUR","net_unit_price":"30","tax_rate":"0","price_date":"2026-09-01","specification":{"pack_area_m2":"2.2"}}'
OAK_RATE="$(js 'd.data.id')"; check 'd.data.source==="private"&&d.data.net_unit_price==="30"&&d.data.review_due===false' 'a private rate'
call POST /rates/private 201 '{"name":"Paint 5 L, incl. VAT","category_code":"PAINT","unit":"can","currency":"EUR","net_unit_price":"61.5","tax_rate":"23","entered_tax_inclusive":true,"price_date":"2026-09-01"}'
check 'd.data.net_unit_price==="50"&&d.data.specification.entered_gross_unit_price==="61.5"' 'a tax-inclusive price converts to net with its own rate and keeps the original'
PAINT_RATE="$(js 'd.data.id')"
call POST /rates/private 201 '{"name":"Laid oak (fitted)","category_code":"FLOORING","kind":"composite","unit":"pack","currency":"EUR","net_unit_price":"55","price_date":"2026-09-01","includes":{"material":true,"labour":true}}'; FITTED_RATE="$(js 'd.data.id')"
call POST /rates/private 201 '{"name":"US tile box","category_code":"BATHROOM","unit":"pack","currency":"USD","net_unit_price":"40","price_date":"2026-09-01"}'; USD_RATE="$(js 'd.data.id')"
call GET "/rates/private?category=FLOORING" 200; check 'd.data.length===2&&d.data.every(r=>r.category_code==="FLOORING")' 'filtered by category'
TOKEN="$OUTSIDER_TOKEN"
call GET /rates/private 200; check 'd.data.length===0' 'AC08 rate books are private'
call PATCH "/rates/private/$OAK_RATE" 404 '{"expected_version":1,"net_unit_price":"1"}'
TOKEN="$OWNER_TOKEN"

echo "  calculators"
call GET /calculators 200; check 'd.data.length===7&&d.data.every(k=>k.formula_version==="1.0.0")' 'seven versioned calculators'
call POST /calculations/preview 200 "{\"calculator_code\":\"flooring\",\"project_id\":\"$PROJECT_ID\",\"input\":{\"net_area_m2\":\"20\",\"waste_percent\":\"10\",\"pack_area_m2\":\"2.2\",\"pack_price_net\":\"30\",\"labour_rate_net\":\"12\",\"labour_basis\":\"net_area\",\"tax_rate_percent\":\"0\",\"extras\":[]}}"
check 'd.data.quantities.packs===10&&d.data.quantities.required_area_m2==="22"&&d.data.totals.net_minor==="54000"&&d.data.totals.gross_minor==="54000"' 'AC09 flooring fixture: 10 packs, €540 net'
check 'd.data.provenance.origin==="user_entered"&&d.data.provenance.verified_local_benchmark===false' 'provenance says user entered, not a local benchmark'
call POST /calculations/preview 200 "{\"calculator_code\":\"paint\",\"project_id\":\"$PROJECT_ID\",\"input\":{\"net_surface_m2\":\"80\",\"coats\":\"2\",\"coverage_m2_per_litre\":\"10\",\"waste_percent\":\"10\",\"can_size_litres\":\"5\",\"labour_basis\":\"none\"}}"
check 'd.data.quantities.litres_required==="17.6"&&d.data.quantities.cans===4&&d.data.quantities.purchased_litres==="20"' 'AC09 paint fixture: 17.6 L, 4 cans, 20 L'
check 'd.data.totals===null&&d.data.complete===false&&d.data.missing_fields.includes("can_price_net")' 'AC11 no price: quantities shown, cost null, incomplete'
call POST /calculations/preview 200 "{\"calculator_code\":\"flooring\",\"project_id\":\"$PROJECT_ID\",\"room_id\":\"$ROOM_ID\",\"surface\":\"floor\",\"user_rate_id\":\"$OAK_RATE\",\"input\":{\"waste_percent\":\"10\",\"pack_area_m2\":\"2.2\",\"labour_rate_net\":\"12\"}}"
check 'd.data.quantities.net_area_m2==="20"&&d.data.costs.material_net_minor==="30000"&&d.data.provenance.origin==="private_rate"' 'the room fills the area and the chosen rate fills the price'
call POST /calculations/preview 200 "{\"calculator_code\":\"flooring\",\"project_id\":\"$PROJECT_ID\",\"room_id\":\"$ROOM_ID\",\"user_rate_id\":\"$FITTED_RATE\",\"input\":{\"pack_area_m2\":\"2\"}}"
check 'd.data.costs.labour_net_minor==="0"&&d.data.complete===true' 'AC20 a fitted rate adds no labour'
call POST /calculations/preview 422 "{\"calculator_code\":\"flooring\",\"project_id\":\"$PROJECT_ID\",\"user_rate_id\":\"$FITTED_RATE\",\"input\":{\"net_area_m2\":\"20\",\"pack_area_m2\":\"2\",\"labour_rate_net\":\"12\"}}"; check 'd.error.code==="DOUBLE_COUNT"' 'AC20 labour on top of a fitted rate is refused'
call POST /calculations/preview 422 "{\"calculator_code\":\"tiling\",\"project_id\":\"$PROJECT_ID\",\"user_rate_id\":\"$USD_RATE\",\"input\":{\"net_area_m2\":\"5\",\"pack_area_m2\":\"1\"}}"; check 'd.error.code==="CURRENCY_MISMATCH"' 'AC12 a rate in another currency is never converted'
call POST /calculations/preview 422 "{\"calculator_code\":\"flooring\",\"project_id\":\"$PROJECT_ID\",\"user_rate_id\":\"$PAINT_RATE\",\"input\":{\"net_area_m2\":\"5\",\"pack_area_m2\":\"1\"}}"; check 'd.error.code==="UNIT_MISMATCH"' 'AC12 a rate in the wrong unit is refused'
call POST /calculations/preview 422 "{\"calculator_code\":\"flooring\",\"project_id\":\"$PROJECT_ID\",\"input\":{\"net_area_m2\":\"20\"}}"; check 'd.error.code==="CALCULATION_INPUT_MISSING"&&Boolean(d.error.fields.pack_area_m2)' 'missing required data is 422 with the field'
call POST /calculations/preview 422 "{\"calculator_code\":\"paint\",\"project_id\":\"$PROJECT_ID\",\"input\":{\"net_surface_m2\":\"10\",\"coats\":\"1\",\"coverage_m2_per_litre\":\"10\",\"can_size_litres\":\"5\",\"currency\":\"USD\"}}"; check 'd.error.code==="CURRENCY_MISMATCH"' 'prices in another currency are refused'
call POST /calculations/preview 200 "{\"calculator_code\":\"skirting\",\"project_id\":\"$PROJECT_ID\",\"room_id\":\"$ROOM_ID\",\"input\":{\"waste_percent\":\"10\",\"stock_length_m\":\"2.4\",\"labour_basis\":\"none\"}}"
check 'd.data.quantities.required_length_m==="17.1"&&d.data.quantities.pieces===8' 'skirting from the room perimeter minus the door'
call POST /calculations/preview 200 "{\"calculator_code\":\"wallpaper\",\"project_id\":\"$PROJECT_ID\",\"room_id\":\"$ROOM_ID\",\"input\":{\"roll_width_m\":\"0.53\",\"roll_length_m\":\"10.05\",\"labour_basis\":\"none\"}}"; check 'd.data.quantities.rolls>0' 'wallpaper walls come from the room'
call POST /calculations/preview 200 "{\"calculator_code\":\"paint\",\"project_id\":\"$PROJECT_ID\",\"room_id\":\"$ROOM_ID\",\"surface\":\"walls\",\"user_rate_id\":\"$PAINT_RATE\",\"input\":{\"coats\":\"2\",\"coverage_m2_per_litre\":\"10\",\"can_size_litres\":\"5\",\"labour_basis\":\"none\"}}"
check 'd.data.quantities.net_surface_m2==="41.67"&&d.data.costs.material_net_minor!==null' 'paint uses the net wall area'
TOKEN="$OUTSIDER_TOKEN"
call POST /calculations/preview 404 "{\"calculator_code\":\"general\",\"project_id\":\"$PROJECT_ID\",\"input\":{\"quantity\":\"1\"}}"; check 'd.error.code==="NOT_FOUND"' 'AC08 cannot preview against another account project'
TOKEN="$OWNER_TOKEN"

echo "  saved calculations"
call POST "$P/calculations" 201 "{\"calculator_code\":\"flooring\",\"room_id\":\"$ROOM_ID\",\"user_rate_id\":\"$OAK_RATE\",\"label\":\"Living room oak\",\"input\":{\"waste_percent\":\"10\",\"pack_area_m2\":\"2.2\",\"labour_rate_net\":\"12\"}}"
CALC_ID="$(js 'd.data.id')"; check 'd.data.price_complete===true&&d.data.output.totals.net_minor==="54000"&&d.data.room_name==="Living room"&&d.data.room_changed===false' 'a saved, immutable calculation'
call POST "$P/calculations" 201 "{\"calculator_code\":\"paint\",\"input\":{\"net_surface_m2\":\"80\",\"coats\":\"2\",\"coverage_m2_per_litre\":\"10\",\"can_size_litres\":\"5\",\"labour_basis\":\"none\"}}"; PAINT_CALC="$(js 'd.data.id')"
check 'd.data.price_complete===false' 'a calculation can be saved without prices'
call GET "$P/calculations" 200; check 'd.data.length===2' 'listed'
call GET "$P/calculations/$CALC_ID" 200
TOKEN="$OUTSIDER_TOKEN"; call GET "$P/calculations/$CALC_ID" 404; TOKEN="$OWNER_TOKEN"

echo "  stale rates and room changes"
call PATCH "/rates/private/$OAK_RATE" 200 '{"expected_version":1,"net_unit_price":"32"}'; check 'd.data.net_unit_price==="32"' 'a rate update'
call PATCH "/rates/private/$OAK_RATE" 409 '{"expected_version":1,"net_unit_price":"33"}'
call GET "$P/calculations/$CALC_ID" 200; check 'd.data.output.costs.material_net_minor==="30000"' 'a saved calculation keeps its rate snapshot'
call PATCH "$P/rooms/$ROOM_ID" 200 '{"expected_version":1,"length_m":"5.5"}'
call GET "$P/calculations/$CALC_ID" 200; check 'd.data.room_changed===true&&d.data.output.quantities.net_area_m2==="20"' 'the room changed: the calculation says so and is never rewritten'
call PATCH "$P/rooms/$ROOM_ID" 200 '{"expected_version":2,"length_m":"5"}'

echo "  benchmarks (exact matches only)"
call GET "/rates/benchmarks?country=ZZ" 200; check 'd.data.coverage==="unavailable"&&d.data.message==="Local benchmarks unavailable; enter your rates."' 'unsupported region: honest message, no invented prices'
call GET /rates/benchmarks 400
admin POST /admin/regions 201 "{\"country_code\":\"IE\",\"code\":\"t${STAMP}\",\"name\":\"Test county ${STAMP}\"}"; REGION_ID="$(js 'd.data&&d.data.id')"
admin POST /admin/sources 201 "{\"source_name\":\"Fictional survey ${STAMP}\",\"obtained_at\":\"2026-09-01\",\"licence_note\":\"Test fixture, not real prices\",\"publishable\":true}"; SOURCE_ID="$(js 'd.data&&d.data.id')"
if [ -n "$REGION_ID" ] && [ -n "$SOURCE_ID" ]; then
  OLD="$(node -e "console.log(new Date(Date.now()-200*864e5).toISOString().slice(0,10))")"; OLDER="$(node -e "console.log(new Date(Date.now()-150*864e5).toISOString().slice(0,10))")"
  admin POST /admin/benchmarks 201 "{\"item_code\":\"floor-finish-pack\",\"country_code\":\"IE\",\"region_code\":\"t${STAMP}\",\"currency\":\"EUR\",\"unit\":\"pack\",\"net_unit_price\":\"29\",\"tax_rate\":\"0\",\"effective_date\":\"$OLD\",\"source_id\":\"$SOURCE_ID\",\"spec_json\":{\"pack_area_m2\":\"2.2\"}}"; BATCH="$(js 'd.data&&d.data.batch_id')"
  admin POST /admin/benchmarks 201 "{\"batch_id\":\"$BATCH\",\"item_code\":\"paint-can\",\"country_code\":\"IE\",\"region_code\":\"t${STAMP}\",\"currency\":\"EUR\",\"unit\":\"can\",\"net_unit_price\":\"40\",\"tax_rate\":\"0\",\"effective_date\":\"$OLD\",\"valid_until\":\"$OLDER\",\"source_id\":\"$SOURCE_ID\",\"spec_json\":{\"coverage_m2_per_litre\":\"10\",\"can_size_litres\":\"5\"}}"
  admin POST /admin/benchmarks/validate 200 "{\"batch_id\":\"$BATCH\"}"
  admin POST /admin/benchmarks/publish 200 "{\"batch_id\":\"$BATCH\"}"
  call GET "/rates/benchmarks?country=IE&region_id=$REGION_ID" 200
  check 'd.data.coverage==="available"&&d.data.rates.length===2' 'published local benchmarks for the region'
  check 'd.data.rates.every(r=>r.review_due===true)&&d.data.rates.some(r=>r.expired===true)' '90-day review and expiry are flagged'
  BENCH_FLOOR="$(js 'd.data.rates.find(r=>r.item_code==="floor-finish-pack").id')"; BENCH_PAINT="$(js 'd.data.rates.find(r=>r.item_code==="paint-can").id')"
  call POST /calculations/preview 422 "{\"calculator_code\":\"flooring\",\"project_id\":\"$PROJECT_ID\",\"benchmark_rate_id\":\"$BENCH_FLOOR\",\"input\":{\"net_area_m2\":\"20\",\"pack_area_m2\":\"2.2\",\"labour_basis\":\"none\"}}"
  check 'd.error.code==="BENCHMARK_MISMATCH"' 'AC12 a regional benchmark never applies to a project outside that region'
  call GET "$P" 200; PV="$(js 'd.data.version')"
  call PATCH "$P" 200 "{\"expected_version\":$PV,\"region_id\":\"$REGION_ID\"}"
  call POST /calculations/preview 200 "{\"calculator_code\":\"flooring\",\"project_id\":\"$PROJECT_ID\",\"benchmark_rate_id\":\"$BENCH_FLOOR\",\"input\":{\"net_area_m2\":\"20\",\"pack_area_m2\":\"2.2\",\"labour_basis\":\"none\"}}"
  check 'd.data.provenance.origin==="benchmark"&&d.data.provenance.verified_local_benchmark===true&&d.data.costs.material_net_minor==="29000"' 'an exact regional benchmark prices the calculation'
  call POST /calculations/preview 422 "{\"calculator_code\":\"paint\",\"project_id\":\"$PROJECT_ID\",\"benchmark_rate_id\":\"$BENCH_PAINT\",\"input\":{\"net_surface_m2\":\"80\",\"coats\":\"2\",\"coverage_m2_per_litre\":\"10\",\"can_size_litres\":\"5\",\"labour_basis\":\"none\"}}"
  check 'd.error.code==="RATE_EXPIRED"' 'AC12 an expired benchmark is never used automatically'
  call POST /calculations/preview 200 "{\"calculator_code\":\"paint\",\"project_id\":\"$PROJECT_ID\",\"benchmark_rate_id\":\"$BENCH_PAINT\",\"stale_override\":true,\"input\":{\"net_surface_m2\":\"80\",\"coats\":\"2\",\"coverage_m2_per_litre\":\"10\",\"can_size_litres\":\"5\",\"labour_basis\":\"none\"}}"
  check 'd.data.costs.material_net_minor==="16000"' 'AC12 an explicit stale override is allowed'
  BENCH_OK=1
else
  echo "    (admin benchmark routes unavailable on this server: benchmark use checks skipped)"
fi
