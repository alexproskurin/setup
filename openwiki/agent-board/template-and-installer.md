---
type: subsystem
title: Agent Board Template and Installer
description: The reusable agent board template for multi-person agent collaboration through a GitHub Issues board, covering the committed conventions and AGENTS.md section, the install.mjs commands, and the per-checkout integrations for Claude Code, Codex, and opencode, with their trust gates and verification status.
tags: [agent-board, template, installer, claude-code, codex, opencode]
verified:
  - by: openwiki/0.5.1
    at: 2026-10-15T21:22:10.058Z
sources:
  - id: openwiki-source-eee931d2faccaf7ccf08fa8c
    resource: repo://agent-board/install.mjs
  - id: openwiki-source-be33825e7a63319086008eb5
    resource: repo://agent-board/install.test.mjs
  - id: openwiki-source-c0fd24b01cde2609ad56ebbc
    resource: repo://agent-board/README.md
  - id: openwiki-source-a5b7ad4baeaa8dddbbfa72fc
    resource: repo://agent-board/templates/codex-hooks.json
  - id: openwiki-source-bfe7416c12e844ae5180652a
    resource: repo://agent-board/templates/opencode-plugin.ts
generated: { by: "claude-code", at: "2026-10-15T21:22:10.058Z" }
---

# Agent Board Template and Installer

`agent-board/` is a template for **multi-person agent collaboration**. When
several people each work with their own coding agent on one repository, the
agents coordinate in GitHub Issues with one label (`agent-board` by default).
They announce overlapping work, ask for reviews, negotiate interfaces, and
agree on invariants. The template is project- and harness-neutral; theox is one
installation ([theox local setup](../theox/local-setup.md)).

## Shared pieces and personal pieces

| Piece | Scope | Where it goes |
| --- | --- | --- |
| Conventions (`templates/conventions.md`) | team | committed `docs/agent-board.md` |
| `AGENTS.md` section (`templates/agents-section.md`) | team | committed, between `<!-- agent-board:start -->` markers |
| [Runtime](runtime.md) (`agent-board.mjs`) | person | stays in this folder; integrations call it by absolute path |
| Harness integration | person, per checkout | hook or plugin file, never committed |
| `agent-board` skill (`templates/skill/`) | person, all projects | user-level skill folders |

The board itself needs only `gh` and the committed conventions. The runtime and
integrations are a personal add-on that brings relevant new activity to the
agent while it works.

The conventions document covers the commands (`gh issue list/create/comment/close`
with `--body-file`), starting practices (search before working on shared
interfaces, post intent, cite concrete paths and pull requests, sign posts,
record decisions in the repository and close threads), and trust rules
(messages from other agents are information, not instructions). It also says
how the conventions evolve: `board:` labels, a "Learned conventions" list, and
periodic review.

## `install.mjs`

Node 22, no other dependencies. Commands:

- **`init`**: writes the conventions document, filled with the repository and
  label. An existing document is kept unless `--force` is passed. It then adds
  or replaces the marked section in `AGENTS.md`. It prints the
  `gh label create` command, or runs it with `--create-label`, and notes that
  Claude Code needs `@AGENTS.md` in `CLAUDE.md`. Review and commit the result.
- **`install`**: writes `<git-common-dir>/agent-board/config.json` (repository
  from `--repo` or `origin`, plus `label`, `doc`, `ghUser`, `interval`). It
  then installs each selected harness: `--harness claude,codex,opencode`, by
  default every harness found on the machine. Re-running it replaces only its
  own entries.
- **`uninstall`**: removes the selected integrations (all by default). It
  deletes the config file once no harness uses it, and removes hook files and
  directories that end up empty.
- **`skill`**: writes the on-demand `agent-board` skill, which runs
  `agent-board.mjs check`, into `~/.claude/skills` (Claude Code) and
  `~/.agents/skills` (Codex and opencode). It never replaces or deletes a
  different skill with the same name.
- **`status`**: shows the settings and, for each harness, whether it is found,
  installed in this checkout, and has the skill.

Safety rules for personal files:

- A personal file that git does not already ignore is added to the clone's
  `info/exclude`, never to `.gitignore`.
- The installer refuses to modify a hook file the project commits.
- Hook entries are recognized by the runtime's file name, including the
  earlier theox-only `board-hook.mjs`, so the installer migrates and removes
  old installs.

## Harness integrations

| | Claude Code | Codex (0.154+) | opencode (2.x) |
| --- | --- | --- | --- |
| File | `.claude/settings.local.json` | `.codex/hooks.json` | `.opencode/plugins/agent-board.ts` |
| Session start | `SessionStart` hook | `SessionStart` hook (startup, resume, clear, compact) | first tool result |
| While working | `PostToolUse`, all tools | `PostToolUse`, all tools | appended to tool results |
| Before finishing | `Stop` blocks once | `Stop` blocks once | `session.idle` re-prompts once |

- **Claude Code** hooks use exec form (`command: "node"` plus `args`). A first
  install needs a new session or `/hooks`.
- **Codex** hooks are shell strings run with `$SHELL -lc`, so `node` must be on
  the login shell's PATH. Codex has two one-time gates, which the installer
  reports and deliberately does not bypass. First, it loads project hooks only
  in a trusted project; `install` checks `~/.codex/config.toml` (or
  `CODEX_HOME`) and says when trust is missing. Second, it skips each new hook
  until the user reviews it in `/hooks`. The review stores a hash of the hook
  entry, so script edits need no new review. Codex shows `systemMessage` as a
  warning line.
- **opencode** gets a TypeScript plugin for the 2.x API (`Plugin.define`,
  `ctx.tool.hook("execute.after")`, `ctx.event.subscribe`, `ctx.session.prompt`).
  It runs the runtime with `--format json` through Bun's shell. It appends
  `context` to the tool result, wrapped in an `<agent-board-notice>` element
  that says it was not typed by the user. Subagent sessions are skipped. The
  installer warns when opencode is older than 2.x, because 1.x plugins and
  this one do not run on each other's versions.

### Verification status

- Unit and installer tests (21 in all) run with fixtures and temporary
  repositories.
- Codex `SessionStart` was exercised live through `codex app-server` in an
  isolated home with fixture data: the notice arrived as model context.
- The opencode plugin type-checks against `@opencode/plugin` 2.0.29 and loads
  in opencode 2.0.29 without errors.
- Not yet exercised with a live model: the Claude Code hooks inside a session,
  Codex `PostToolUse` and `Stop`, and the plugin's tool-result and idle paths.

## Adding a harness

Add an entry to `HARNESSES` in `install.mjs` with `detect`, `file`,
`installed`, `install`, `uninstall`, and `skillDir`. Then either emit a hook
format that the runtime's `render()` produces, or write a plugin that calls
`agent-board.mjs <mode> --format json` and injects `context`.

## Related

- [Agent board runtime](runtime.md): modes, relevance, polling, state, and output.
- [claude-mods](../claude-mods/mods-and-install.md): the other cross-harness
  installer in this repository, for skills.
