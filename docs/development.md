# Development and verification

These portfolio prototypes were developed with AI assistance. The repository keeps the executable behaviors, guardrails, tests, and limitations visible for review.

## Workflow

1. State the goal and the permitted tools.
2. Implement a deterministic fixture controller and a real tool interface.
3. Add invariants for evidence, scope, memory, approval, and stopping behavior.
4. Add a live planner adapter without changing the enforcement boundary.
5. Run the offline tests and command-line scenario.
6. Inspect the trace before connecting any real external effects.

The tests exercise behavior: effects before and after approval, schema rejection, stale state, duplicate writes, evidence failures, model-response failures, and domain-specific completion. They do not grade a model's explanation of its own behavior.

## Reproducing

Run npm ci --ignore-scripts, npm test, and npm run demo. GitHub Actions runs the same tests on Node.js 22 and 24. Live API behavior requires explicit credentials and a supported model, and is not part of offline CI.

The checked-in example trace was generated with the deterministic planner. Its zero token count is expected. Synthetic metrics in the examples must not be described as measured production results.

## Extension ideas

Replace one synthetic read tool with a scoped real adapter, add adversarial fixtures, compare model configurations on fixed cases, and add authenticated server-side approvals before allowing external write tools. Keep the fixture suite available as a regression baseline.
