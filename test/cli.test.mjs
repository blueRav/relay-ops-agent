import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 10000, env: { ...process.env, OPENAI_API_KEY: "", OPENAI_MODEL: "" } });
test("CLI demo persists a checkpoint and resumes any approval", () => {
  const folder = mkdtempSync(join(tmpdir(), "agent-demo-")); const path = join(folder, "run.json");
  try {
    const first = invoke(["--state", path]); assert.equal(first.status, 0, first.stderr);
    let saved = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(saved.mode, "deterministic");
    if (saved.state.status === "awaiting_approval") {
      const next = invoke(["--state", path, "--resume", "--approve", "--reviewer", "test-reviewer"]);
      assert.equal(next.status, 0, next.stderr); saved = JSON.parse(readFileSync(path, "utf8"));
    }
    assert.equal(saved.state.status, "complete");
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
test("CLI refuses approval without a checkpoint and reviewer", () => {
  const result = invoke(["--approve"]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /--resume/);
});
