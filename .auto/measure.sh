#!/bin/bash
set -uo pipefail

# Respect env vars, with defaults for eval model
PROVIDER="${PI_PROVIDER:-litellm}"
MODEL="${PI_MODEL:-azure_ai/gpt-5.4-mini}"

cd /home/jerichosiahaya/code/pi

# Pre-checks: verify TS compiles
if ! npx tsx --eval "import ts from 'typescript'; console.log('ok')" 2>/dev/null; then
	echo "TypeScript check failed"
	exit 1
fi

# Run the eval suite with NO_COLOR to strip ANSI codes
OUTPUT=""
if OUTPUT=$(NO_COLOR=1 npm run eval -- --provider "$PROVIDER" --model "$MODEL" 2>&1); then
	:
fi

# Parse test results from the summary line: "Tests  15 passed (15)"
PASS=""
FAIL=""
while IFS= read -r line; do
	case "$line" in
		*Tests*passed*)
			# Extract the number before "passed"
			PASS=$(echo "$line" | grep -oP '\d+(?=\s+passed)' | tail -1)
			# Extract the number before "failed" (if any)
			FAIL=$(echo "$line" | grep -oP '\d+(?=\s+failed)' | tail -1)
			;;
	esac
done <<< "$OUTPUT"

PASS="${PASS:-0}"
FAIL="${FAIL:-0}"

TOTAL=$((PASS + FAIL))

PASS_RATE=0
if [ "$TOTAL" -gt 0 ]; then
	PASS_RATE=$((PASS * 100 / TOTAL))
fi

# Extract total token usage: sum all "[NNN tok]" entries
TOTAL_TOKENS=0
for tok in $(echo "$OUTPUT" | grep -oP '\d+(?=\s*tok\])' || true); do
	TOTAL_TOKENS=$((TOTAL_TOKENS + tok))
done

echo "METRIC pass_rate=$PASS_RATE"
echo "METRIC total_tokens=$TOTAL_TOKENS"
echo "---RESULTS---"
echo "Passed: $PASS/$TOTAL"
echo "Token usage: $TOTAL_TOKENS"