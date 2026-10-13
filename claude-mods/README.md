# claude-mods

Personal Claude Code mods (function-hook plugins). Each mod lives in its own folder under `mods/`, and the repo root is a plugin marketplace that lists them all.

```
claude-mods/
├── .claude-plugin/marketplace.json   # lists every mod in mods/
├── mods/
│   └── my-mod/
│       ├── .claude-plugin/plugin.json
│       └── hooks/
│           ├── hooks.json            # { "modules": ["./register.ts"] }
│           ├── register.ts           # the code
│           └── register.test.ts      # claude plugin test
└── scripts/new-mod.sh                # scaffold a new mod
```

## Add a mod

```sh
scripts/new-mod.sh standup "Summarize today's commits"
```

This creates `mods/standup/` with a `/standup` command stub and adds it to the marketplace.

## Develop

Load a mod straight from its folder. It reloads every time you save:

```sh
claude --plugin-dir mods/my-mod            # repeat --plugin-dir for several mods
claude --debug --plugin-dir mods/my-mod    # see skipped hooks and refused results
```

Check it before loading:

```sh
claude plugin validate mods/my-mod   # what it hooks and calls, and what the engine would refuse
claude plugin test mods/my-mod       # runs hooks/*.test.ts
claude plugin validate .             # the marketplace file
```

Type definitions are generated in `mods/<mod>/.claude-plugin/types/` the first time Claude Code loads the mod (gitignored). After that, `tsc -p mods/<mod>` type-checks it.

## Use them every day

Add this folder as a local marketplace once, then install the mods you want:

```sh
claude plugin marketplace add ~/repos/claude-mods
claude plugin install my-mod@claude-mods
```

Mods installed this way are read straight from this folder: after an edit, run `/reload-plugins` in a session.

## Share

Push to GitHub, and anyone can install a mod with:

```
/plugin install my-mod --marketplace <owner>/claude-mods
```

## Permissions

A mod's `$.process.run`, `$.process.spawn` and `$.fs` calls run as your OS user. They do **not** go through Claude's allow/deny rules or permission prompts. Calls made through `$.tool.call(...)` do go through them. Review any mod before installing it.
