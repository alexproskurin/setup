---
type: subsystem
title: "claude-mods: Mods and the Install Pipeline"
description: How a personal mod is written once in Claude Code's plugin and skill format, scaffolded with new-mod.sh, and installed by install.sh into Claude Code as a plugin and into Codex and opencode as generated skills and commands.
tags: [claude-mods, claude-code, codex, opencode, plugins, skills]
verified:
  - by: openwiki/0.5.1
    at: 2026-10-15T21:22:10.058Z
sources:
  - id: openwiki-source-bf9c9d636e82748757f4bf85
    resource: repo://claude-mods/install.sh
  - id: openwiki-source-89268528aa82d498f01ad855
    resource: repo://claude-mods/mods/my-mod/skills/hello/SKILL.md
  - id: openwiki-source-d18dbcef32b8f892c2b1fd79
    resource: repo://claude-mods/scripts/new-mod.sh
generated: { by: "claude-code", at: "2026-10-15T21:22:10.058Z" }
---

# claude-mods: Mods and the Install Pipeline

`claude-mods/` holds personal **mods** for three coding-agent harnesses:
Claude Code, Codex, and opencode. Each mod is written once in Claude Code's
format; `install.sh` installs it into Claude Code as-is and generates the Codex
and opencode versions. `claude-mods/AGENTS.md` is the detailed contract (and
`claude-mods/CLAUDE.md` imports it).

> At the time this page was written, `claude-mods/` had uncommitted changes:
> the starter mod moved from Claude-only function hooks (`hooks/`) to a
> portable skill (`skills/hello/`). This page describes the working tree.

## What a mod is

```text
claude-mods/
  .claude-plugin/marketplace.json     one entry per mod
  mods/<mod>/
    .claude-plugin/plugin.json        name (== folder), version, description, author
    skills/<skill>/SKILL.md           the definition: a Claude Code skill
    skills/<skill>/scripts/<file>     the code, any language, executable
  build/                              generated for Codex/opencode (gitignored)
```

The definition is a Claude Code skill whose `` !`…` `` lines run the code
before the model sees the skill. The starter mod `my-mod` has one skill:

```markdown
---
name: hello
description: Say hello from a script. Use when the user asks to say hello or to test that mods work.
argument-hint: "[name]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/hello.ts *)
---

!`${CLAUDE_SKILL_DIR}/scripts/hello.ts $ARGUMENTS`

Reply with the output above exactly as printed, and nothing else.
```

`hello.ts` is a `bun` script that greets the joined arguments, or the OS user.
Every `` !`…` `` command needs a matching `allowed-tools: Bash(<command> *)`
entry, or Claude Code aborts the skill.

## Scaffolding: `scripts/new-mod.sh`

`scripts/new-mod.sh [--ts] <name> "description"`:

- requires a kebab-case name and refuses to overwrite an existing mod;
- writes `plugin.json`, a starter script (bash, or TypeScript run by `bun`
  with `--ts`) marked executable, and a `SKILL.md` whose `allowed-tools`
  already allows the script;
- appends the mod to `.claude-plugin/marketplace.json`.

## Installing: `install.sh`

```sh
./install.sh                    # check, generate, install every mod into every harness found
./install.sh <mod> [...]        # only these mods
./install.sh -H codex,opencode  # only these harnesses
./install.sh --list             # what is installed where
./install.sh --uninstall <mod>
```

Options: `-s/--scope user|project|local` (Claude Code plugin scope, default
`user`) and `--skip-checks`. It requires `jq` and `perl`.

### Finding the harnesses

- Claude Code: `claude` on PATH.
- Codex: `CODEX_BIN`, else `codex` on PATH, else the binary inside
  `/Applications/ChatGPT.app` or `/Applications/Codex.app`.
- opencode: `opencode` on PATH, else `~/.opencode/bin/opencode`.

Without `-H`, every harness found is used. Mod folders not listed in the
marketplace produce a warning; asking for an unlisted mod is an error.

### Checks (before anything is generated)

For each skill: the `name` equals its folder and is kebab-case; `description`
is present; every `` !`…` `` command path exists and is executable; and
warnings for missing `allowed-tools`, Claude-only fenced `` ```! `` blocks,
and Claude-only named `arguments:`. Skill names must be unique across all
mods, because Codex and opencode share `~/.agents/skills`. When Claude Code
is installed, `claude plugin validate` runs on the marketplace and each mod,
and `claude plugin test` runs for mods with `hooks/*.test.ts`.

### Generation (into `build/`)

- **Codex / shared skill** (`build/agents/skills/<skill>/SKILL.md`): name and
  description only, then the body with `${CLAUDE_SKILL_DIR}` and
  `${CLAUDE_PLUGIN_ROOT}` replaced by absolute paths and `${CLAUDE_PROJECT_DIR}`
  by `.`. Each `` !`cmd` `` becomes `**Run:** `cmd``, with an instruction for
  the model to run it, because Codex does not execute those lines itself.
- **opencode command** (`build/opencode/commands/<skill>.md`): keeps the
  `` !`…` `` lines (opencode runs them before the model) and renumbers
  Claude's zero-based `$0`, `$1` positional arguments to opencode's `$1`, `$2`.

### Installation

- **Claude Code:** `claude plugin marketplace add <claude-mods>`, a marketplace
  update, then `claude plugin install <mod>@claude-mods --scope <scope>`. The
  plugin is read in place, so script edits apply immediately; `SKILL.md`
  edits need `/reload-plugins`.
- **Codex and opencode:** each generated skill is symlinked into
  `~/.agents/skills/<skill>`; for opencode, each command into
  `~/.config/opencode/commands/<skill>.md`. Existing paths that are not
  symlinks into `build/` are left alone with a warning. Re-run `install.sh`
  after editing a `SKILL.md`.

### Listing and uninstalling

`--list` shows a check mark per mod and harness. `--uninstall` removes the
Claude Code plugin and the symlinks it owns. A shared `~/.agents/skills` link
is removed only when every installed Codex/opencode harness is being
uninstalled, since both read it.

## Portability rules worth remembering

- Prefer `$ARGUMENTS` and have scripts join their arguments: Claude Code
  word-splits it, opencode passes it as one argument.
- Use inline `` !`…` `` lines, not fenced `` ```! `` blocks.
- Claude Code checks `` !`…` `` commands against permission rules; opencode
  runs them outside its permission system; Codex runs them under its sandbox.
- Claude-only extras (function hooks with `hooks/hooks.json` and
  `register.ts`) are not generated for Codex or opencode.

## Related

- [Agent Board Template and Installer](../agent-board/template-and-installer.md):
  another cross-harness tool in this repository. It has its own installer for
  Claude Code hooks, Codex hooks, and an opencode plugin, plus a user-level
  `agent-board` skill, so it does not go through claude-mods.
