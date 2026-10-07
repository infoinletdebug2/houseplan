# The website (CONTRACT §15): every page answers 200 with words only the working page has.
site_has() { # site_has PATH "words" "label"
  local s; s="$(curl -sL -o "$OUT" -w '%{http_code}' "$ROOT$1")"
  if [ "$s" = 200 ] && grep -q "$2" "$OUT"; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m GET    %-40s 200  %s\n' "$1" "$3"
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m GET    %-40s %s  missing: %s\n' "$1" "$s" "$2"; fi
}
site_has / 'Know what your house will really cost' 'landing'
site_has / 'No free trial' 'landing is honest about the paywall'
site_has / 'not a local price' 'sample figures are labelled'
site_has /privacy 'Who processes your data' 'privacy policy'
site_has /privacy 'Draft pending review' 'privacy marked as a draft'
site_has /privacy 'how agreement is recorded\|How agreement is recorded' 'privacy says how agreement is recorded'
site_has /terms 'There is no free trial' 'terms: no trial'
site_has /terms 'renew automatically' 'terms: auto-renewal'
site_has /support 'Send request' 'support form'
site_has /delete-account 'does not cancel your subscription' 'deletion page warns about store billing'
site_has /admin 'Operator console' 'operator console'
site_has /.well-known/apple-app-site-association 'com.xenition.houseplan' 'Apple app links'
site_has /.well-known/assetlinks.json 'com.xenition.houseplan' 'Android app links'
if grep -qiE 'stars|rated [0-9]|[0-9,]+ (users|downloads|homeowners)' <(curl -sL "$ROOT/"); then FAIL=$((FAIL+1)); echo "  ✗ landing claims ratings or user counts"; else PASS=$((PASS+1)); echo "  ✓ landing has no invented ratings or user counts"; fi
