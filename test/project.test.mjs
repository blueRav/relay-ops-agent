import test from "node:test";
import assert from "node:assert/strict";
import { approve } from "../src/agent.mjs";
import { createProject } from "../src/project.mjs";
test("investigation pauses, then verifies the approved recovery", async () => {
  const p = createProject(); let s = await p.createAgent().run({ goal: p.goal });
  assert.equal(s.status, "awaiting_approval"); assert.equal(p.world.version, "v12");
  s = await p.createAgent().run({ goal: p.goal, state: s, approval: approve(s.pending, "operator") });
  assert.equal(s.status, "complete"); assert.equal(p.world.version, "v11"); assert.equal(p.world.changes.length, 1);
  assert.equal(s.observations.filter(o => o.tool === "get_metrics").length, 2);
});
test("an out-of-scope service is rejected", () => {
  assert.throws(() => createProject().tools.get_metrics.execute({ service: "another-service" }), /scope/);
});
test("a non-runbook rollback target is rejected", () => {
  const p = createProject();
  assert.throws(() => p.tools.apply_rollback.guard({ service: p.world.service, expectedCurrent: "v12", targetVersion: "v9", runbookId: "rb-pool" }), /runbook/);
});
test("a deployment change invalidates the pending rollback", async () => {
  const p = createProject(); const s = await p.createAgent().run({ goal: p.goal });
  p.world.version = "v13";
  const next = await p.createAgent().run({ goal: p.goal, state: s, approval: approve(s.pending, "operator") });
  assert.equal(p.world.changes.length, 0); assert.equal(next.status, "failed");
});
test("success requires an actual verified recovery", () => {
  assert.throws(() => createProject().validateFinal(), /verified/);
});
