#!/usr/bin/env node
// Installs the agent board into a project and into coding-agent harnesses
// (Claude Code, Codex, opencode). See README.md.
//
//   node install.mjs init      [--project DIR] [--repo OWNER/NAME] [--label NAME] [--doc PATH] [--gh-user LOGIN] [--create-label] [--force]
//   node install.mjs install   [--project DIR] [--harness LIST] [--repo OWNER/NAME] [--label NAME] [--doc PATH] [--gh-user LOGIN] [--interval SECONDS]
//   node install.mjs uninstall [--project DIR] [--harness LIST]
//   node install.mjs skill     [--harness LIST] [--uninstall]
//   node install.mjs status    [--project DIR]
//
// init writes the shared files a team commits: the conventions document and a
// section in AGENTS.md. install, uninstall, and skill change only personal files
// that are never committed: the checkout's hook or plugin files (added to
// .git/info/exclude when not already ignored), <git-common-dir>/agent-board/config.json,
// and user-level skills. LIST is comma-separated: claude,codex,opencode. The
// default is every harness found on this machine (every harness for uninstall).

import { execFileSync } from "node:child_process";
import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULTS, configPath, repoFromRemote, resolveOptions } from "./agent-board.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(HERE, "agent-board.mjs");
const TEMPLATES = join(HERE, "templates");
const OURS = /(agent-board|board-hook)\.mjs/; // board-hook.mjs: the earlier, theox-only name
const SECTION_START = "<!-- agent-board:start -->";
const SECTION_END = "<!-- agent-board:end -->";

// ---------------------------------------------------------------------------
// Small helpers

const VALUE_FLAGS = { "--project": "project", "--harness": "harness", "--repo": "repo", "--label": "label", "--doc": "doc", "--gh-user": "ghUser", "--interval": "interval" };
const BOOLEAN_FLAGS = { "--create-label": "createLabel", "--force": "force", "--uninstall": "uninstall" };
const COMMANDS = ["init", "install", "uninstall", "skill", "status"];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new Error(`usage: node install.mjs <${COMMANDS.join("|")}> [options]; see README.md`);
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (BOOLEAN_FLAGS[arg]) flags[BOOLEAN_FLAGS[arg]] = true;
    else if (VALUE_FLAGS[arg] && rest[index + 1] !== undefined) flags[VALUE_FLAGS[arg]] = rest[++index];
    else throw new Error(`unknown or incomplete option ${arg}`);
  }
  if (flags.interval !== undefined) flags.interval = Number(flags.interval);
  return { command, flags };
}

function git(cwd, args, { allowFailure = true } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
  }
}

function projectRoot(flags) {
  const start = resolve(flags.project || process.cwd());
  const root = git(start, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error(`${start} is not inside a git checkout`);
  return root;
}

const readJson = (path, fallback) => {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON; fix it first`);
  }
};

function writeFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const fill = (text, values) => text.replace(/\{\{(\w+)\}\}|__AGENT_BOARD__/g, (match, key) => (key ? values[key] : RUNTIME));
const template = (name) => readFileSync(join(TEMPLATES, name), "utf8");

function onPath(command) {
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    try {
      accessSync(join(directory, command), constants.X_OK);
      return join(directory, command);
    } catch { /* keep looking */ }
  }
  return null;
}

const firstExecutable = (...paths) => paths.find((path) => {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
}) || null;

// Keep personal files out of commits: if git does not already ignore the path,
// add it to the clone's info/exclude, which is never committed.
function ensureIgnored(project, path) {
  const rel = relative(project, path);
  try {
    execFileSync("git", ["check-ignore", "-q", rel], { cwd: project, stdio: "ignore" });
    return;
  } catch { /* not ignored */ }
  const exclude = resolve(project, git(project, ["rev-parse", "--git-path", "info/exclude"], { allowFailure: false }));
  const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  if (!current.split("\n").includes(`/${rel}`)) {
    mkdirSync(dirname(exclude), { recursive: true });
    appendFileSync(exclude, `${current && !current.endsWith("\n") ? "\n" : ""}/${rel}\n`);
    console.log(`  added /${rel} to ${relative(project, exclude)}`);
  }
}

// ---------------------------------------------------------------------------
// Hook JSON shared by Claude Code and Codex

const runsBoard = (hook) => OURS.test([hook.command || "", ...(hook.args || [])].join(" "));

export function removeBoardHooks(settings) {
  const copy = structuredClone(settings);
  if (!copy.hooks) return copy;
  for (const [event, groups] of Object.entries(copy.hooks)) {
    const kept = groups.filter((group) => !(group.hooks || []).some(runsBoard));
    if (kept.length) copy.hooks[event] = kept;
    else delete copy.hooks[event];
  }
  if (!Object.keys(copy.hooks).length) delete copy.hooks;
  return copy;
}

export function addBoardHooks(settings, snippet) {
  const result = removeBoardHooks(settings);
  result.hooks = result.hooks || {};
  for (const [event, groups] of Object.entries(snippet.hooks)) result.hooks[event] = [...(result.hooks[event] || []), ...groups];
  return result;
}

const hasBoardHooks = (settings) => Object.values(settings.hooks || {}).some((groups) => groups.some((group) => (group.hooks || []).some(runsBoard)));

function updateHookFile(path, change) {
  const current = readJson(path, {});
  const next = change(current);
  if (!Object.keys(next).length) {
    if (existsSync(path)) rmSync(path);
  } else {
    writeJson(path, next);
  }
}

// ---------------------------------------------------------------------------
// Harnesses

const claude = {
  name: "Claude Code",
  detect: () => onPath("claude"),
  file: (project) => join(project, ".claude", "settings.local.json"),
  installed(project) { return hasBoardHooks(readJson(this.file(project), {})); },
  install(project) {
    const path = this.file(project);
    refuseTracked(project, path);
    const snippet = JSON.parse(fill(template("claude-hooks.json"), {}));
    updateHookFile(path, (settings) => addBoardHooks(settings, snippet));
    ensureIgnored(project, path);
    return [`hooks in ${relative(project, path)}`, "start a new Claude Code session, or open /hooks once, to load them"];
  },
  uninstall(project) { updateHookFile(this.file(project), removeBoardHooks); },
  skillDir: () => join(homedir(), ".claude", "skills", "agent-board"),
};

const codexHome = () => process.env.CODEX_HOME || join(homedir(), ".codex");

// Codex loads <project>/.codex/hooks.json only in a trusted project.
export function codexTrusts(configToml, project) {
  const header = `[projects.${JSON.stringify(project)}]`;
  const sections = configToml.split(/^(?=\s*\[)/m);
  const section = sections.find((text) => text.trim().startsWith(header));
  return Boolean(section && /^\s*trust_level\s*=\s*"trusted"\s*$/m.test(section));
}

const codex = {
  name: "Codex",
  detect: () => process.env.CODEX_BIN || onPath("codex")
    || firstExecutable("/Applications/Codex.app/Contents/Resources/codex", "/Applications/ChatGPT.app/Contents/Resources/codex"),
  file: (project) => join(project, ".codex", "hooks.json"),
  installed(project) { return hasBoardHooks(readJson(this.file(project), {})); },
  install(project) {
    const path = this.file(project);
    refuseTracked(project, path);
    const snippet = JSON.parse(fill(template("codex-hooks.json"), {}));
    updateHookFile(path, (settings) => addBoardHooks(settings, snippet));
    ensureIgnored(project, path);
    const configToml = join(codexHome(), "config.toml");
    const trusted = existsSync(configToml) && codexTrusts(readFileSync(configToml, "utf8"), project);
    return [
      `hooks in ${relative(project, path)}`,
      ...(trusted ? [] : [`Codex loads project hooks only in a trusted project: accept the trust prompt, or add [projects.${JSON.stringify(project)}] trust_level = "trusted" to ${configToml}`]),
      "then open /hooks in Codex once and trust the three agent-board hooks (Codex skips new hooks until you review them)",
    ];
  },
  uninstall(project) {
    updateHookFile(this.file(project), removeBoardHooks);
    removeEmptyDirectory(dirname(this.file(project)));
  },
  skillDir: () => join(homedir(), ".agents", "skills", "agent-board"),
};

const opencode = {
  name: "opencode",
  detect: () => onPath("opencode") || firstExecutable(join(homedir(), ".opencode", "bin", "opencode")),
  file: (project) => join(project, ".opencode", "plugins", "agent-board.ts"),
  installed(project) { return existsSync(this.file(project)); },
  install(project) {
    const path = this.file(project);
    refuseTracked(project, path);
    writeFile(path, fill(template("opencode-plugin.ts"), {}));
    ensureIgnored(project, path);
    const version = opencodeVersion(this.detect());
    return [
      `plugin ${relative(project, path)}`,
      ...(version && Number(version.split(".")[0]) < 2 ? [`warning: the plugin needs opencode 2.x; found ${version}`] : []),
      "restart opencode in this project to load it",
    ];
  },
  uninstall(project) {
    const path = this.file(project);
    if (existsSync(path) && readFileSync(path, "utf8").includes("agent-board/install.mjs")) rmSync(path);
    removeEmptyDirectory(dirname(path));
    removeEmptyDirectory(dirname(dirname(path)));
  },
  skillDir: () => join(homedir(), ".agents", "skills", "agent-board"),
};

function opencodeVersion(binary) {
  if (!binary) return null;
  try {
    return execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim().replace(/^v/, "");
  } catch {
    return null;
  }
}

function refuseTracked(project, path) {
  const rel = relative(project, path);
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", rel], { cwd: project, stdio: "ignore" });
  } catch {
    return;
  }
  throw new Error(`${rel} is committed in this project; not changing a shared file`);
}

function removeEmptyDirectory(path) {
  try { rmdirSync(path); } catch { /* not empty or missing */ }
}

const HARNESSES = { claude, codex, opencode };

function selectHarnesses(flags, { all = false } = {}) {
  if (flags.harness) {
    return flags.harness.split(",").map((name) => {
      if (!HARNESSES[name.trim()]) throw new Error(`unknown harness ${name}; choose from ${Object.keys(HARNESSES).join(", ")}`);
      return name.trim();
    });
  }
  const names = Object.keys(HARNESSES).filter((name) => all || HARNESSES[name].detect());
  if (!names.length) throw new Error(`no harness found on PATH; pass --harness ${Object.keys(HARNESSES).join(",")}`);
  return names;
}

// ---------------------------------------------------------------------------
// Commands

function boardSettings(project, flags) {
  const path = configPath(project);
  const saved = readJson(path, {});
  const config = { ...saved };
  for (const key of ["repo", "label", "doc", "ghUser", "interval"]) if (flags[key] !== undefined) config[key] = flags[key];
  if (!config.repo) config.repo = repoFromRemote(git(project, ["remote", "get-url", "origin"]));
  if (!config.repo) throw new Error("could not find a GitHub repository from the origin remote; pass --repo OWNER/NAME");
  resolveOptions(config, project); // validates
  return { path, saved, config };
}

function init(flags) {
  const project = projectRoot(flags);
  const { config } = boardSettings(project, flags);
  const values = { REPO: config.repo, LABEL: config.label || DEFAULTS.label, DOC: config.doc || DEFAULTS.doc };

  const docPath = join(project, values.DOC.replace(/#.*$/, ""));
  if (existsSync(docPath) && !flags.force) {
    console.log(`kept existing ${relative(project, docPath)} (--force replaces it)`);
  } else {
    writeFile(docPath, fill(template("conventions.md"), values));
    console.log(`wrote ${relative(project, docPath)}`);
  }

  const agentsPath = join(project, "AGENTS.md");
  const section = `${SECTION_START}\n${fill(template("agents-section.md"), values).trim()}\n${SECTION_END}`;
  const agents = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
  const start = agents.indexOf(SECTION_START);
  const end = agents.indexOf(SECTION_END);
  const updated = start >= 0 && end > start
    ? `${agents.slice(0, start)}${section}${agents.slice(end + SECTION_END.length)}`
    : `${agents}${agents && !agents.endsWith("\n") ? "\n" : ""}${agents ? "\n" : ""}${section}\n`;
  writeFile(agentsPath, updated);
  console.log(`${start >= 0 ? "updated" : "added"} the agent board section in AGENTS.md`);

  const claudeMd = join(project, "CLAUDE.md");
  if (!existsSync(claudeMd) || !/AGENTS\.md/.test(readFileSync(claudeMd, "utf8"))) {
    console.log("note: Claude Code reads CLAUDE.md; make sure it contains the line @AGENTS.md");
  }

  const labelArgs = ["label", "create", values.LABEL, "--repo", config.repo, "--color", "5319E7",
    "--description", "Coordination between agents working for different people"];
  if (flags.createLabel) {
    const env = config.ghUser
      ? { ...process.env, GH_TOKEN: execFileSync("gh", ["auth", "token", "--user", config.ghUser], { encoding: "utf8" }).trim() }
      : process.env;
    try {
      execFileSync("gh", labelArgs, { env, stdio: ["ignore", "pipe", "pipe"] });
      console.log(`created label ${values.LABEL} in ${config.repo}`);
    } catch (error) {
      console.log(`label not created: ${String(error.stderr || error.message).trim().split("\n")[0]}`);
    }
  } else {
    console.log(`label: create it once with  gh ${labelArgs.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`);
  }
  console.log("review and commit the conventions document and AGENTS.md; then run install for your own checkout");
}

function install(flags) {
  const project = projectRoot(flags);
  const { path, config } = boardSettings(project, flags);
  writeJson(path, config);
  console.log(`agent board for ${config.repo} (label ${config.label || DEFAULTS.label}) in ${project}`);
  console.log(`  settings: ${path}`);
  for (const name of selectHarnesses(flags)) {
    const notes = HARNESSES[name].install(project, config);
    console.log(`${HARNESSES[name].name}: ${notes.join("; ")}`);
  }
}

function uninstall(flags) {
  const project = projectRoot(flags);
  for (const name of selectHarnesses(flags, { all: true })) {
    HARNESSES[name].uninstall(project);
    console.log(`${HARNESSES[name].name}: removed`);
  }
  if (!Object.values(HARNESSES).some((harness) => harness.installed(project))) {
    rmSync(configPath(project), { force: true });
    console.log("no harness uses the board in this checkout any more; removed its settings");
  }
}

// One user-level skill per harness; refuses to replace a skill it did not write.
function skill(flags) {
  const dirs = [...new Set(selectHarnesses(flags, { all: flags.uninstall }).map((name) => HARNESSES[name].skillDir()))];
  const text = fill(template("skill/SKILL.md"), {});
  for (const directory of dirs) {
    const path = join(directory, "SKILL.md");
    const ours = !existsSync(path) || readFileSync(path, "utf8").includes(RUNTIME) || OURS.test(readFileSync(path, "utf8"));
    if (!ours) {
      console.log(`skipped ${path}: a different agent-board skill is already there`);
    } else if (flags.uninstall) {
      rmSync(directory, { recursive: true, force: true });
      console.log(`removed ${directory}`);
    } else {
      writeFile(path, text);
      console.log(`wrote ${path}`);
    }
  }
}

function status(flags) {
  const project = projectRoot(flags);
  const path = configPath(project);
  console.log(`checkout: ${project}`);
  console.log(`settings: ${existsSync(path) ? JSON.stringify(readJson(path, {})) : "none (run install)"}`);
  for (const [name, harness] of Object.entries(HARNESSES)) {
    const skillPath = join(harness.skillDir(), "SKILL.md");
    console.log(`${harness.name}: ${harness.detect() ? "found" : "not found"}; board ${harness.installed(project) ? "installed" : "not installed"}; skill ${existsSync(skillPath) ? "installed" : "not installed"}`);
  }
}

function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  ({ init, install, uninstall, skill, status })[command](flags);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
