// Small, dependency-free agent runtime. Tool results are untrusted data.
export const copy = value => JSON.parse(JSON.stringify(value));
export const objectSchema = properties => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false
});
export const str = (extra = {}) => ({ type: "string", minLength: 1, ...extra });
export const num = (extra = {}) => ({ type: "number", ...extra });
export const canonical = value => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
};
export function validate(schema, value, path = "args") {
  if (schema.enum && !schema.enum.includes(value)) throw Error(path + ": value outside enum");
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(path + ": expected object");
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw Error(path + "." + key + ": required");
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw Error(path + "." + key + ": unexpected property");
      validate(schema.properties[key], value[key], path + "." + key);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) throw Error(path + ": expected array");
    if (schema.minItems !== undefined && value.length < schema.minItems) throw Error(path + ": too few items");
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw Error(path + ": too many items");
    value.forEach((item, i) => validate(schema.items, item, path + "[" + i + "]"));
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw Error(path + ": expected finite number");
    if (schema.type === "integer" && !Number.isInteger(value)) throw Error(path + ": expected integer");
    if (schema.minimum !== undefined && value < schema.minimum) throw Error(path + ": below minimum");
    if (schema.maximum !== undefined && value > schema.maximum) throw Error(path + ": above maximum");
  } else if (schema.type === "string") {
    if (typeof value !== "string") throw Error(path + ": expected string");
    if (schema.minLength !== undefined && value.length < schema.minLength) throw Error(path + ": too short");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw Error(path + ": too long");
  } else if (typeof value !== schema.type) throw Error(path + ": invalid type");
}
export function approve(pending, reviewer) {
  if (!pending || !reviewer?.trim()) throw Error("An exact pending action and reviewer are required");
  return { ...copy(pending), reviewer: reviewer.trim() };
}
export class Agent {
  constructor({ planner, tools, instructions = "", maxSteps = 16, maxToolCalls = 14, maxTokens = 16000, validateFinal = () => {} }) {
    if (typeof planner !== "function") throw Error("planner is required");
    this.planner = planner; this.tools = tools; this.instructions = instructions;
    this.limits = { maxSteps, maxToolCalls, maxTokens }; this.validateFinal = validateFinal;
  }
  async run({ goal, runId = "local-demo", state: saved, approval } = {}) {
    if (!goal?.trim()) throw Error("goal is required");
    const state = saved ? copy(saved) : {
      version: 1, runId, goal, status: "running", steps: 0, toolCalls: 0, tokens: 0,
      observations: [], trace: [], receipts: {}, pending: null
    };
    if (state.version !== 1 || state.goal !== goal) throw Error("Checkpoint does not match this run");
    const emit = (event, data = {}) => state.trace.push({ index: state.trace.length, event, ...copy(data) });
    const execute = async (name, args, reviewer = null) => {
      const tool = Object.hasOwn(this.tools, name) ? this.tools[name] : null;
      if (!tool) throw Error("Unknown tool: " + name);
      validate(tool.parameters, args);
      const key = canonical({ name, args });
      if (tool.write && Object.hasOwn(state.receipts, key)) {
        emit("receipt_reused", { name });
        return copy(state.receipts[key]);
      }
      if (tool.guard) await tool.guard(copy(args));
      const result = await tool.execute(copy(args));
      const encoded = JSON.stringify(result);
      if (encoded === undefined || encoded.length > 48000) throw Error("Tool result is missing or too large");
      if (tool.write) state.receipts[key] = copy(result);
      emit("tool_result", { name, args, result, reviewer });
      return result;
    };
    if (state.pending) {
      if (!approval) return state;
      const { reviewer, ...action } = approval;
      if (!reviewer?.trim() || canonical(action) !== canonical(state.pending)) throw Error("Approval does not match the pending action");
      const pending = state.pending;
      try {
        const result = await execute(pending.tool, pending.args, reviewer);
        state.observations.push({ tool: pending.tool, args: pending.args, ok: true, result });
      } catch (error) {
        state.observations.push({ tool: pending.tool, args: pending.args, ok: false, error: error.message });
        emit("tool_error", { name: pending.tool, error: error.message });
      }
      state.pending = null; state.status = "running";
    } else if (approval) throw Error("There is no pending action to approve");
    if (["complete", "budget_exceeded", "failed"].includes(state.status)) return state;
    while (state.steps < this.limits.maxSteps) {
      if (state.toolCalls >= this.limits.maxToolCalls || state.tokens >= this.limits.maxTokens) {
        state.status = "budget_exceeded"; emit("budget_exceeded"); return state;
      }
      state.steps++;
      let decision;
      try {
        decision = await this.planner({
          goal, instructions: this.instructions, observations: copy(state.observations),
          remainingTokens: this.limits.maxTokens - state.tokens,
          tools: Object.entries(this.tools).map(([name, t]) => ({
            name, description: t.description, parameters: t.parameters, approvalRequired: !!t.approvalRequired
          }))
        });
        const used = decision.tokens ?? 0;
        if (!Number.isInteger(used) || used < 0) throw Error("Invalid token usage");
        state.tokens += used;
        if (state.tokens > this.limits.maxTokens) {
          state.status = "budget_exceeded"; emit("budget_exceeded"); return state;
        }
      } catch (error) {
        state.status = "failed"; emit("planner_error", { error: error.message }); return state;
      }
      if (decision.type === "final") {
        try { await this.validateFinal(decision.text, state); }
        catch (error) { state.status = "failed"; emit("final_rejected", { error: error.message }); return state; }
        state.status = "complete"; state.answer = decision.text; emit("completed"); return state;
      }
      if (decision.type !== "tool") {
        state.status = "failed"; emit("planner_error", { error: "Expected tool or final decision" }); return state;
      }
      const { name, args } = decision;
      state.toolCalls++; emit("tool_requested", { name: name ?? null, args: args ?? null });
      try {
        const tool = Object.hasOwn(this.tools, name) ? this.tools[name] : null;
        if (!tool) throw Error("Unknown tool: " + name);
        validate(tool.parameters, args);
        const key = canonical({ name, args });
        if (!Object.hasOwn(state.receipts, key) && tool.guard) await tool.guard(copy(args));
        if (tool.approvalRequired && !Object.hasOwn(state.receipts, key)) {
          state.pending = { id: state.runId + ":" + state.steps + ":" + name, tool: name, args: copy(args) };
          state.status = "awaiting_approval"; emit("approval_required", state.pending); return state;
        }
        const result = await execute(name, args);
        state.observations.push({ tool: name, args, ok: true, result: copy(result) });
      } catch (error) {
        state.observations.push({ tool: name ?? "", args: args ?? {}, ok: false, error: error.message });
        emit("tool_error", { name: name ?? "", error: error.message });
      }
    }
    state.status = "budget_exceeded"; emit("budget_exceeded"); return state;
  }
}
