# Cognitive Architecture Ideas

## Deferred / Future

### Tool-Using Evals
- Create a separate eval harness that TOOLS ENABLED (no `noTools: "all"`)
- Test real code editing scenarios: fix bugs, write functions, refactor code
- This would provide much better signal for cognitive architecture quality

### Agent Loop Improvements
- **prepareNextTurn callback**: Investigate swapping system prompt or tools between turns based on task complexity
- **Auto-plan phase**: For complex multi-step tasks, insert an explicit planning step before execution
- **Structured output patterns**: Guide the model toward structured thinking for complex tasks

### Retry & Error Recovery
- Smarter retry when tool calls fail: the current retry only handles transient API errors
- Tool call validation: detect common failure patterns (e.g., edit with wrong oldText) and provide better error context

### Context Window Awareness
- Expose current context utilization to the model so it can make informed decisions about conciseness
- Add token budget tracking for long sessions

### Skill Integration
- Make skills more proactive - auto-load relevant skills based on user intent
- Tool-use skill: a skill that teaches the model optimal tool-use patterns

### System Prompt Personalization
- Allow per-user custom guidelines that persist across sessions
- Learning from user feedback embedded in system prompt