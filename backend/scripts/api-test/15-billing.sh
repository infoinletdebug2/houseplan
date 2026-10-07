# Subscription lifecycle outside the paywall (CONTRACT §3, BRD §5.3).
TOKEN="$UNPAID_TOKEN"
call GET /billing/status 200; check 'd.data.status==="none"&&d.data.access===false&&d.data.lease===null' 'AC01 unpaid: locked, no offline lease'
check 'd.data.products.monthly==="houseplan.pro.monthly"' 'product ids'
call POST /billing/reconcile 200 '{"reason":"login"}'; check 'd.data.access===false' 'login reconcile keeps an unpaid account locked'
call POST /billing/reconcile 503,400 '{"reason":"purchase","platform":"apple","transaction_id":"2000000999999999"}'; check '["STORE_UNCONFIGURED","VALIDATION_ERROR"].includes(d.error.code)' 'AC03 a purchase claim without server verification never unlocks'
call GET /billing/status 200; check 'd.data.access===false' 'still locked after an unverifiable purchase'
call POST /billing/reconcile 503,400 '{"reason":"restore","platform":"google","purchases":[{"product_id":"houseplan.pro.annual","purchase_token":"forged-token"}]}'
call POST /billing/reconcile 400 '{"reason":"purchase","platform":"amazon"}'
call POST /billing/reconcile 400 '{"reason":"purchase","platform":"apple","is_paid":true}'; check 'd.error.code==="VALIDATION_ERROR"' 'a client cannot claim it is paid'
call POST /billing/trial 409; check 'd.error.code==="TRIAL_UNAVAILABLE"' 'AC02 no trial eligibility'
TOKEN="$OWNER_TOKEN"
call GET /billing/status 200; check 'd.data.access===true&&d.data.source==="grant"' 'review grant gives access'
check 'd.data.lease&&d.data.lease.token.split(".").length===2' 'a paid device gets a signed offline lease'
check 'Date.parse(d.data.lease.expires_at)-Date.now()<=24*3600e3+5000' 'AC26 the lease lasts at most 24 hours'
call GET '/billing/status?fresh=1' 200; check 'Boolean(d.data.verified_at)' 'fresh status is re-verified'
