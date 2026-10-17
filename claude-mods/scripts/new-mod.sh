#!/usr/bin/env bash
# Scaffold a new mod under mods/<name> and list it in the marketplace.
#
# Usage: scripts/new-mod.sh [--ts] <name> ["one-line description"]
#
# Creates the only two files you write: a Claude Code SKILL.md whose !`…` line runs
# the script, and the script itself (bash, or TypeScript run by bun with --ts).
# install.sh generates the Codex and opencode versions from them.
set -euo pipefail

ts=0
if [[ "${1:-}" == "--ts" ]]; then ts=1; shift; fi

name="${1:?usage: scripts/new-mod.sh [--ts] <name> [\"description\"]}"
description="${2:-TODO: describe $name}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/mods/$name"
marketplace="$root/.claude-plugin/marketplace.json"

if [[ ! "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "name must be kebab-case (a-z, 0-9, single hyphens)" >&2
  exit 1
fi
if [[ -e "$dir" ]]; then
  echo "$dir already exists" >&2
  exit 1
fi

mkdir -p "$dir/.claude-plugin" "$dir/skills/$name/scripts"

jq -n --arg name "$name" --arg description "$description" \
  '{ name: $name, version: "0.1.0", description: $description, author: { name: "Alex Proskurin" } }' \
  > "$dir/.claude-plugin/plugin.json"

# The code: any language, runnable on its own.
if [[ $ts -eq 1 ]]; then
  script="$name.ts"
  cat > "$dir/skills/$name/scripts/$script" <<EOF
#!/usr/bin/env bun
// $description
const args = process.argv.slice(2).join(' ')

console.log(\`$name ran with args: \${args}\`)
EOF
else
  script="$name"
  cat > "$dir/skills/$name/scripts/$script" <<EOF
#!/usr/bin/env bash
# $description
set -euo pipefail

echo "$name ran with args: \$*"
EOF
fi
chmod +x "$dir/skills/$name/scripts/$script"

# The definition, in Claude Code's format. The !\`…\` line runs before the model sees anything.
{
  printf -- '---\nname: %s\ndescription: %s\nallowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/%s *)\n---\n\n' \
    "$name" "$(jq -n --arg d "$description" '$d')" "$script"
  printf '!`${CLAUDE_SKILL_DIR}/scripts/%s $ARGUMENTS`\n\n' "$script"
  printf 'Reply with the output above exactly as printed, and nothing else.\n'
} > "$dir/skills/$name/SKILL.md"

tmp="$(mktemp)"
jq --arg name "$name" --arg description "$description" \
  '.plugins += [{ name: $name, source: ("./mods/" + $name), description: $description }]' \
  "$marketplace" > "$tmp" && mv "$tmp" "$marketplace"

echo "Created mods/$name and listed it in .claude-plugin/marketplace.json"
echo "Definition: mods/$name/skills/$name/SKILL.md"
echo "Code:       mods/$name/skills/$name/scripts/$script"
echo "Install:    $root/install.sh $name"
