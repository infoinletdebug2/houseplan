# Public configuration and legal versions (CONTRACT §1).
TOKEN=""
call GET /bootstrap 200
check 'd.data.categories.length===19&&d.data.categories.some(c=>c.code==="LAND")' 'all 19 budget categories'
check 'd.data.features.trial_days===0' 'BRD 1.3: no free trial configured'
check 'd.data.list_prices.label==="list price"&&d.data.products.yearly==="houseplan.pro.annual"' 'list prices are labelled; product ids match the store'
check 'd.data.limits.active_projects===5&&d.data.limits.ai_requests_per_30_days===30' 'BRD 2.2 limits'
check 'd.data.currencies.some(c=>c.code==="JPY"&&c.minor_digits===0)&&d.data.currencies.some(c=>c.code==="USD")' 'currencies carry their minor digits'
check '!JSON.stringify(d.data).includes("net_unit_price")' 'no prices or private rates in public config'
call GET /legal/terms 200; check 'd.data.version.length===10&&d.data.url.endsWith("/terms")&&d.data.content_hash.length===64' 'terms version, url and hash'
call GET /legal/privacy 200; check 'd.data.type==="privacy"' 'privacy version'
call GET /legal/cookies 400
TOKEN="$OWNER_TOKEN"
