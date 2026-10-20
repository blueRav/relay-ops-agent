# Relay Ops Agent

[![CI](https://github.com/blueRav/relay-ops-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/blueRav/relay-ops-agent/actions/workflows/ci.yml)

Investigate an incident, propose a rollback, pause for approval, and verify recovery.

A runnable portfolio prototype by Antoine Morales. JavaScript ESM, Node.js 22+, no third-party runtime dependencies. All included data and effects are synthetic.

## What it demonstrates

**Planning, tool orchestration, approval checkpoints, state revalidation.**

The default scenario is a synthetic transcript API incident: investigate a connection-pool failure, compare v12 with v11, consult a runbook, request rollback approval, and read metrics again. No AWS resource is accessed or modified.

## Run locally

```bash
git clone https://github.com/blueRav/relay-ops-agent.git
cd relay-ops-agent
npm ci --ignore-scripts
npm test
npm run demo
# Review the pending rollback, then explicitly approve it:
node src/cli.mjs --resume --approve --reviewer Antoine
```

The default demo is deterministic and uses no API key. It writes the world and agent checkpoint to `.state/run.json`. Starting without `--resume` begins a new run; meeting sessions reuse memory when `--session` is supplied.

## Optional live model

Copy `.env.example` to `.env`, then set your own `OPENAI_API_KEY` and `OPENAI_MODEL`. The model must support Responses API function tools. Run `npm run live`. This makes billable model calls; all domain tools still operate on the same synthetic data.

Live runs can also pause for approval. Review the saved pending action, then use `node src/cli.mjs --resume --approve --reviewer YOUR_NAME`. The checkpoint remembers the live mode.

Offline CI mocks the provider; it does not validate a live model's quality or availability.

## Behavioral controls

- The rollback accepts only the current service, expected deployed version, previous version, and known runbook.
- The guard runs again after approval; a new deployment invalidates the pending change.
- A write receipt prevents duplicate effects within the persisted run.
- Completion requires an applied synthetic rollback and verified healthy state.

## Architecture

```mermaid
flowchart TD
  Goal["Goal and observations"] --> Planner["Planner"]
  Planner --> Runtime["Validated runtime"]
  Runtime -->|read| Tools["Domain tools"]
  Runtime -->|reviewed write| Approval["Human approval"]
  Approval --> Tools
  Tools --> State["World and checkpoint"]
  State --> Goal
```

See [runtime design](docs/runtime.md) for the execution boundary and [development notes](docs/development.md) for the workflow. [Sample trace](examples/sample-run.json) shows the actual deterministic run, including tool results and terminal state.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/project.mjs` | Domain tools, fixtures, and observation-driven planner |
| `src/agent.mjs` | Bounded loop, schema validation, approval gates, receipts |
| `src/provider.mjs` | Optional Responses API planner |
| `src/cli.mjs` | Local demo and checkpoint persistence |
| `test/` | Runtime, domain, and subprocess tests |
| `examples/sample-run.json` | Reproducible offline result |

## Scope and limitations

A cloud adapter is deliberately absent. A production version would need IAM scoping, real metric freshness checks, signed server-side checkpoints, durable idempotency, authenticated reviewers, and a rollback strategy tested against the actual service.

Local checkpoint files are trusted inputs. Reviewer names are labels, not authentication. The token ceiling is checked after a model response and is not a strict spend cap. See [runtime design](docs/runtime.md) before attaching external systems.

## Related portfolio projects

- [Evidence Trail Agent](https://github.com/blueRav/evidence-trail-agent) — Retrieve sources, read evidence, and submit a brief with verifiable extractive citations.
- [Minute Keeper Agent](https://github.com/blueRav/minute-keeper-agent) — Turn explicit meeting commitments into persistent, reviewable task memory.
- [Dataset Scout Agent](https://github.com/blueRav/dataset-scout-agent) — Plan a small regression experiment while enforcing leakage and holdout boundaries.
- [Agent Gauntlet](https://github.com/blueRav/agent-gauntlet) — Evaluate task completion and safety separately with synthetic adversarial cases and runtime probes.

## License

MIT. Developed with AI assistance; all behavior is open to inspection in the source and tests.
