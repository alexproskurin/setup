---
name: hello
description: Say hello from a script. Use when the user asks to say hello or to test that mods work.
argument-hint: "[name]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/hello.ts *)
---

!`${CLAUDE_SKILL_DIR}/scripts/hello.ts $ARGUMENTS`

Reply with the output above exactly as printed, and nothing else.
