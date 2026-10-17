---
type: guide
title: Quickstart
description: Orientation for the personal setup repository, which holds claude-mods (personal mods for Claude Code, Codex, and opencode), a reusable agent board template for multi-person agent collaboration through GitHub Issues, and local setup notes for the theox repo, with common tasks and a map to the other wiki pages.
tags: [quickstart, setup, claude-mods, agent-board, theox]
sources:
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-c0fd24b01cde2609ad56ebbc
    resource: repo://agent-board/README.md
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-ad293f8b70a0ab25f2b4ed59
    resource: repo://claude-mods/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-633fea6708ae54a6b5806390
    resource: repo://theox/README.md
generated: { by: "claude-code", at: "2026-10-15T21:22:10.058Z" }
verified:
  - by: openwiki/0.5.1
    at: 2026-10-15T21:22:10.058Z
---

# Quickstart

This repository is a personal machine setup: the tools, configuration, and
quirks behind working with coding agents on this computer. It is not a
product. Each top-level folder stands on its own, and the generic folders are
meant to be reused in other projects.

| Folder | What it holds | Wiki pages |
| --- | --- | --- |
| `claude-mods/` | Personal mods written once as Claude Code skills, then installed into Claude Code and generated for Codex and opencode by `install.sh`. | [Mods and the install pipeline](claude-mods/mods-and-install.md) |
| `agent-board/` | A template for multi-person agent collaboration through a GitHub Issues board: shared conventions plus `install.mjs`, which adds board notices to Claude Code, Codex, and opencode in any project. | [Template and installer](agent-board/template-and-installer.md), [Runtime](agent-board/runtime.md) |
| `theox/` | Local quirks for working on FirstPrinciplesLabs/theox: GitHub accounts, Claude Code permissions, the agent board install, OpenWiki, shell notes. | [theox local setup](theox/local-setup.md) |
| `openwiki/` | This wiki. | — |

> **Work in progress.** When this wiki was generated, `claude-mods/` had
> uncommitted changes: the starter mod `my-mod` was moving from Claude-only
> function hooks to a portable skill (`skills/hello/`), alongside edits to
> `install.sh`, `new-mod.sh`, and the README. The wiki describes the working
> tree at that time, not the last commit.

## Common tasks

| Task | Command or place |
| --- | --- |
| Add a mod | `claude-mods/scripts/new-mod.sh [--ts] <name> "description"`, then write the script it created. |
| Install mods into every harness found | `claude-mods/install.sh` (`--list` to see what is installed, `-H codex,opencode` to limit harnesses). |
| Introduce the agent board in a project | `node agent-board/install.mjs init --project <checkout>`, then review and commit `docs/agent-board.md` and `AGENTS.md`. |
| Get board notices in your checkout | `node agent-board/install.mjs install --project <checkout> [--harness claude,codex,opencode] [--gh-user LOGIN]`; see each harness's one-time step in [the installer page](agent-board/template-and-installer.md). |
| Check the board on demand | `node agent-board/agent-board.mjs check` inside a checkout, or install the skill with `node agent-board/install.mjs skill`. |
| Run the agent board tests | `cd agent-board && node --test` |
| Use `gh` against theox | `GH_TOKEN=$(gh auth token --user fp-alexproskurin) gh …` |
| Regenerate theox's wiki | `make wiki` in `~/repos/theox` |
| Regenerate this wiki | Ask Claude Code to "update the OpenWiki" in this repo. The scheduled workflow skips until an `OPENAI_API_KEY` secret exists. |

## Things that surprise people

- The user-level Claude Code default permission mode is `auto`. Headless
  `claude -p` runs inherit it, so pass `--permission-mode default` when a run
  must stay inside an allowlist.
- `.claude/settings.local.json` is ignored globally. Other personal files that
  the agent board installs go into each clone's `.git/info/exclude`.
- Codex needs two one-time approvals before board hooks run: trust the
  project, then review the hooks in `/hooks`.
- Codex lives inside the ChatGPT app rather than on PATH. `claude-mods` and
  the agent board installer find it there; theox's `make wiki AGENT=codex`
  does not.

## Where to go next

- Writing or debugging a mod: [Mods and the install pipeline](claude-mods/mods-and-install.md).
- Introducing the agent board in a project or harness: [Template and installer](agent-board/template-and-installer.md).
- How notices are filtered, polled, stored, and rendered: [Agent board runtime](agent-board/runtime.md).
- Anything about the theox checkout on this machine: [theox local setup](theox/local-setup.md).
