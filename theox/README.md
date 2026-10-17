# theox: local setup

Quirks of this machine's setup for working on
[FirstPrinciplesLabs/theox](https://github.com/FirstPrinciplesLabs/theox)
(checkout: `~/repos/theox`). Project-wide instructions live in the theox repo
(`AGENTS.md`, `openwiki/`); this file records only what is specific to this
machine.

## GitHub accounts

- `gh` is logged in as two accounts. The active one, `alexproskurin`, can't see
  FirstPrinciplesLabs repos ("Could not resolve to a Repository").
- For `gh` against theox, prefix the command:
  `GH_TOKEN=$(gh auth token --user fp-alexproskurin) gh …`. Don't switch the
  active account.
- `git push` uses the SSH remote (`git@github.com:FirstPrinciplesLabs/theox.git`)
  and works directly.
- The GitHub login that appears on theox issues and PRs is `fp-alexproskurin`.

## Claude Code

- **`~/.claude/settings.json` sets `permissions.defaultMode: auto`.** Nested
  `claude -p` runs inherit it, and auto mode allows edits anywhere in the repo
  even with a narrow `--allowedTools` list. Always pass `--permission-mode
  default` to headless runs that must be contained. theox's `make wiki` does.
- In permission rules, `Edit(path)` covers every file-writing tool. A
  `Write(path)` rule is ignored, with a warning.
- **`~/.config/git/ignore` ignores `**/.claude/settings.local.json`**
  everywhere, so personal project settings are never committed.
- **Agent board** ([../agent-board/](../agent-board/README.md)) is installed
  for Claude Code in this checkout; from the root of this repo:
  `node agent-board/install.mjs install --project ~/repos/theox --harness claude --gh-user fp-alexproskurin`.
  The settings live in `.git/agent-board/config.json`; the conventions are
  theox's `docs/agent-board.md` (PR #43).

## OpenWiki

- `openwiki@0.5.1` is installed globally under nvm Node 22.16.
- The Claude Code integration is installed at user level: MCP server `openwiki`
  (`openwiki mcp --host claude`) and the skill in `~/.claude/skills/openwiki`.
- **Regenerate theox's wiki** with `make wiki` in the checkout. It uses Claude
  Code and your session, so no API key. `make wiki-verify` checks the result.
- `make wiki AGENT=codex` currently fails here: Codex is only inside the
  ChatGPT app (`/Applications/ChatGPT.app/Contents/Resources/codex`), not on
  PATH. Add it to PATH, or teach the Makefile a `CODEX_BIN` override, as
  `claude-mods/install.sh` does.
- `openwiki visualize` serves a local view at `http://127.0.0.1:4321`.
- `openwiki "<question>"` (OpenWiki's own agent) needs `OPENAI_API_KEY`; run it
  in a real terminal once to save credentials. The `!` prefix in Claude Code
  runs it without a terminal, so it fails there.
- theox's scheduled `openwiki-update.yml` skips generation until an
  `OPENAI_API_KEY` secret exists; the decision is open in PR #42.

## Shell notes (macOS)

- There is no `timeout` command; use the tool's own timeout instead.
- zsh doesn't split unquoted variables into words: `cmd $ARGS` passes one
  argument, and `for c in "issue view"; do gh $c; done` runs `gh "issue view"`.
  Use arrays (`cmd "${ARGS[@]}"`) or write the command out.
- `/bin/bash` is 3.2, but `bash` on PATH is 5.3 (Homebrew). Scripts with
  `#!/usr/bin/env bash` get 5.3; avoid bash-4-only syntax anyway.
