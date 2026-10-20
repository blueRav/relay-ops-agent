# Incident orchestration

Relay Ops has one coordinator agent and three independently bounded specialist agents. Each specialist has its own planner loop, tool registry, completion validator, and execution trace. A delegation tool returns a structured handoff; the coordinator does not infer success from a specialist's prose.

| Role | Tools | Required evidence |
| --- | --- | --- |
| Diagnosis | get_metrics, search_logs | Current metrics and matching incident logs |
| Recovery planner | list_deployments, read_runbook | Current/previous versions and runbook-backed proposal |
| Verifier | get_metrics | A healthy post-change measurement |

The coordinator can call delegate_triage, delegate_recovery_planning, apply_rollback, and delegate_verification. It has no raw log or deployment tools. Specialists cannot change service state or approve actions.

## Handoffs and routing

1. The diagnosis specialist gathers evidence and returns an incident handoff.
2. If the service is unhealthy, the coordinator delegates recovery planning.
3. The planner returns the exact service, expected current version, target version, and runbook id.
4. The coordinator requests human approval for that exact proposal.
5. After approval, the runtime checks the proposal and current deployment again before applying a synthetic rollback.
6. An independent verifier reads health metrics. The coordinator can finish only with a verified handoff.
7. An already-healthy service skips the planning and rollback branch.

A specialist error, missing evidence, changed deployment, altered proposal, or failed health check prevents successful completion. Handoffs and specialist traces are persisted beside the coordinator checkpoint.

## Budgets and scope

The coordinator uses the common 16-step/14-tool-call/16,000-reported-token defaults. Each specialist is limited to 6 steps, 5 tool calls, and 4,000 reported tokens. Completed specialist handoffs are cached within the synthetic world, so repeated delegation does not rerun their work.

Default specialists are deterministic observation-driven agents. Optional live mode uses a model for the coordinator while retaining deterministic specialists. There are no model calls hidden inside delegation. This keeps reported coordinator usage and offline behavior reproducible. The specialist runner accepts an injected planner factory programmatically for further experiments; callers extending it must account for nested usage themselves.

These constraints demonstrate agent orchestration, not production incident automation. Real adapters would need fresh evidence, cache invalidation, authenticated reviews, durable idempotency, and transactional state.
