#!/bin/bash
set -euo pipefail

# Respect env vars, with defaults for eval model
PROVIDER="${PI_PROVIDER:-litellm}"
MODEL="${PI_MODEL:-azure_ai/gpt-5.4-mini}"

cd /home/jerichosiahaya/code/pi

# Pre-checks: verify TS compiles
npx tsx --eval "import ts from 'typescript'; console.log('ok')" 2>/dev/null || {
	echo "TypeScript check failed"
	exit 1
}

# Run the eval suite with NO_COLOR to strip ANSI codes
OUTPUT=$(NO_COLOR=1 npm run eval -- --provider "$PROVIDER" --model "$MODEL" 2>&1) || true

# Parse vitest summary line: "Tests  15 passed (15)"
PASS=$(echo "$OUTPUT" | grep -oP 'Tests\s+\K\d+(?=\s+passed)' | tail -1 || echo "0")
FAIL=$(echo "$OUTPUT" | grep -oP '\K\d+(?=\s+failed)' | tail -1 || echo "0")

TOTAL=$((PASS + FAIL))

PASS_RATE=0
if [ "$TOTAL" -gt 0 ]; then
	PASS_RATE=$((PASS * 100 / TOTAL))
fi

# Extract total token usage: sum all "[NNN tok]" entries
TOTAL_TOKENS=$(echo "$OUTPUT" | grep -oP '\d+(?=\s*tok\])' | perl -ne 'chomp; $sum += $_; END { print $sum }' || echo "0")

echo "METRIC pass_rate=$PASS_RATE"
echo "METRIC total_tokens=$TOTAL_TOKENS"
echo "---RESULTS---"
echo "Passed: $PASS/$TOTAL"
echo "Token usage: $TOTAL_TOKENS"