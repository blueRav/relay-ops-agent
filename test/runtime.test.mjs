import test from "node:test";
import assert from "node:assert/strict";
import { Agent, approve, objectSchema, str, validate } from "../src/agent.mjs";
import { openAIPlanner } from "../src/provider.mjs";
const make = (planner, extra = {}) => {
  const world = { writes: 0, allowed: true };
  const tools = {
    read: { description: "Read", parameters: objectSchema({}), execute: () => ({ ok: true }) },
    write: {
      description: "Write", parameters: objectSchema({ value: str() }), write: true, approvalRequired: true,
      guard: () => { if (!world.allowed) throw Error("State changed"); },
      execute: args => { world.writes++; return { saved: args.value }; }
    }
  };
  return { world, agent: new Agent({ planner, tools, ...extra }) };
};
const writeThenFinish = async ({ observations }) => observations.length
  ? { type: "final", text: "done" }
  : { type: "tool", name: "write", args: { value: "a" } };

test("schema rejects unknown fields and non-string values", () => {
  const schema = objectSchema({ value: str() });
  assert.throws(() => validate(schema, { value: 1 }), /string/);
  assert.throws(() => validate(schema, { value: "a", extra: true }), /unexpected/);
  assert.throws(() => validate(schema, {}), /required/);
});
test("writes pause without changing state", async () => {
  const { agent, world } = make(writeThenFinish);
  const state = await agent.run({ goal: "save" });
  assert.equal(state.status, "awaiting_approval"); assert.equal(world.writes, 0);
});
test("matching approval resumes the exact action", async () => {
  const { agent, world } = make(writeThenFinish);
  let state = await agent.run({ goal: "save" });
  state = await agent.run({ goal: "save", state, approval: approve(state.pending, "reviewer") });
  assert.equal(state.status, "complete"); assert.equal(world.writes, 1);
});
test("approval for altered arguments is rejected", async () => {
  const { agent, world } = make(writeThenFinish);
  const state = await agent.run({ goal: "save" });
  const approval = approve(state.pending, "reviewer"); approval.args.value = "changed";
  await assert.rejects(() => agent.run({ goal: "save", state, approval }), /match/);
  assert.equal(world.writes, 0);
});
test("approval is bound to a run and pending id", async () => {
  const { agent } = make(writeThenFinish);
  const state = await agent.run({ goal: "save", runId: "first" });
  const approval = approve(state.pending, "reviewer"); approval.id = "another-run";
  await assert.rejects(() => agent.run({ goal: "save", state, approval }), /match/);
});
test("guard is rechecked after approval", async () => {
  const { agent, world } = make(writeThenFinish);
  const state = await agent.run({ goal: "save" }); world.allowed = false;
  const next = await agent.run({ goal: "save", state, approval: approve(state.pending, "reviewer") });
  assert.equal(world.writes, 0); assert.ok(next.trace.some(event => event.event === "tool_error"));
});
test("duplicate approved writes reuse a receipt", async () => {
  const { agent, world } = make(async ({ observations }) => observations.length < 2
    ? { type: "tool", name: "write", args: { value: "same" } } : { type: "final", text: "done" });
  let state = await agent.run({ goal: "save" });
  state = await agent.run({ goal: "save", state, approval: approve(state.pending, "reviewer") });
  assert.equal(state.status, "complete"); assert.equal(world.writes, 1);
  assert.ok(state.trace.some(event => event.event === "receipt_reused"));
});
test("unknown tools never execute and consume bounded steps", async () => {
  const { agent, world } = make(async () => ({ type: "tool", name: "shell", args: {} }), { maxSteps: 3 });
  const state = await agent.run({ goal: "probe" });
  assert.equal(state.status, "budget_exceeded"); assert.equal(state.steps, 3); assert.equal(world.writes, 0);
});
test("invalid tool arguments never reach execution", async () => {
  const { agent, world } = make(async () => ({ type: "tool", name: "write", args: { value: 12 } }), { maxSteps: 2 });
  const state = await agent.run({ goal: "probe" });
  assert.equal(state.pending, null); assert.equal(world.writes, 0);
  assert.ok(state.observations.every(observation => !observation.ok));
});
test("token overrun stops before a write", async () => {
  const { agent, world } = make(async () => ({ type: "tool", name: "write", args: { value: "a" }, tokens: 101 }), { maxTokens: 100 });
  const state = await agent.run({ goal: "save" });
  assert.equal(state.status, "budget_exceeded"); assert.equal(world.writes, 0);
});
test("domain validation rejects an unsupported success claim", async () => {
  const { agent } = make(async () => ({ type: "final", text: "done" }), { validateFinal: () => { throw Error("Evidence required"); } });
  const state = await agent.run({ goal: "save" });
  assert.equal(state.status, "failed"); assert.ok(state.trace.some(event => event.event === "final_rejected"));
});
test("a mismatched checkpoint goal is rejected", async () => {
  const { agent } = make(writeThenFinish);
  const state = await agent.run({ goal: "save" });
  await assert.rejects(() => agent.run({ goal: "different", state }), /Checkpoint/);
});
test("provider uses Responses API and passes typed tool calls", async () => {
  let sent;
  const planner = openAIPlanner({ apiKey: "test-only", model: "configured-model", fetchImpl: async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ output: [{ type: "function_call", name: "read", arguments: "{}" }], usage: { total_tokens: 20 } }) };
  } });
  const decision = await planner({ goal: "read", instructions: "", observations: [], remainingTokens: 100, tools: [
    { name: "read", description: "read", parameters: objectSchema({}) }
  ] });
  assert.equal(sent.url, "https://api.openai.com/v1/responses"); assert.equal(sent.body.store, false);
  assert.equal(sent.body.parallel_tool_calls, false); assert.equal(sent.body.tools[0].strict, true);
  assert.equal(decision.name, "read"); assert.equal(decision.tokens, 20);
});
test("provider fails closed on incomplete responses", async () => {
  const planner = openAIPlanner({ apiKey: "test-only", model: "configured-model", fetchImpl: async () => ({
    ok: true, json: async () => ({ status: "incomplete", output: [], usage: { total_tokens: 20 } })
  }) });
  await assert.rejects(() => planner({ goal: "read", instructions: "", observations: [], remainingTokens: 100, tools: [] }), /incomplete/);
});
test("provider requires explicit credentials and model", () => {
  assert.throws(() => openAIPlanner({ model: "configured-model" }), /OPENAI_API_KEY/);
});
