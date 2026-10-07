#!/usr/bin/env bash
# HousePlan API test: every route, with curl, against a running worker.
#
#   npm run dev                                   # .dev.vars holds a real Xenition key
#   API=http://localhost:8797 bash scripts/api-test.sh
#   API=https://houseplan.xenition.com bash scripts/api-test.sh
#   ONLY=20-projects bash scripts/api-test.sh     # one section (plus setup)
#
# Sections live in scripts/api-test/NN-name.sh and run in order. Throwaway
# accounts delete themselves on exit. BRD acceptance tests are tagged ACxx.
# Needs curl and node. Tokens never leave this process.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/api-test/common.sh"
for f in "$DIR"/api-test/[0-9][0-9]-*.sh; do
  name="$(basename "$f" .sh)"
  if [ -n "${ONLY:-}" ] && [ "$name" != "00-setup" ] && [[ ",$ONLY," != *",$name,"* ]]; then continue; fi
  echo; echo "── $name"
  source "$f"
done
summary
