# Runtime design

The runtime is deliberately small enough to inspect. Each repository includes its own copy so it can be cloned and run independently; the copies are identical rather than hidden dependencies.

A planner receives a goal, tool specifications, and observations. It returns one tool request or a final answer. The runtime validates arguments against the declared schema, applies a domain guard, executes the named capability, and records the observation. Unknown names never become arbitrary code or shell commands.

The offline planner is a deterministic, observation-driven fixture controller. It makes the examples reproducible without credentials or model cost. It is not an LLM. Optional live mode uses the Responses API and the same actual tools and runtime boundaries.

## Approval and state

An approval-required tool pauses before execution. The pending record contains a run id, step, tool name, and exact arguments. The caller supplies an approval with the same record plus a reviewer. Altered approvals fail. Domain guards run again at execution time to detect stale state.

Successful writes produce per-run receipts keyed by the canonical tool name and arguments. Repeated identical writes reuse the receipt. A checkpoint stores observations, trace, budgets, receipts, and any pending action. The CLI stores the domain world beside it, uses an atomic rename, and keeps the state directory out of Git.

These are local prototype controls. A reviewer label is not authentication. Checkpoints are trusted local input, not signed documents. Tampering with both a checkpoint and its approval is outside the threat model. Receipts are not an exactly-once transaction across process crashes; a production adapter needs a durable idempotency key and transactional effects. Concurrent writers to the same checkpoint are unsupported.

## Budgets and failures

Step, tool-call, and reported-token ceilings bound agent activity. Invalid tool calls become observations so a planner can recover. Model errors stop the run; domain validators reject unsupported completion claims.

The reported-token ceiling is checked after each API response. A request can consume more tokens than the remaining budget because input tokens are included in provider usage; no subsequent tool runs after an overrun. It is not a strict dollar-spending limit. Each model request has a 30-second timeout. The runtime does not retry writes automatically.

## Model contract

Live mode sends a fresh Responses request containing the current observations, typed function tools, parallel_tool_calls=false, and store=false. It accepts one function call or text. This approach avoids depending on hidden conversation state; it does not preserve a provider's private reasoning across calls.

The adapter rejects missing usage, malformed arguments, multiple tool calls, and incomplete responses. A configured model must support the supplied tool schema. API keys come only from environment variables; they are not stored in checkpoints.

References: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [Node.js test runner](https://nodejs.org/api/test.html).

## What to inspect

- src/agent.mjs: schema checks, bounded loop, approval binding, receipts, and trace.
- src/project.mjs: domain tools, deterministic planner, and completion validator.
- src/provider.mjs: optional live model adapter.
- test/runtime.test.mjs: shared boundary tests.
- test/project.test.mjs: domain-specific invariants.
- test/cli.test.mjs: actual subprocess and persistence checks.
