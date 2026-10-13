#!/usr/bin/env bash
# Scaffold a new mod under mods/<name> and list it in the marketplace.
# Usage: scripts/new-mod.sh <name> ["one-line description"]
set -euo pipefail

name="${1:?usage: scripts/new-mod.sh <name> [\"description\"]}"
description="${2:-TODO: describe $name}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/mods/$name"
marketplace="$root/.claude-plugin/marketplace.json"

if [[ ! "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "name must be kebab-case (a-z, 0-9, -)" >&2
  exit 1
fi
if [[ -e "$dir" ]]; then
  echo "$dir already exists" >&2
  exit 1
fi

mkdir -p "$dir/.claude-plugin" "$dir/hooks"
description_literal="$(jq -n --arg d "$description" '$d')"

jq -n --arg name "$name" --arg description "$description" \
  '{ name: $name, version: "0.1.0", description: $description, author: { name: "Alex Proskurin" } }' \
  > "$dir/.claude-plugin/plugin.json"

echo '{ "modules": ["./register.ts"] }' > "$dir/hooks/hooks.json"

cat > "$dir/hooks/register.ts" <<EOF
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async (\$, e, next) => {
    await \$.command.register({ name: '$name', description: $description_literal })

    return next(e)
  })

  on('command.run', { command: '$name' }, async (\$, e) => {
    return { text: \`$name ran with args: \${e.args}\` }
  })
}
EOF

tmp="$(mktemp)"
jq --arg name "$name" --arg description "$description" \
  '.plugins += [{ name: $name, source: ("./mods/" + $name), description: $description }]' \
  "$marketplace" > "$tmp" && mv "$tmp" "$marketplace"

echo "Created mods/$name and listed it in .claude-plugin/marketplace.json"
echo "Try it:  claude --plugin-dir $dir"
