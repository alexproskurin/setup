# claude-mods

Personal mods for **Claude Code, Codex and opencode**, written once.

For each mod you write two things:

- a Claude Code `SKILL.md`, whose `` !`…` `` line runs your code;
- the code itself, in any language (TypeScript via `bun` works).

`install.sh` installs that into Claude Code and generates the Codex and opencode versions. This folder lives inside the `setup` repo.

```
claude-mods/
├── .claude-plugin/marketplace.json     # lists every mod
├── mods/
│   └── my-mod/
│       ├── .claude-plugin/plugin.json
│       └── skills/hello/
│           ├── SKILL.md                # the definition (Claude Code format)
│           └── scripts/hello.ts        # the code
├── build/                              # generated for Codex/opencode (gitignored)
├── install.sh                          # check, generate and install
├── scripts/new-mod.sh                  # scaffold a new mod
├── AGENTS.md                           # context for agents
└── CLAUDE.md                           # imports AGENTS.md
```

## Add a mod

```sh
scripts/new-mod.sh --ts standup "Summarize today's commits"   # TypeScript script (bun)
scripts/new-mod.sh standup "Summarize today's commits"        # bash script
```

That creates `mods/standup/skills/standup/SKILL.md`:

```markdown
---
name: standup
description: "Summarize today's commits"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/standup.ts *)
---

!`${CLAUDE_SKILL_DIR}/scripts/standup.ts $ARGUMENTS`

Reply with the output above exactly as printed, and nothing else.
```

Write the code in `scripts/standup.ts`. Change the last line if you want the model to do more with the output (for example, "Summarize this as three bullets").

## Install

```sh
./install.sh                    # check, generate and install every mod into every harness found
./install.sh standup            # just these mods
./install.sh -H codex,opencode  # just these harnesses
./install.sh --list             # what's installed where
./install.sh --uninstall standup
```

| Harness | Gets | Use it | After editing SKILL.md |
|---|---|---|---|
| Claude Code | the mod as a plugin (the source itself) | `/my-mod:hello` | `/reload-plugins` |
| Codex | a generated skill in `~/.agents/skills` | `$hello`, or just ask | re-run `./install.sh` |
| opencode | the same skill, plus a generated command in `~/.config/opencode/commands` | `/hello` | re-run `./install.sh` |

Script edits take effect everywhere immediately. In Claude Code and opencode, the `` !`…` `` line runs before the model sees anything. Codex has no command files, so its generated skill tells the model to run the same command. In all three, the model then relays the output.

## Permissions

- **Claude Code:** `` !`…` `` commands must be allowed by the skill's `allowed-tools` or by your permission rules. Otherwise the skill aborts.
- **opencode:** the command's `` !`…` `` runs outside opencode's permission system.
- **Codex:** the command runs under Codex's normal sandbox and approval rules.

Review mods before installing them.

## Share

The marketplace file has to be at the root of a git repo for `/plugin install … --marketplace <owner>/<repo>` to work, so publish `claude-mods/` as its own repo to share it.
