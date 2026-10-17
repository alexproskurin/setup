---
type: reference
title: theox Local Setup
description: Machine-specific facts for working on FirstPrinciplesLabs/theox from this computer, covering GitHub account selection, Claude Code permission and settings quirks, OpenWiki tooling and regeneration, where Codex and opencode live, and macOS shell pitfalls.
tags: [theox, local-setup, github, claude-code, openwiki, macos]
verified:
  - by: openwiki/0.5.1
    at: 2026-10-15T21:22:10.058Z
sources:
  - id: openwiki-source-633fea6708ae54a6b5806390
    resource: repo://theox/README.md
generated: { by: "claude-code", at: "2026-10-15T21:22:10.058Z" }
---

# theox Local Setup

`theox/README.md` records what is specific to this machine when working on
[FirstPrinciplesLabs/theox](https://github.com/FirstPrinciplesLabs/theox)
(checkout `~/repos/theox`). Project-wide rules belong in the theox repo itself
(`AGENTS.md`, its `openwiki/`); this page summarizes only the local layer.

## GitHub accounts

| Need | Do this |
| --- | --- |
| `gh` against theox | Prefix with `GH_TOKEN=$(gh auth token --user fp-alexproskurin)`. The active account `alexproskurin` cannot see FirstPrinciplesLabs repos. Don't switch the active account. |
| `git push` | Works directly over the SSH remote. |
| Identity on issues and PRs | `fp-alexproskurin` |

The [agent board](../agent-board/template-and-installer.md) uses the same
pattern internally (`ghUser: fp-alexproskurin` in its settings).

## Claude Code

- **User-level `permissions.defaultMode: auto`.** Headless `claude -p` runs
  inherit it, and auto mode lets edits through anywhere in the repo even
  with a narrow `--allowedTools` allowlist. Pass `--permission-mode default`
  to any headless run that must be contained; theox's `make wiki` does.
- **Path rules:** `Edit(path)` covers every file-writing tool; `Write(path)`
  rules are ignored (with a warning).
- **Global git ignore:** `~/.config/git/ignore` ignores
  `**/.claude/settings.local.json`, so personal per-project settings, such as
  the agent board hooks, are never committed.
- **Agent board:** this checkout has the generic agent board installed for
  Claude Code only, from the setup repo root with
  `node agent-board/install.mjs install --project ~/repos/theox --harness claude --gh-user fp-alexproskurin`.
  Its settings live in `.git/agent-board/config.json`; the team conventions
  are theox's `docs/agent-board.md` (PR #43).

## OpenWiki

- `openwiki@0.5.1` is installed globally under nvm Node 22.16. Its Claude Code
  integration is installed at user level: MCP server `openwiki`
  (`openwiki mcp --host claude`) and skill `~/.claude/skills/openwiki`.
- **Regenerating theox's wiki:** `make wiki` in the checkout drives Claude
  Code with your session (no API key) and ends with `make wiki-verify`.
- **Codex** is installed only inside the ChatGPT app
  (`/Applications/ChatGPT.app/Contents/Resources/codex`), not on PATH, so
  `make wiki AGENT=codex` fails until it is on PATH or the Makefile learns a
  `CODEX_BIN` override, as [claude-mods' installer](../claude-mods/mods-and-install.md)
  already does. opencode is at `~/.opencode/bin/opencode`.
- `openwiki visualize` serves `http://127.0.0.1:4321`.
- `openwiki "<question>"` runs OpenWiki's own agent and needs
  `OPENAI_API_KEY`; save it once in a real terminal (the `!` prefix in Claude
  Code runs commands without a terminal).
- theox's scheduled `openwiki-update.yml` skips generation until an
  `OPENAI_API_KEY` secret exists; that decision is open in theox PR #42.

## macOS shell notes

- No `timeout` command; rely on the calling tool's timeout.
- zsh does not word-split unquoted variables: `cmd $ARGS` passes one
  argument, and `gh $c` with `c="issue view"` runs `gh "issue view"`. Use
  arrays (`"${ARGS[@]}"`) or spell the command out.
- `/bin/bash` is 3.2, while `bash` on PATH is Homebrew's 5.3. Scripts using
  `#!/usr/bin/env bash` get 5.3, but avoid bash-4-only syntax for safety.
