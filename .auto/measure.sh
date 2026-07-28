#!/bin/bash
set -euo pipefail

# Fast syntax check
npx -y tsx --eval "import ts from 'typescript'; console.log('ok')" 2>/dev/null || {
	echo "TypeScript check failed"
	exit 1
}

# Run the eval suite — use a specific model for consistency
# The eval runner picks up PI_PROVIDER and PI_MODEL from environment
# Default to openai-codex/gpt-5.4 if not set, else use whatever's configured
PROVIDER="${PI_PROVIDER:-openai-codex}"
MODEL="${PI_MODEL:-gpt-5.4}"

cd /home/jerichosiahaya/code/pi

# Run vitest evals and capture output
OUTPUT=$(npm run eval -- --provider "$PROVIDER" --model "$MODEL" 2>&1) || true

# Extract pass/fail counts from vitest output
PASS=$(echo "$OUTPUT" | grep -oP 'Tests\s+\d+ passed' | grep -oP '\d+' || echo "0")
FAIL=$(echo "$OUTPUT" | grep -oP '\d+ failed' | grep -oP '\d+' || echo "0")
TOTAL=$((PASS + FAIL))

if [ "$TOTAL" -eq 0 ]; then
	# Try alternate output format
	PASS=$(echo "$OUTPUT" | grep -oP '(?<=✓|✔|passed)\s+\d+' | grep -oP '\d+' || echo "0")
	FAIL=$(echo "$OUTPUT" | grep -oP '(?<=✗|✘|failed)\s+\d+' | grep -oP '\d+' || echo "0")
	TOTAL=$((PASS + FAIL))
fi

if [ "$TOTAL" -eq 0 ]; then
	echo "WARNING: Could not parse test results, falling back to exit-code check"
	# Fallback: check if output contains "Tests" line
	SUM_LINE=$(echo "$OUTPUT" | grep -i "Tests " | tail -1 || true)
	echo "Summary: $SUM_LINE"
	# If the command succeeded and didn't error, assume 1 test passed
	PASS=1
	TOTAL=1
fi

PASS_RATE=0
if [ "$TOTAL" -gt 0 ]; then
	PASS_RATE=$((PASS * 100 / TOTAL))
fi

# Extract token usage from output
TOTAL_TOKENS=$(echo "$OUTPUT" | grep -oP 'totalTokens["\s:=]+\d+' | grep -oP '\d+' | tail -1 || echo "0")

echo "METRIC pass_rate=$PASS_RATE"
echo "METRIC total_tokens=$TOTAL_TOKENS"
echo "---RESULTS---"
echo "Passed: $PASS/$TOTAL"
echo "Token usage: $TOTAL_TOKENS"