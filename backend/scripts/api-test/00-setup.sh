# Accounts every section can use: OWNER and OUTSIDER are paid (operator review grant, email confirmed); UNPAID is unverified with no plan.
echo "API → $API"
s="$(curl -s -o "$OUT" -w '%{http_code}' "$ROOT/health")"; check 'd&&d.ok===true' "health ($s)"
OWNER_EMAIL="apitest+owner${STAMP}@houseplan.test"
OUTSIDER_EMAIL="apitest+outsider${STAMP}@houseplan.test"
UNPAID_EMAIL="apitest+unpaid${STAMP}@houseplan.test"
OWNER_TOKEN="$(paid "$OWNER_EMAIL" "Maya Owner")"; ACCOUNTS+=("$OWNER_TOKEN")
OUTSIDER_TOKEN="$(paid "$OUTSIDER_EMAIL" "Omar Outsider")"; ACCOUNTS+=("$OUTSIDER_TOKEN")
UNPAID_TOKEN="$(register "$UNPAID_EMAIL" "Una Unpaid")"; ACCOUNTS+=("$UNPAID_TOKEN")
if [ -n "$OWNER_TOKEN" ] && [ -n "$OUTSIDER_TOKEN" ] && [ -n "$UNPAID_TOKEN" ]; then PASS=$((PASS+1)); echo "  ✓ three accounts (owner + outsider paid, one unpaid and unverified)"
else FAIL=$((FAIL+1)); echo "  ✗ account setup failed"; summary; exit 1; fi
TOKEN="$OWNER_TOKEN"
