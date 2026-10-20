import test from "node:test";
import assert from "node:assert/strict";
import { approve } from "../src/agent.mjs";
import { createProject, fixture } from "../src/project.mjs";
test("orchestrator delegates diagnosis and planning before requesting approval", async () => {
  const p = createProject(); const s = await p.createAgent().run({ goal: p.goal });
  assert.equal(s.status, "awaiting_approval"); assert.equal(p.world.version, "v12");
  assert.deepEqual(Object.keys(p.world.handoffs), ["diagnosis", "recovery_planner"]); assert.equal(p.world.changes.length, 0);
});
test("approved recovery is independently verified by a third specialist", async () => {
  const p = createProject(); let s = await p.createAgent().run({ goal: p.goal });
  s = await p.createAgent().run({ goal: p.goal, state: s, approval: approve(s.pending, "operator") });
  assert.equal(s.status, "complete"); assert.equal(p.world.version, "v11"); assert.equal(p.world.changes.length, 1);
  assert.deepEqual(s.observations.map(o => o.tool), ["delegate_triage", "delegate_recovery_planning", "apply_rollback", "delegate_verification"]);
  assert.equal(p.world.handoffs.verifier.findings.healthy, true);
});
test("specialists have separate traces and minimal tool subsets", async () => {
  const p = createProject(); let s = await p.createAgent().run({ goal: p.goal });
  s = await p.createAgent().run({ goal: p.goal, state: s, approval: approve(s.pending, "operator") });
  assert.deepEqual(p.specialists.capabilities.diagnosis, ["get_metrics", "search_logs"]);
  assert.deepEqual(p.specialists.capabilities.recovery_planner, ["list_deployments", "read_runbook"]);
  assert.deepEqual(p.specialists.capabilities.verifier, ["get_metrics"]);
  for (const handoff of Object.values(p.world.handoffs)) {
    assert.ok(handoff.trace.length > 0); assert.equal(handoff.status, "complete");
    assert.ok(handoff.trace.filter(e => e.event === "tool_requested").every(e => handoff.capabilities.includes(e.name)));
  }
});
test("out-of-scope services are rejected", () => {
  assert.throws(() => createProject().domainTools.get_metrics.execute({ service: "another-service" }), /scope/);
});
test("planning cannot run before diagnosis", () => {
  assert.throws(() => createProject().tools.delegate_recovery_planning.guard({ service: "transcript-api" }), /Diagnosis/);
});
test("verification cannot run before the approved recovery", async () => {
  const p = createProject(); await p.createAgent().run({ goal: p.goal });
  assert.throws(() => p.tools.delegate_verification.guard({ service: "transcript-api" }), /approved recovery/);
});
test("only the specialist's exact proposal can reach approval", async () => {
  const p = createProject(); const s = await p.createAgent().run({ goal: p.goal });
  assert.throws(() => p.tools.apply_rollback.guard({ ...s.pending.args, targetVersion: "v9" }), /exactly/);
});
test("a new deployment invalidates the approved proposal", async () => {
  const p = createProject(); const s = await p.createAgent().run({ goal: p.goal }); p.world.version = "v13";
  const next = await p.createAgent().run({ goal: p.goal, state: s, approval: approve(s.pending, "operator") });
  assert.equal(p.world.changes.length, 0); assert.equal(next.status, "failed");
});
test("already healthy services skip recovery planning and writes", async () => {
  const world = JSON.parse(JSON.stringify(fixture)); world.healthy = true; world.errorRate = 0.002;
  const p = createProject(world); const s = await p.createAgent().run({ goal: p.goal });
  assert.equal(s.status, "complete"); assert.equal(p.world.changes.length, 0);
  assert.deepEqual(Object.keys(p.world.handoffs), ["diagnosis", "verifier"]);
});
test("specialist failure blocks orchestration completion", async () => {
  const p = createProject(); p.world.logs = [];
  const s = await p.createAgent().run({ goal: p.goal });
  assert.equal(s.status, "failed"); assert.equal(p.world.changes.length, 0);
  assert.ok(s.trace.some(e => e.event === "tool_error"));
});
