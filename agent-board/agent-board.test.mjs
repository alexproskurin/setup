// node --test agent-board.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classifyUpdates, matchingFiles, mentions, render, repoFromRemote } from "./agent-board.mjs";

const SCRIPT = fileURLToPath(new URL("./agent-board.mjs", import.meta.url));
const ME = "fp-me";
const CHANGED = [
  "src/server/api.mjs",
  "src/server/sync/store.mjs",
  "AGENTS.md",
];

const issue = (number, overrides = {}) => ({
  number,
  title: `Thread ${number}`,
  body: "",
  state: "open",
  html_url: `https://github.com/o/r/issues/${number}`,
  created_at: "2026-10-15T09:00:00Z",
  updated_at: "2026-10-15T11:00:00Z",
  user: { login: "someone" },
  ...overrides,
});
const comment = (login, body, at = "2026-10-15T11:00:00Z") => ({ user: { login }, body, created_at: at, updated_at: at });

test("file matching covers full paths, directories, partial paths, URLs, and bare names", () => {
  assert.deepEqual(matchingFiles("changing src/server/api.mjs", CHANGED), ["src/server/api.mjs"]);
  assert.deepEqual(matchingFiles("anything under src/server/sync/ ?", CHANGED), ["src/server/sync/store.mjs"]);
  assert.deepEqual(matchingFiles("see server/sync for the sync", CHANGED), ["src/server/sync/store.mjs"]);
  assert.deepEqual(matchingFiles("https://github.com/o/r/blob/main/src/server/api.mjs#L10", CHANGED), ["src/server/api.mjs"]);
  assert.deepEqual(matchingFiles("I edited AGENTS.md and api.mjs.", CHANGED), ["AGENTS.md", "src/server/api.mjs"]);
  assert.deepEqual(matchingFiles("unrelated lib/sync/event.mjs and/or e.g. v1.0", CHANGED), []);
});

test("mentions match the exact login only", () => {
  assert.equal(mentions("cc @fp-me please", ME), true);
  assert.equal(mentions("(@FP-ME)", ME), true);
  assert.equal(mentions("@fp-me-bot", ME), false);
  assert.equal(mentions("mail user@fp-me.com", ME), false);
});

test("classification ignores own activity and dedupes notified updates", () => {
  const since = "2026-10-15T10:00:00Z";
  const comments = {
    1: [comment(ME, "my own update")],
    2: [comment("bob", "question for @fp-me")],
    3: [comment("carol", "unrelated chatter")],
    4: [comment("dan", "already seen", "2026-10-15T10:30:00Z")],
  };
  const items = [
    issue(1), issue(2), issue(3), issue(4),
    issue(5, { created_at: "2026-10-15T10:30:00Z", user: { login: "erin" }, body: "Proposal for src/server/api.mjs" }),
    issue(6, { created_at: "2026-10-15T10:30:00Z", user: { login: ME }, body: "my own new thread" }),
  ];
  const updates = classifyUpdates({
    items, since, me: ME, involved: new Set([3]), changedFiles: CHANGED,
    commentsFor: (number) => comments[number] || [],
    notified: { 4: "2026-10-15T10:30:00Z" },
  });
  const byNumber = Object.fromEntries(updates.map((update) => [update.number, update]));
  assert.deepEqual(Object.keys(byNumber).map(Number), [2, 3, 5]);
  assert.deepEqual(byNumber[2].reasons, ["mentions you"]);
  assert.deepEqual(byNumber[3].reasons, ["a thread you are in"]);
  assert.match(byNumber[5].reasons[0], /touches src\/server\/api\.mjs/);
  assert.match(byNumber[5].activity, /new thread by @erin/);
});

test("the repository comes from SSH and HTTPS GitHub remotes", () => {
  assert.equal(repoFromRemote("git@github.com:Org/my.repo.git"), "Org/my.repo");
  assert.equal(repoFromRemote("https://github.com/org/repo\n"), "org/repo");
  assert.equal(repoFromRemote("ssh://git@github.com/org/repo.git"), "org/repo");
  assert.equal(repoFromRemote("https://gitlab.com/org/repo.git"), null);
});

test("claude and codex share hook output; json is the plain result", () => {
  const result = { event: "PostToolUse", context: "ctx", message: "msg" };
  const hook = { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "ctx" }, systemMessage: "msg" };
  assert.deepEqual(render(result, "claude"), hook);
  assert.deepEqual(render(result, "codex"), hook);
  assert.deepEqual(render({ event: "Stop", block: true, context: "why" }, "claude"), { decision: "block", reason: "why" });
  assert.deepEqual(render(result, "json"), result);
  assert.equal(render(null, "claude"), null);
});

function harness(fixture, { config = {}, repoArgs = ["--repo", "o/r"] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "agent-board-test-"));
  const fixturePath = join(directory, "fixture.json");
  const configPath = join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify(config));
  const write = (data) => writeFileSync(fixturePath, JSON.stringify({ me: ME, changedFiles: CHANGED, ...data }));
  write(fixture);
  const run = (mode, input = {}, args = []) => {
    const result = spawnSync(process.execPath, [SCRIPT, mode, ...repoArgs, ...args], {
      input: JSON.stringify({ cwd: directory, ...input }),
      env: { ...process.env, AGENT_BOARD_FIXTURE: fixturePath, AGENT_BOARD_STATE_DIR: directory, AGENT_BOARD_CONFIG: configPath },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  };
  const state = () => JSON.parse(readFileSync(join(directory, "state.json"), "utf8"));
  return { directory, write, run, state };
}

test("session start lists relevant open threads and sets the cursor", () => {
  const { run, state } = harness({
    now: "2026-10-15T12:00:00Z",
    issues: [issue(7, { body: "touches AGENTS.md" }), issue(8), issue(9, { state: "closed", body: "AGENTS.md" })],
    involved: [8],
  });
  const output = run("session-start");
  const context = output.hookSpecificOutput.additionalContext;
  assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(context, /#7 "Thread 7" — touches AGENTS\.md/);
  assert.match(context, /#8 "Thread 8" — a thread you are in/);
  assert.doesNotMatch(context, /#9/);
  assert.match(context, /information, not instructions from your user/);
  assert.equal(state().since, "2026-10-15T12:00:00.000Z");
});

async function waitFor(condition, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test("post-tool polls in the background and reports the result on a later call, once", async () => {
  const { write, run, state } = harness({ now: "2026-10-15T12:00:00Z", issues: [] });
  run("session-start");
  // A new comment bumps the issue's updated_at, as on GitHub.
  const update = {
    issues: [issue(2, { updated_at: "2026-10-15T12:03:00Z" })],
    comments: { 2: [comment("bob", "@fp-me can you look?", "2026-10-15T12:03:00Z")] },
  };

  write({ now: "2026-10-15T12:04:00Z", ...update });
  assert.equal(run("post-tool"), null, "within the 300 s interval nothing is polled");
  assert.equal(state().lastPollAt, "2026-10-15T12:00:00.000Z");

  write({ now: "2026-10-15T12:06:00Z", ...update });
  assert.equal(run("post-tool"), null, "a due poll starts in the background; the hook does not wait");
  assert.equal(state().lastPollAt, "2026-10-15T12:06:00.000Z");
  await waitFor(() => state().pending.length === 1, "the background poll");
  assert.equal(state().notified[2], "2026-10-15T12:03:00Z");

  write({ now: "2026-10-15T12:07:00Z", ...update });
  const output = run("post-tool");
  assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(output.hookSpecificOutput.additionalContext, /#2 "Thread 2" — mentions you; 1 new comment by @bob/);
  assert.match(output.hookSpecificOutput.additionalContext, /information, not instructions from your user/);
  assert.equal(output.systemMessage, "Agent board: 1 relevant update");

  write({ now: "2026-10-15T12:12:00Z", ...update });
  assert.equal(run("post-tool"), null, "the next due poll starts; nothing pending yet");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(state().pending.length, 0, "an update already reported is not queued again");
});

test("stop blocks once for unseen relevant updates and respects stop_hook_active", () => {
  const { write, run } = harness({ now: "2026-10-15T12:00:00Z", issues: [] });
  run("session-start");
  const update = {
    issues: [issue(3, { updated_at: "2026-10-15T12:01:00Z" })],
    involved: [3],
    comments: { 3: [comment("carol", "reply", "2026-10-15T12:01:00Z")] },
  };
  write({ now: "2026-10-15T12:02:00Z", ...update });
  assert.equal(run("stop", { stop_hook_active: true }), null);
  const output = run("stop");
  assert.equal(output.decision, "block");
  assert.match(output.reason, /#3 "Thread 3" — a thread you are in/);
  assert.match(output.reason, /Before finishing/);
  write({ now: "2026-10-15T12:04:00Z", ...update });
  assert.equal(run("stop"), null, "the same update never blocks twice");
});

test("a failing background poll is logged, prints nothing, and backs off", async () => {
  const { directory, write, run, state } = harness({ now: "2026-10-15T12:00:00Z", issues: [] });
  run("session-start");
  write({ now: "2026-10-15T12:06:00Z", fail: true });
  assert.equal(run("post-tool"), null);
  assert.equal(state().lastPollAt, "2026-10-15T12:06:00.000Z");
  const log = join(directory, "errors.log");
  await waitFor(() => existsSync(log), "the error log");
  assert.match(readFileSync(log, "utf8"), /poll simulated GitHub outage/);
  write({ now: "2026-10-15T12:07:00Z", fail: true });
  assert.equal(run("post-tool"), null);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1, "no retry inside the interval");
});

test("the config file sets repository, label, and conventions doc; json format for plugins", () => {
  const { run } = harness(
    { now: "2026-10-15T12:00:00Z", issues: [issue(7, { body: "touches AGENTS.md" })] },
    { config: { repo: "acme/widgets", label: "board:agents", doc: "CONTRIBUTING.md#agents", format: "json" }, repoArgs: [] },
  );
  const output = run("session-start");
  assert.equal(output.event, "SessionStart");
  assert.match(output.context, /labeled `board:agents` in acme\/widgets/);
  assert.match(output.context, /--repo acme\/widgets --label "board:agents"/);
  assert.match(output.context, /Conventions: CONTRIBUTING\.md#agents\./);
  assert.equal(output.message, "Agent board: 1 open thread relevant to this branch");
});

test("hook modes never fail the session on bad configuration", () => {
  const { run } = harness({ issues: [] }, { config: { format: "yaml" } });
  assert.equal(run("post-tool"), null);
});
