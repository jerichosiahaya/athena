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

# Parse vitest summary line: "Tests  15 passed (15)" or "Tests  1 failed | 14 passed (15)"
PASS=$(echo "$OUTPUT" | grep -oP 'Tests\s+\K\d+(?=\s+passed)' | tail -1) || true
FAIL=$(echo "$OUTPUT" | grep -oP '\K\d+(?=\s+failed)' | tail -1) || true

if [ -z "$PASS" ]; then PASS=0; fi
if [ -z "$FAIL" ]; then FAIL=0; fi

TOTAL=$((PASS + FAIL))

PASS_RATE=0
if [ "$TOTAL" -gt 0 ]; then
	PASS_RATE=$((PASS * 100 / TOTAL))
fi

# Extract total token usage: sum all "[NNN tok]" entries
TOKENS=$(echo "$OUTPUT" | grep -oP '\d+(?=\s*tok\])' || true)
TOTAL_TOKENS=0
for t in $TOKENS; do
	TOTAL_TOKENS=$((TOTAL_TOKENS + t))
done

echo "METRIC pass_rate=$PASS_RATE"
echo "METRIC total_tokens=$TOTAL_TOKENS"
echo "---RESULTS---"
echo "Passed: $PASS/$TOTAL"
echo "Token usage: $TOTAL_TOKENS"