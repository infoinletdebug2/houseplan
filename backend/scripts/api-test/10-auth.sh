# Identity, email verification, the caller, consents, support (CONTRACT §2).
TOKEN=""
call GET /auth/social/providers 200; check 'd.data.some(p=>p.provider==="apple")&&d.data.some(p=>p.provider==="google")' 'Apple and Google both offered'
call POST /auth/login 401 "{\"email\":\"nobody${STAMP}@houseplan.test\",\"password\":\"wrong-password-123\"}"; check 'd.error.code==="AUTH_INVALID_CREDENTIALS"' 'wrong password is 401 in our envelope'
call POST /auth/register 400 "{\"display_name\":\"X\",\"email\":\"x${STAMP}@houseplan.test\",\"password\":\"elevenchars\",\"accept_terms\":true}"; check 'd.error.field_errors[0].field==="password"' 'passwords need 12+ characters'
call POST /auth/register 400 "{\"display_name\":\"X\",\"email\":\"x${STAMP}@houseplan.test\",\"password\":\"long-enough-password\"}"; check 'd.error.field_errors[0].field==="accept_terms"' 'Terms tick required (TERMS_REQUIRED)'
call POST /auth/register 400 "{\"email\":\"x${STAMP}@houseplan.test\",\"password\":\"long-enough-password\",\"accept_terms\":true}"; check 'd.error.field_errors[0].field==="display_name"' 'create account asks for a name'
call POST /auth/register 409 "{\"display_name\":\"Dup\",\"email\":\"$OWNER_EMAIL\",\"password\":\"long-enough-password\",\"accept_terms\":true}"; check 'd.error.code==="AUTH_EMAIL_TAKEN"' 'duplicate email is 409'
call POST /auth/password/reset-request 200 "{\"email\":\"nobody${STAMP}@houseplan.test\"}"; check 'd.data.sent===true' 'reset request answers the same for unknown emails'
call POST /auth/password/reset-confirm 400 "{\"email\":\"$OUTSIDER_EMAIL\",\"code\":\"000000\",\"new_password\":\"api-test-Changed-34\"}"; check 'd.error.code==="AUTH_INVALID_CODE"' 'wrong reset code is 400, never 5xx'
call GET /me 401

echo "  email verification (required for email accounts)"
TOKEN="$UNPAID_TOKEN"
call GET /me 200; check 'd.data.needs_verification===true&&d.data.user.email_verified===false' 'a new email account needs verification'
check 'd.data.terms.needs_acceptance===false' 'the Terms tick on register was recorded'
check 'd.data.entitlement.access===false&&d.data.entitlement.status==="none"' 'no plan: locked (hard paywall)'
call POST /auth/email/verify 400 '{"code":"000000"}'; check 'd.error.code==="AUTH_INVALID_CODE"' 'a wrong code is refused'
call POST /auth/email/send-code 200; check 'd.data.sent===true' 'a new code can be sent'
call GET /projects 403; check 'd.error.code==="EMAIL_NOT_VERIFIED"' 'AC01 product routes refuse an unverified account'

echo "  sessions"
TOKEN=""
call POST /auth/login 200 "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$PASSWORD\"}"; REFRESH="$(js 'd.data.refresh_token')"
check 'd.data.needs_verification===false' 'the verified owner does not need verification'
call POST /auth/refresh 200 "{\"refresh_token\":\"$REFRESH\"}"; check 'd.data.access_token.length>20' 'refresh rotates the session'
call POST /auth/refresh 401 '{"refresh_token":"not-a-real-token"}'

echo "  the caller"
TOKEN="$OWNER_TOKEN"
call GET /me 200; check 'd.data.user.display_name==="Maya Owner"' 'the name from sign-up is kept'
check 'd.data.preferences.default_currency==="USD"' 'USD is the default currency'
check 'd.data.entitlement.access===true' 'the review grant gives access'
call PATCH /me 200 '{"unit_system":"imperial","country_code":"US","timezone":"America/New_York"}'; check 'd.data.preferences.unit_system==="imperial"&&d.data.preferences.country_code==="US"' 'preferences save'
call PATCH /me 400 '{"is_admin":true}'; check 'd.error.code==="VALIDATION_ERROR"' 'unknown fields are refused (no escalation fields)'
call PATCH /me 400 '{"timezone":"Mars/Olympus"}'
call PATCH /me 200 '{"unit_system":"metric","country_code":"IE","timezone":"Europe/Dublin","default_currency":"EUR"}'
call PUT /me/onboarding 409 '{"expected_version":99,"build_type":"new_build"}'; check 'd.error.code==="VERSION_CONFLICT"' 'onboarding is version-checked'
call PUT /me/onboarding 200 '{"expected_version":1,"build_type":"new_build","priorities":["know_total","control_spending"],"role_hint":"homeowner","step":"priorities"}'
check 'd.data.build_type==="new_build"&&d.data.priorities.length===2' 'tap-only answers save'
call PUT /me/onboarding 200 '{"expected_version":2,"complete":true}'; check 'Boolean(d.data.completed_at)' 'onboarding completes'
call PUT /me/onboarding 400 '{"expected_version":3,"priorities":["become_rich"]}'
call POST /me/terms 409 '{"accept_terms":true,"version":"1999-01-01"}'; check 'd.error.code==="TERMS_OUTDATED"' 'a stale Terms version is 409'
call POST /me/terms 400 '{"version":"x"}'
call POST /me/paywall-seen 200; check 'd.data.paywall_seen_at.length>0' 'paywall marked seen'

echo "  consents"
call GET /me/consents 200; check 'd.data.ai_processing===null' 'AI consent starts empty (off)'
call POST /me/consents 200 '{"purpose":"ai_processing","granted":true}'; check 'd.data.granted===true' 'AI opt-in recorded'
call GET /me/consents 200; check 'd.data.ai_processing.granted===true' 'latest AI consent is on'
call POST /me/consents 400 '{"purpose":"selling_data","granted":true}'
call POST /me/review-prompts 200 '{"installation_id":"inst-1","app_version":"1.0.0","trigger":"export"}'; check 'd.data.recorded===true' 'review attempt recorded'
call POST /me/review-prompts 200 '{"installation_id":"inst-1","app_version":"1.0.1","trigger":"export"}'; check 'd.data.recorded===false' 'AC28 120-day cooldown holds across versions'

echo "  notifications and support"
call GET /notification-preferences 200; check 'd.data.length===6&&d.data.every(p=>p.push===false)' 'six categories, push off until enabled'
call PUT /notification-preferences 200 '{"category":"quotes","push":true}'; check 'd.data.push===true' 'a category can be enabled'
call GET /notifications 200
call GET /notifications/unread-count 200
call POST /support 201 '{"topic":"question","subject":"How do I add a room?","message":"Testing support","consent_diagnostics":false}'
call GET /support 200; check 'd.data.length>=1' 'my support requests are listed'
TOKEN=""
call POST /support 201 "{\"topic\":\"account\",\"subject\":\"Signed out\",\"message\":\"Testing\",\"email\":\"someone${STAMP}@houseplan.test\"}"
call POST /support 400 '{"topic":"account","subject":"No email","message":"Testing"}'

echo "  re-authentication"
TOKEN="$OUTSIDER_TOKEN"
call POST /auth/reauth 400 '{"password":"wrong-password-123"}'; check 'd.error.code==="INVALID_PASSWORD"' 'wrong password is 400, not 401'
call POST /auth/reauth 200 "{\"password\":\"$PASSWORD\"}"; check 'd.data.action_token.length>20' 'a 5-minute action token'
call POST /auth/password/change 400 "{\"current_password\":\"wrong-password-123\",\"new_password\":\"api-test-Changed-34\"}"; check 'd.error.code==="INVALID_PASSWORD"' 'change: wrong current password is 400'
TOKEN="$OWNER_TOKEN"
