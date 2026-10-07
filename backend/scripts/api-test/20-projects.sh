# Projects, the scope checklist, phases (CONTRACT §4). Leaves PROJECT_ID (EUR, new build) for later sections.
TOKEN="$UNPAID_TOKEN"
call GET /projects 403; check 'd.error.code==="EMAIL_NOT_VERIFIED"' 'AC01 unverified account cannot list projects'
TOKEN="$OWNER_TOKEN"
call GET /projects 200; check 'Array.isArray(d.data)&&d.meta.limits.active_projects===5' 'project list with the 5-project limit'

echo "  create"
call POST /projects 400 '{"name":"","type":"new_build","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":2}'
call POST /projects 400 '{"name":"X","type":"castle","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":2}'
call POST /projects 400 '{"name":"X","type":"new_build","country_code":"IE","currency":"ZZZ","unit_system":"metric","storeys":2}'
call POST /projects 400 '{"name":"X","type":"new_build","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":0}'; check 'd.error.field_errors[0].field==="storeys"' 'zero storeys is invalid for a house'
call POST /projects 400 '{"name":"X","type":"new_build","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":2,"planned_start":"2027-05-01","planned_end":"2027-01-01"}'
call POST /projects 400 '{"name":"X","type":"new_build","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":2,"owner_user_id":"someone-else"}'; check 'd.error.code==="VALIDATION_ERROR"' 'a caller-provided owner is refused'
KEY="$(uuid)"
call POST /projects 201 '{"name":"Willow House","type":"new_build","country_code":"IE","currency":"EUR","unit_system":"metric","area_m2":"140","storeys":2,"target_budget_minor":"35000000","finish_tier":"standard","planned_start":"2027-01-10","planned_end":"2027-12-20","private_address":"1 Example Lane"}'
PROJECT_ID="$(js 'd.data.id')"
check 'd.data.currency==="EUR"&&d.data.area_m2==="140"&&d.data.target_budget_minor==="35000000"' 'project saved with decimal and money strings'
check 'd.data.private_address==="1 Example Lane"&&d.data.has_address===true' 'the private address is returned to its owner'
check 'd.data.summary.estimate_gross_known_minor==="0"&&d.data.summary.missing_line_count===3' 'a new build starts with three unpriced allowance lines, never zero cost'
check 'd.data.summary.undecided_categories===3' 'land, fees and outside works start undecided'
call POST /projects 200,201 '{"name":"Willow House","type":"new_build","country_code":"IE","currency":"EUR","unit_system":"metric","area_m2":"140","storeys":2,"target_budget_minor":"35000000","finish_tier":"standard","planned_start":"2027-01-10","planned_end":"2027-12-20","private_address":"1 Example Lane"}'
check 'd.meta.replayed===true&&d.data.id==="'"$PROJECT_ID"'"' 'AC29 same Idempotency-Key replays the same project'
call POST /projects 409 '{"name":"Other","type":"renovation","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":1}'; check 'd.error.code==="IDEMPOTENCY_MISMATCH"' 'same key with a different body is 409'
KEY=""
call POST /projects 201 '{"name":"Granny flat","type":"renovation","country_code":"US","currency":"USD","unit_system":"imperial","storeys":1,"inclusions":{"KITCHEN":"included"}}'
RENO_ID="$(js 'd.data.id')"
check 'd.data.summary.missing_line_count===2' 'a renovation starts with demolition and disposal allowances'

echo "  read and isolation"
call GET "/projects/$PROJECT_ID" 200; check 'd.data.name==="Willow House"' 'project detail'
call GET /projects 200; check 'd.data.some(p=>p.id==="'"$PROJECT_ID"'")&&d.data.every(p=>p.private_address===undefined)' 'listed; the list never carries the address'
call GET "/projects?q=willow" 200; check 'd.data.length===1' 'search by name'
TOKEN="$OUTSIDER_TOKEN"
call GET "/projects/$PROJECT_ID" 404; check 'd.error.code==="NOT_FOUND"' 'AC08 another account gets 404 on my project'
call PATCH "/projects/$PROJECT_ID" 404 '{"expected_version":1,"name":"Mine now"}'
call GET "/projects/$PROJECT_ID/categories" 404
call GET /projects/not-a-uuid 404
TOKEN="$OWNER_TOKEN"

echo "  update"
call PATCH "/projects/$PROJECT_ID" 409 '{"expected_version":99,"name":"Willow"}'; check 'd.error.code==="VERSION_CONFLICT"' 'stale version is 409'
call PATCH "/projects/$PROJECT_ID" 400 '{"expected_version":1,"currency":"EUR","owner_user_id":"x"}'
call PATCH "/projects/$PROJECT_ID" 200 '{"expected_version":1,"name":"Willow House","storeys":2,"unit_system":"metric"}'; check 'd.data.version===2' 'update returns the new version'
IFMATCH=2
call PATCH "/projects/$PROJECT_ID" 200 '{"target_budget_minor":"36000000"}'; check 'd.data.version===3&&d.data.target_budget_minor==="36000000"' 'If-Match works as the version'
IFMATCH=""
call PATCH "/projects/$PROJECT_ID" 400 '{"expected_version":3,"target_budget_minor":12.5}'; check 'd.error.field_errors[0].field==="target_budget_minor"' 'money must be whole minor units'

echo "  scope checklist"
call GET "/projects/$PROJECT_ID/categories" 200; check 'd.data.length===19&&d.data[0].code==="LAND"' 'all 19 budget categories'
check 'd.data.every(c=>c.explain.length>0&&c.method.length>0)' 'each category explains itself'
LAND_ID="$(js 'd.data.find(c=>c.code==="LAND").id')"; FEES_ID="$(js 'd.data.find(c=>c.code==="FEES").id')"; EXT_ID="$(js 'd.data.find(c=>c.code==="EXTERNAL").id')"
FLOOR_CAT="$(js 'd.data.find(c=>c.code==="FLOORING").id')"; PAINT_CAT="$(js 'd.data.find(c=>c.code==="PAINT").id')"; SITE_CAT="$(js 'd.data.find(c=>c.code==="SITE").id')"
OPEN_CAT="$(js 'd.data.find(c=>c.code==="OPENINGS").id')"; STRUCT_CAT="$(js 'd.data.find(c=>c.code==="STRUCTURE").id')"; FOUND_CAT="$(js 'd.data.find(c=>c.code==="FOUNDATION").id')"
KITCHEN_CAT="$(js 'd.data.find(c=>c.code==="KITCHEN").id')"
call PATCH "/projects/$PROJECT_ID/categories" 409 "{\"changes\":[{\"id\":\"$LAND_ID\",\"inclusion\":\"excluded\",\"expected_version\":7}]}"
call PATCH "/projects/$PROJECT_ID/categories" 400 "{\"changes\":[{\"id\":\"$LAND_ID\",\"inclusion\":\"maybe\",\"expected_version\":1}]}"
call PATCH "/projects/$PROJECT_ID/categories" 200 "{\"changes\":[{\"id\":\"$LAND_ID\",\"inclusion\":\"excluded\",\"expected_version\":1},{\"id\":\"$FEES_ID\",\"inclusion\":\"included\",\"note\":\"Architect quote due\",\"expected_version\":1},{\"id\":\"$EXT_ID\",\"inclusion\":\"excluded\",\"expected_version\":1}]}"
check 'd.data.find(c=>c.code==="LAND").inclusion==="excluded"&&d.data.find(c=>c.code==="FEES").note==="Architect quote due"' 'inclusion and notes saved'
call GET "/projects/$PROJECT_ID" 200; check 'd.data.summary.undecided_categories===0' 'deciding categories updates the estimate completeness'
call PATCH "/projects/$RENO_ID/categories" 404 "{\"changes\":[{\"id\":\"$LAND_ID\",\"inclusion\":\"included\",\"expected_version\":2}]}"; check 'd.error.code==="NOT_FOUND"' 'a category id from another project is refused'

echo "  phases"
call GET "/projects/$PROJECT_ID/phases" 200; check 'd.data.length===10&&d.data[0].status==="planned"' 'ten planned build phases'
PHASE_ID="$(js 'd.data[1].id')"
call PATCH "/projects/$PROJECT_ID/phases/$PHASE_ID" 200 '{"expected_version":1,"status":"in_progress","progress_percent":40,"actual_start":"2027-01-12"}'; check 'd.data.status==="in_progress"&&d.data.progress_percent===40' 'progress is a user report'
call PATCH "/projects/$PROJECT_ID/phases/$PHASE_ID" 400 '{"expected_version":2,"progress_percent":140}'
call PATCH "/projects/$PROJECT_ID/phases/$PHASE_ID" 409 '{"expected_version":1,"progress_percent":50}'
call POST "/projects/$PROJECT_ID/phases" 201 '{"name":"Solar panels","planned_start":"2027-09-01","planned_end":"2027-09-10"}'; check 'd.data.order_index===11' 'a custom phase goes last'
call POST "/projects/$PROJECT_ID/phases" 400 '{"name":"Back to front","planned_start":"2027-09-10","planned_end":"2027-09-01"}'

echo "  archive, duplicate, delete and recover"
call POST "/projects/$RENO_ID/archive" 200 '{"archived":true}'; check 'd.data.archived_at!==null' 'archived'
call PATCH "/projects/$RENO_ID" 409 '{"expected_version":2,"name":"Nope"}'; check 'd.error.code==="PROJECT_ARCHIVED"' 'an archived project is read-only'
call GET "/projects?status=archived" 200; check 'd.data.some(p=>p.id==="'"$RENO_ID"'")' 'listed under archived'
call POST "/projects/$RENO_ID/archive" 200 '{"archived":false}'; check 'd.data.archived_at===null' 'unarchived'
call POST "/projects/$PROJECT_ID/duplicate" 201 '{"name":"Willow House (copy)","currency":"GBP"}'; DUP_ID="$(js 'd.data.id')"
check 'd.data.currency==="GBP"&&d.data.currency_locked===false&&d.data.summary.paid_minor==="0"' 'duplicate into a new currency carries no money'
call GET "/projects/$DUP_ID/categories" 200; check 'd.data.find(c=>c.code==="LAND").inclusion==="excluded"' 'the copy keeps the scope checklist'
call DELETE "/projects/$DUP_ID" 403 '{"expected_version":1}'; check 'd.error.code==="REAUTH_REQUIRED"' 'deleting needs a fresh confirmation'
call POST /auth/reauth 200 "{\"password\":\"$PASSWORD\"}"; ACTION="$(js 'd.data.action_token')"
call DELETE "/projects/$DUP_ID" 200 "{\"expected_version\":1,\"action_token\":\"$ACTION\"}"; check 'd.data.purge_after>d.data.deleted_at' 'deleted with a 7-day recovery window'
call GET "/projects/$DUP_ID" 404
call GET "/projects?status=deleted" 200; check 'd.data.some(p=>p.id==="'"$DUP_ID"'")' 'listed as recoverable'
call POST "/projects/$DUP_ID/restore" 200; check 'd.data.deleted_at===null' 'recovered within 7 days'
TOKEN="$OUTSIDER_TOKEN"
call POST "/projects/$DUP_ID/restore" 404
TOKEN="$OWNER_TOKEN"

echo "  limits"
for n in 1 2; do call POST /projects 201 "{\"name\":\"Limit $n\",\"type\":\"extension\",\"country_code\":\"IE\",\"currency\":\"EUR\",\"unit_system\":\"metric\",\"storeys\":1}"; done
LAST_ID="$(js 'd.data.id')"
call POST /projects 409 '{"name":"Sixth","type":"extension","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":1}'; check 'd.error.code==="LIMIT_REACHED"' 'the sixth active project is refused'
call POST "/projects/$LAST_ID/archive" 200 '{"archived":true}'
call POST /projects 201 '{"name":"Fits again","type":"extension","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":1}'; SPARE_ID="$(js 'd.data.id')"
check 'true' 'archived projects do not count toward the limit'
call POST "/projects/$LAST_ID/archive" 409 '{"archived":false}'; check 'd.error.code==="LIMIT_REACHED"' 'unarchiving respects the limit'
call POST /auth/reauth 200 "{\"password\":\"$PASSWORD\"}"; ACTION="$(js 'd.data.action_token')"
call DELETE "/projects/$SPARE_ID" 200 "{\"expected_version\":1,\"action_token\":\"$ACTION\"}"
call GET "/projects/$PROJECT_ID/activity" 200; check 'd.data.some(a=>a.action==="project.create")&&d.data.some(a=>a.action==="categories.update")' 'project actions are audited'
