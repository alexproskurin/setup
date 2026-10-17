// node --test install.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { codexTrusts } from "./install.mjs";

const INSTALL = fileURLToPath(new URL("./install.mjs", import.meta.url));
const RUNTIME = fileURLToPath(new URL("./agent-board.mjs", import.meta.url));

function project({ remote = "git@github.com:acme/widgets.git" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "agent-board-install-"));
  const home = join(root, "home");
  const checkout = join(root, "checkout");
  mkdirSync(home);
  mkdirSync(checkout);
  execFileSync("git", ["init", "-q"], { cwd: checkout });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: checkout });
  const run = (...args) => {
    // An empty global excludes file, so the test does not depend on the user's git setup.
    const env = { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), GIT_CONFIG_GLOBAL: join(root, "gitconfig"), XDG_CONFIG_HOME: join(home, ".config") };
    writeFileSync(join(root, "gitconfig"), "");
    const result = spawnSync(process.execPath, [INSTALL, ...args, ...(args[0] === "skill" ? [] : ["--project", checkout])], { env, encoding: "utf8" });
    return { ...result, out: `${result.stdout}${result.stderr}` };
  };
  const read = (path) => readFileSync(join(checkout, path), "utf8");
  return { root, home, checkout, run, read };
}

test("init writes the conventions document and one AGENTS.md section, idempotently", () => {
  const { checkout, run, read } = project();
  writeFileSync(join(checkout, "AGENTS.md"), "# Rules\n\nBe kind.\n");
  assert.equal(run("init", "--label", "board:agents").status, 0);
  assert.match(read("docs/agent-board.md"), /GitHub Issues in `acme\/widgets` with the label `board:agents`/);
  assert.doesNotMatch(read("docs/agent-board.md"), /\{\{|theox|Study/);
  const once = read("AGENTS.md");
  assert.match(once, /^# Rules\n\nBe kind\.\n\n<!-- agent-board:start -->\n## Coordinate with other agents/);
  assert.match(once, /labeled\n`board:agents`/);

  writeFileSync(join(checkout, "docs/agent-board.md"), "team edits\n");
  const again = run("init", "--label", "board:agents");
  assert.match(again.out, /kept existing docs\/agent-board\.md/);
  assert.equal(read("docs/agent-board.md"), "team edits\n", "init never overwrites the team's document without --force");
  assert.equal(read("AGENTS.md"), once, "re-running init replaces the section in place");
  assert.match(again.out, /gh label create board:agents --repo acme\/widgets/);
});

test("claude install merges hooks, re-install does not duplicate, uninstall restores settings", () => {
  const { checkout, run, read } = project();
  mkdirSync(join(checkout, ".claude"));
  const original = { permissions: { allow: ["Bash(ls)"] }, hooks: { PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo hi" }] }] } };
  writeFileSync(join(checkout, ".claude/settings.local.json"), JSON.stringify(original));

  assert.equal(run("install", "--harness", "claude", "--gh-user", "me").status, 0);
  assert.equal(run("install", "--harness", "claude", "--interval", "120").status, 0);
  const settings = JSON.parse(read(".claude/settings.local.json"));
  assert.deepEqual(Object.fromEntries(Object.entries(settings.hooks).map(([event, groups]) => [event, groups.length])), { PostToolUse: 2, SessionStart: 1, Stop: 1 });
  assert.deepEqual(settings.hooks.Stop[0].hooks[0].args, [RUNTIME, "stop", "--format", "claude"]);
  assert.deepEqual(JSON.parse(read(".git/agent-board/config.json")), { repo: "acme/widgets", ghUser: "me", interval: 120 });
  assert.match(read(".git/info/exclude"), /^\/\.claude\/settings\.local\.json$/m, "personal settings are excluded from commits");

  assert.equal(run("uninstall", "--harness", "claude").status, 0);
  assert.deepEqual(JSON.parse(read(".claude/settings.local.json")), original);
  assert.equal(existsSync(join(checkout, ".git/agent-board/config.json")), false);
});

test("uninstall removes a settings file that held only board hooks, including the old theox hook", () => {
  const { checkout, run } = project();
  mkdirSync(join(checkout, ".claude"));
  writeFileSync(join(checkout, ".claude/settings.local.json"), JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "node", args: ["/old/theox/agent-board/board-hook.mjs", "stop"] }] }] },
  }));
  assert.equal(run("uninstall", "--harness", "claude").status, 0);
  assert.equal(existsSync(join(checkout, ".claude/settings.local.json")), false);
});

test("install needs a GitHub repository", () => {
  const { run } = project({ remote: null });
  const result = run("install", "--harness", "claude");
  assert.equal(result.status, 1);
  assert.match(result.out, /pass --repo OWNER\/NAME/);
});

test("skill installs per harness and never replaces someone else's skill", () => {
  const { home, run } = project();
  assert.equal(run("skill", "--harness", "claude").status, 0);
  const path = join(home, ".claude/skills/agent-board/SKILL.md");
  assert.match(readFileSync(path, "utf8"), new RegExp(`node ${RUNTIME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} check`));
  writeFileSync(path, "---\nname: agent-board\n---\nsomething else\n");
  assert.match(run("skill", "--harness", "claude").out, /skipped/);
  assert.match(run("skill", "--harness", "claude", "--uninstall").out, /skipped/);
  assert.equal(readFileSync(path, "utf8"), "---\nname: agent-board\n---\nsomething else\n");
});

test("codex install writes project hooks, notes trust, and uninstall cleans up", () => {
  const { home, checkout, run, read } = project();
  const first = run("install", "--harness", "codex");
  assert.equal(first.status, 0, first.out);
  const hooks = JSON.parse(read(".codex/hooks.json"));
  assert.deepEqual(Object.keys(hooks), ["hooks"], "Codex accepts only description and hooks at the top level");
  assert.equal(hooks.hooks.PostToolUse[0].hooks[0].command, `node '${RUNTIME}' post-tool --format codex`);
  assert.match(first.out, /trusted project/);
  assert.match(first.out, /open \/hooks in Codex/);
  assert.match(read(".git/info/exclude"), /^\/\.codex\/hooks\.json$/m);

  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(join(home, ".codex/config.toml"), `[projects.${JSON.stringify(realpathSync(checkout))}]\ntrust_level = "trusted"\n`);
  assert.doesNotMatch(run("install", "--harness", "codex").out, /trusted project/);

  assert.equal(run("uninstall", "--harness", "codex").status, 0);
  assert.equal(existsSync(join(checkout, ".codex")), false);
});

test("codexTrusts reads only the matching project section", () => {
  const toml = '[projects."/a"]\ntrust_level = "trusted"\n\n[projects."/b"]\ntrust_level = "untrusted"\n';
  assert.equal(codexTrusts(toml, "/a"), true);
  assert.equal(codexTrusts(toml, "/b"), false);
  assert.equal(codexTrusts(toml, "/c"), false);
});

test("opencode install writes the plugin, uninstall removes only its own file", () => {
  const { checkout, run, read } = project();
  assert.equal(run("install", "--harness", "opencode").status, 0);
  const plugin = read(".opencode/plugins/agent-board.ts");
  assert.match(plugin, new RegExp(`const RUNTIME = "${RUNTIME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.doesNotMatch(plugin, /__AGENT_BOARD__/);
  assert.match(read(".git/info/exclude"), /^\/\.opencode\/plugins\/agent-board\.ts$/m);
  writeFileSync(join(checkout, ".opencode/plugins/other.ts"), "export default {}\n");
  assert.equal(run("uninstall", "--harness", "opencode").status, 0);
  assert.equal(existsSync(join(checkout, ".opencode/plugins/agent-board.ts")), false);
  assert.equal(existsSync(join(checkout, ".opencode/plugins/other.ts")), true);
});

test("install refuses to change a committed hook file", () => {
  const { checkout, run } = project();
  mkdirSync(join(checkout, ".codex"));
  writeFileSync(join(checkout, ".codex/hooks.json"), "{}\n");
  execFileSync("git", ["add", ".codex/hooks.json"], { cwd: checkout });
  const result = run("install", "--harness", "codex");
  assert.equal(result.status, 1);
  assert.match(result.out, /committed in this project/);
});

test("hook modes stay silent in a checkout where the board is not installed", () => {
  const { checkout } = project();
  const result = spawnSync(process.execPath, [RUNTIME, "post-tool"], { cwd: checkout, input: "{}", encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(existsSync(join(checkout, ".git/agent-board")), false);
});
