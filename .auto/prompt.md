# Autoresearch: Cognitive Architecture Optimization

## Objective
Optimize the cognitive architecture of the pi coding agent — the system prompt structure, reasoning guidance, tool-use patterns, and agent loop behavior — to produce better quality, more reliable responses. The benchmark evaluates the agent's raw reasoning quality through diverse eval cases (factual accuracy, instruction following, multi-step reasoning, conciseness).

## Metrics
- **Primary**: `pass_rate` (%, higher is better) — overall pass rate across all eval cases
- **Secondary**: `total_tokens` (tokens, lower is better) — total token usage (efficiency)

## How to Run
```bash
cd /home/jerichosiahaya/code/pi && bash .auto/measure.sh
```
This runs the eval suite and outputs `METRIC pass_rate=XX total_tokens=YYYY`.

## Files in Scope
- `packages/coding-agent/src/core/system-prompt.ts` — System prompt construction (the model's instruction set)
- `packages/coding-agent/src/core/agent-session.ts` — Session orchestration, compaction, retry logic
- `packages/coding-agent/src/core/messages.ts` — Message formatting
- `packages/coding-agent/src/tools/index.ts` — Tool definitions and their prompt snippets
- `packages/evals/src/general-knowledge.eval.ts` — The eval benchmark (add test cases here)
- `packages/evals/src/pi-harness.ts` — Eval harness

## Off Limits
- Do NOT modify the core agent loop in `packages/agent/src/agent-loop.ts` (low-level loop, high risk)
- Do NOT modify tool implementations in `packages/coding-agent/src/tools/` (only their definitions/index)
- Do NOT add new dependencies
- Do NOT modify TUI/UI code
- Do NOT modify extension system code

## Constraints
- All existing tests must still pass
- System prompt changes must work for all models (Claude, GPT, Gemini, etc.)
- Must not increase latency or token usage significantly (>20% increase in total_tokens is a regression)
- Keep it simple — no complex new abstractions

## What's Been Tried
(Baseline to be established)