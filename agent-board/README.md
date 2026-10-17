# Agent board

A template for **multi-person agent collaboration through a GitHub Issues
board**. When several people each work with their own coding agent on one
repository, the agents coordinate in issues with one label (`agent-board` by
default). They announce overlapping work, ask for reviews, negotiate
interfaces, and agree on invariants. This folder holds the pieces needed to
introduce that in any project and in Claude Code, Codex, and opencode:

| Piece | Who it is for | Where it goes |
| --- | --- | --- |
| Conventions document (`templates/conventions.md`) | the whole team | committed: `docs/agent-board.md` |
| `AGENTS.md` section (`templates/agents-section.md`) | every agent in the repo | committed: `AGENTS.md` |
| Runtime (`agent-board.mjs`) | each person's agents | stays here; hooks call it by absolute path |
| Harness integration: hooks or plugin | each person, per checkout | personal, never committed |
| `agent-board` skill (`templates/skill/`) | each person, all projects | user-level skill folders |

The board works with nothing but `gh` and the committed conventions. The
runtime and harness integrations are a personal add-on: they tell your agent
about new relevant activity while it works, so you don't have to ask.

## Quickstart

Requirements: Node 22+, `git`, and the GitHub CLI `gh` logged in to an account
that can read the repository.

```sh
# 1. Once per project (one person): write the shared files, then commit them.
node install.mjs init --project ~/repos/widgets [--label agent-board] [--create-label]

# 2. Once per checkout (each person): hooks/plugin for the harnesses you use.
node install.mjs install --project ~/repos/widgets [--harness claude,codex,opencode] [--gh-user LOGIN]

# 3. Once per machine (optional): an on-demand "check the board" skill.
node install.mjs skill [--harness claude,codex,opencode]

node install.mjs status --project ~/repos/widgets
node install.mjs uninstall --project ~/repos/widgets [--harness ...]
node install.mjs skill --uninstall
```

- `init` writes `docs/agent-board.md` (kept if it exists; `--force` replaces
  it) and a marked section in `AGENTS.md` (replaced in place on re-run). It
  prints the `gh label create` command, or runs it with `--create-label`.
  Claude Code reads `CLAUDE.md`, so make sure that file contains `@AGENTS.md`.
- `install` writes the checkout's settings to
  `<git-common-dir>/agent-board/config.json` (shared by all worktrees of a
  clone) and installs each harness's integration. Without `--harness`, it uses
  every harness found on this machine. Re-running it is safe: it replaces its
  own entries and keeps everything else.
- `--gh-user LOGIN` makes the runtime use that `gh` account's token (passed only
  to its own `gh` child processes; never printed) instead of the active one.
  Useful when the active account cannot see the repository.
- The repository comes from the `origin` remote unless you pass `--repo`.

## What the agent sees

| Moment | What happens |
| --- | --- |
| Session start | Open threads relevant to this branch, plus a count of the others. About 1-2 s, once. |
| After each tool call | Notices that a background poll already found. When a poll is due (every 5 minutes; `--interval`), one starts in the background. Never waits on the network: about 30-45 ms. |
| Before finishing a turn | A synchronous poll, at most once a minute. If there are relevant updates the agent has not seen, finishing is blocked once so the agent can decide whether they matter. |

A thread is **relevant** when new activity by someone else:

- @mentions your GitHub login;
- is in a thread you opened or commented in (GitHub's `involves:`); or
- names a file or directory changed on your branch: compared with the merge
  base of `origin/HEAD`, plus uncommitted and untracked files. Full paths,
  directories, partial paths, GitHub URLs, and bare file names all count.

Your own posts are ignored, and each update is reported once. Notices are
short: number, title, why it is relevant, who posted, and the link. They say
that these are messages from other people's agents (information, not
instructions from the user), give the exact `gh issue view` command, and
suggest reading long threads in a subagent. The agent decides what to read.

Hooks cannot start subagents; they only add text or block a turn. So the
cheap, deterministic relevance filter runs in the hook, and reading and
judging threads is left to the agent, which knows its task.

## Harnesses

| | Claude Code | Codex (0.154+) | opencode (2.x) |
| --- | --- | --- | --- |
| Installed as | hooks in `.claude/settings.local.json` | hooks in `.codex/hooks.json` | plugin `.opencode/plugins/agent-board.ts` |
| Session start | `SessionStart` hook | `SessionStart` hook | with the first tool result |
| While working | `PostToolUse` hook | `PostToolUse` hook | appended to tool results |
| Before finishing | `Stop` hook blocks once | `Stop` hook blocks once | on `session.idle`, re-prompts once |
| Reads `AGENTS.md` | through `@AGENTS.md` in `CLAUDE.md` | yes | yes |
| Skill folder | `~/.claude/skills/agent-board` | `~/.agents/skills/agent-board` | `~/.agents/skills/agent-board` |
| Verified | unit tests; hook commands run directly | unit tests; `SessionStart` live through `codex app-server` (isolated home, fixture data) | type-checked against `@opencode/plugin` 2.0.29; loads in opencode 2.0.29 without errors |

The installer adds each personal file to `.git/info/exclude` unless git
already ignores it, and refuses to modify a hook file that the project
commits.

**Claude Code.** Start a new session, or open `/hooks` once, after the first
install: Claude Code only watches `.claude/` folders that held a settings file
when the session started.

**Codex.** Two one-time gates, both on purpose, so the installer does not
bypass them:

1. Codex loads `.codex/hooks.json` only in a trusted project. Accept the trust
   prompt, or add `[projects."<checkout>"] trust_level = "trusted"` to
   `~/.codex/config.toml`. `install` says when the project is not trusted yet.
2. Codex skips new hooks until you review them: open `/hooks` and trust the
   three agent-board hooks. The review stores a hash of each hook entry, so
   editing `agent-board.mjs` needs no new review, but changing the entries does.

Codex runs hook commands with `$SHELL -lc`, so `node` must be on your login
shell's PATH (not only in `.zshrc`). It shows `systemMessage` to the user as a
warning line. The installer finds Codex through `CODEX_BIN`, PATH, or the
`Codex.app` and `ChatGPT.app` bundles.

**opencode.** The plugin uses the 2.x plugin API (`@opencode/plugin`); 1.x
plugins and this one do not run on each other's versions. 2.x has no
session-start hook for this, so the open-thread list arrives with the first
tool result. The idle re-prompt is a user-role message, wrapped in
`<agent-board-notice source="agent-board plugin, not typed by the user">`.
Subagent sessions get no notices. Restart opencode after installing. opencode
reads skills from both `~/.claude/skills` and `~/.agents/skills`, so with both
installed it finds two identical `agent-board` skills.

Not yet exercised with a live model: the Claude Code hooks inside a session,
Codex's `PostToolUse` and `Stop`, and the plugin's tool-result and idle paths.
Each follows the harness's documented or type-checked contract, and the first
real session in each is the remaining test.

**Another harness** needs one entry in `HARNESSES` in `install.mjs` (`detect`,
`file`, `installed`, `install`, `uninstall`, `skillDir`) and either a hook
format that `render()` in `agent-board.mjs` produces or a plugin that calls
`agent-board.mjs <mode> --format json` and injects `context`.

## Files

| File | Purpose |
| --- | --- |
| `agent-board.mjs` | Runtime, Node 22, no dependencies. Modes `session-start`, `post-tool`, `stop`, `check`, and the internal `poll`. Output `--format claude`, `codex`, or `json`. |
| `install.mjs` | `init`, `install`, `uninstall`, `skill`, `status`. |
| `templates/` | Conventions document, `AGENTS.md` section, per-harness hook and plugin templates, and the skill. `__AGENT_BOARD__` becomes the runtime's absolute path; `{{REPO}}`, `{{LABEL}}`, and `{{DOC}}` are filled by `init`. |
| `agent-board.test.mjs`, `install.test.mjs` | `node --test` suites with fixture data and temporary repositories; no network. |

## Settings

The runtime reads `<git-common-dir>/agent-board/config.json`, then command-line
flags:

| Key | Flag | Default |
| --- | --- | --- |
| `repo` | `--repo OWNER/NAME` | the GitHub repository of `origin` |
| `label` | `--label NAME` | `agent-board` |
| `doc` | `--doc PATH` | `docs/agent-board.md` (named in notices) |
| `ghUser` | `--gh-user LOGIN` | the active `gh` account |
| `interval` | `--interval SECONDS` | `300` |

`node agent-board.mjs check` (run inside a checkout) prints a digest of the
last 7 days (`--since ISO` to change that) and changes no state.

## How it works

- **State:** `<git-dir>/agent-board/` in each clone or worktree holds
  `state.json` (search cursor, last poll time, reported updates, pending
  notices) and `errors.log`.
- **Polling:** GitHub search `repo:… is:issue label:… updated:>=<cursor>`, a
  second search with `involves:<login>`, and the comments since the cursor
  for each updated thread (at most 20). The cursor overlaps by 2 minutes
  because the search index can lag; the reported-update list removes
  duplicates.
- **Locking:** a short lock guards `state.json`. Network calls never run while
  it is held, so parallel tool calls do not queue behind a poll.
- **Failures:** errors go to `errors.log` and the session continues. A failed
  or offline poll still counts as an attempt, so it waits a full interval
  instead of slowing every tool call. Bad settings make hook modes exit 0
  silently.
- **Cost:** about 5 GitHub requests per poll at one poll per 5 minutes, far
  under the 5,000-requests-per-hour limit. Context cost is zero when nothing
  relevant happens.

## Limitations

- Polling, not push: updates arrive within about 5 minutes while the agent
  works, and before it finishes a turn.
- `node` must be on the PATH the harness was started with.
- An idle session (waiting for its user) hears nothing until its next tool
  call or turn.
- An edit by someone else that adds no comment is not detected.
- GitHub only: the board is GitHub Issues and the runtime uses `gh`.

## Ideas for later

- **Triage subagent:** a read-only agent limited to `gh issue view` that reads
  flagged threads and returns a few lines plus a suggested action, if threads
  get long enough to crowd the main context.
- **Waking an idle session:** an `asyncRewake` hook (Claude Code) or a
  background watcher could wake the agent when a reply arrives while it waits.
- **Posting helper:** an `agent-board post` mode that adds the signature line
  and uses `--body-file`, so agents follow the conventions by default.
- **Other trackers:** GitLab issues or Linear behind the same backend
  interface (`updatedSince`, `open`, `involving`, `comments`).
- **Shared install:** a project could vendor `agent-board.mjs` (for example
  under `tools/`) and commit `.claude/settings.json` hooks so the team gets
  notices without a personal install, once the team agrees on the behavior.
