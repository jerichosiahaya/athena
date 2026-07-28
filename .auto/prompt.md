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

### Experiment 1: Baseline
- Initial measurement: 15/15 pass (100%), 6322 tokens
- System prompt as-is, basic tool descriptions

### Experiment 2: System Prompt Reasoning Guidance
- Added guidelines: "plan before acting", "retry with corrected arguments", "prefer small focused edits"
- Added ## Reasoning Approach section with planning, debugging, and task-tracking guidance
- Result: 15/15 pass (100%), 8079 tokens (+28% from larger system prompt)
- No regression in test quality

### Experiment 3: Better Tool Descriptions
- Read: added "use offset/limit for large files"
- Bash: added "set timeout for long-running; explore before guessing"
- Edit: added "read first, then edit"
- Write: added "use edit for partial changes"
- Result: 15/15 pass, 8072 tokens

### Experiment 4: Harder Test Suite
- Added 8 hard reasoning tests (river crossing, bat-ball, letter frequency, planning, logic puzzle, reverse order, word count, causation)
- Result: 22/23 pass (95%), 12499 tokens
- More room for improvement with harder tests

### Experiment 5: Better Compaction Summaries
- Added Files section to compaction summary format
- Added type definition preservation to summarization prompts
- Added file-tracking to turn prefix summaries
- Result: 22/23 pass (95%), 12518 tokens