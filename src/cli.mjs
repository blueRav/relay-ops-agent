import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Agent, approve } from "./agent.mjs";
import { openAIPlanner } from "./provider.mjs";
import { createProject, fixture } from "./project.mjs";
try {
  const { values } = parseArgs({ options: {
    live: { type: "boolean", default: false }, resume: { type: "boolean", default: false },
    approve: { type: "boolean", default: false }, reviewer: { type: "string" },
    state: { type: "string", default: ".state/run.json" }, session: { type: "string" },
    help: { type: "boolean", short: "h", default: false }
  } });
  if (values.help) {
    console.log("node src/cli.mjs [--live] [--state path] [--resume --approve --reviewer name] [--session id]");
  } else {
    const path = resolve(values.state);
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    if (values.approve && (!values.resume || !values.reviewer?.trim())) throw Error("Use --resume --approve --reviewer NAME for the exact pending action");
    if (values.resume && !previous) throw Error("No checkpoint exists at " + path);
    if (values.resume && values.session) throw Error("Start a new session without --resume");
    let world = (values.resume || values.session) && previous ? previous.world : JSON.parse(JSON.stringify(fixture));
    if (values.session) {
      if (!Array.isArray(world.meetings) || !world.meetings.some(meeting => meeting.id === values.session)) throw Error("Unknown meeting session");
      world.activeSession = values.session;
    }
    const project = createProject(world);
    const live = values.live || (values.resume && previous?.mode === "live-model");
    const planner = live ? openAIPlanner({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL }) : project.planner;
    const agent = new Agent({ planner, tools: project.tools, instructions: project.instructions, validateFinal: project.validateFinal });
    const saved = values.resume ? previous.state : undefined;
    const approval = values.approve ? approve(saved?.pending, values.reviewer) : undefined;
    const state = await agent.run({ goal: project.goal, runId: "run-" + Date.now(), state: saved, approval });
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path + ".tmp", JSON.stringify({ mode: live ? "live-model" : "deterministic", world: project.world, state }, null, 2) + "\n", { mode: 0o600 });
    renameSync(path + ".tmp", path);
    console.log(JSON.stringify({
      mode: live ? "live-model" : "deterministic", status: state.status, answer: state.answer || null,
      pending: state.pending, toolCalls: state.toolCalls, tokens: state.tokens, checkpoint: path,
      result: project.world.report || project.world.brief || project.world.tasks || null
    }, null, 2));
    if (state.status === "awaiting_approval") console.log("Review pending, then run: node src/cli.mjs --state " + JSON.stringify(path) + " --resume --approve --reviewer YOUR_NAME");
    if (["failed", "budget_exceeded"].includes(state.status)) process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
