#!/usr/bin/env bash
# Install the mods in this folder into Claude Code, Codex and opencode.
#
# Each mod is written once, in Claude Code's format: mods/<mod>/skills/<skill>/SKILL.md,
# whose !`…` lines run your code (scripts next to it, any language). Claude Code uses
# that as-is; the Codex and opencode versions are generated into build/ on every run.
#
# Usage:
#   ./install.sh                  check, generate and install every mod into every harness found
#   ./install.sh my-mod other     only these mods
#   ./install.sh --uninstall [mod...]
#   ./install.sh --list           show each mod and where it is installed
#
# Options:
#   -H, --harness <list>   comma-separated: claude,codex,opencode (default: each one installed)
#   -s, --scope <scope>    Claude Code scope: user (default), project or local
#   --skip-checks          skip validation and tests
#   -h, --help
#
# Where things go:
#   Claude Code  the mod as a plugin from .claude-plugin/marketplace.json, read in place
#   Codex        build/agents/skills/<skill> linked into ~/.agents/skills (opencode reads it too)
#   opencode     build/opencode/commands/<skill>.md linked into ~/.config/opencode/commands
# Re-run after editing a mod: the generated files are rebuilt from the source.
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
marketplace_file="$root/.claude-plugin/marketplace.json"
build="$root/build"

action=install
scope=user
run_checks=1
harness_arg=""
mods=()

usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "error: $*" >&2; exit 1; }
warn() { echo "warning: $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--uninstall) action=uninstall ;;
    -l|--list) action=list ;;
    -H|--harness) harness_arg="${2:?--harness needs a value}"; shift ;;
    -s|--scope) scope="${2:?--scope needs a value}"; shift ;;
    --skip-checks) run_checks=0 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) mods+=("$1") ;;
  esac
  shift
done

command -v jq >/dev/null || die "jq not found (brew install jq)"
command -v perl >/dev/null || die "perl not found"
[[ "$scope" =~ ^(user|project|local)$ ]] || die "scope must be user, project or local"
[[ -f "$marketplace_file" ]] || die "$marketplace_file not found"

# --- Harnesses ---------------------------------------------------------------

claude_bin="$(command -v claude || true)"
codex_bin="${CODEX_BIN:-$(command -v codex || true)}"
for candidate in /Applications/ChatGPT.app/Contents/Resources/codex /Applications/Codex.app/Contents/Resources/codex; do
  [[ -z "$codex_bin" && -x "$candidate" ]] && codex_bin="$candidate"
done
opencode_bin="$(command -v opencode || true)"
[[ -z "$opencode_bin" && -x "$HOME/.opencode/bin/opencode" ]] && opencode_bin="$HOME/.opencode/bin/opencode"

agents_skills="$HOME/.agents/skills"
opencode_commands="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/commands"

harness_bin() {
  case "$1" in
    claude) echo "$claude_bin" ;;
    codex) echo "$codex_bin" ;;
    opencode) echo "$opencode_bin" ;;
  esac
}

harnesses=()
if [[ -n "$harness_arg" ]]; then
  IFS=',' read -r -a harnesses <<<"$harness_arg"
  for h in "${harnesses[@]}"; do
    [[ "$h" =~ ^(claude|codex|opencode)$ ]] || die "unknown harness '$h' (claude, codex, opencode)"
    [[ -n "$(harness_bin "$h")" ]] || die "$h was asked for but is not installed"
  done
else
  for h in claude codex opencode; do
    [[ -n "$(harness_bin "$h")" ]] && harnesses+=("$h")
  done
fi
[[ ${#harnesses[@]} -gt 0 ]] || die "none of claude, codex or opencode was found"
uses() { [[ " ${harnesses[*]} " == *" $1 "* ]]; }

# --- Mods --------------------------------------------------------------------

marketplace="$(jq -r .name "$marketplace_file")"
listed=()
while IFS= read -r name; do listed+=("$name"); done < <(jq -r '.plugins[].name' "$marketplace_file")
is_listed() { local m; for m in ${listed[@]+"${listed[@]}"}; do [[ "$m" == "$1" ]] && return 0; done; return 1; }

# Folders under mods/ the marketplace doesn't list would silently never install.
for dir in "$root"/mods/*/; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  is_listed "$name" || warn "mods/$name is not listed in .claude-plugin/marketplace.json (scripts/new-mod.sh adds it)"
done

[[ ${#mods[@]} -gt 0 ]] || mods=("${listed[@]}")
for mod in "${mods[@]}"; do
  is_listed "$mod" || die "'$mod' is not listed in .claude-plugin/marketplace.json"
done

skill_dirs() { local d; for d in "$root/mods/$1"/skills/*/; do [[ -f "$d/SKILL.md" ]] && echo "${d%/}"; done; return 0; }

# A frontmatter field of a SKILL.md, as written (quotes kept, so it stays valid YAML).
skill_field() { awk -v key="$2" '/^---$/{n++; next} n==1 && index($0, key ":")==1 {sub(/^[^:]*:[ ]*/, ""); print; exit}' "$1/SKILL.md"; }
# Everything after the frontmatter.
skill_body() { awk 'n>=2 {print; next} /^---$/{n++}' "$1/SKILL.md"; }
# The !`…` commands in a SKILL.md body (Claude runs them before the model sees the skill).
bang_commands() { skill_body "$1" | perl -ne 'print "$2\n" while /(^|\s)!`([^`]+)`/g'; }

# --- Generation: Claude Code SKILL.md -> Codex / opencode ------------------------

# Claude's path variables become absolute paths, since no other harness knows them.
substitute_paths() {
  SKILL_DIR="$1" MOD_DIR="$2" perl -pe '
    s/\$\{CLAUDE_SKILL_DIR\}/$ENV{SKILL_DIR}/g;
    s/\$\{CLAUDE_PLUGIN_ROOT\}/$ENV{MOD_DIR}/g;
    s/\$\{CLAUDE_PROJECT_DIR\}/./g;'
}

generated_note() { echo "<!-- generated by install.sh from ${1#"$root"/}/SKILL.md; edit the source, then re-run install.sh -->"; }

# For Codex and opencode's skill tool. They don't run !`…`, so each becomes an instruction
# for the model to run the command itself.
render_agents_skill() {
  local skill="$1" mod_dir="$2" out="$3"
  mkdir -p "$out"
  {
    printf -- '---\nname: %s\ndescription: %s\n---\n\n' "$(skill_field "$skill" name)" "$(skill_field "$skill" description)"
    generated_note "$skill"
    if [[ -n "$(bang_commands "$skill")" ]]; then
      echo
      echo 'First run each command marked **Run:** below in a shell, from the project root, and use its output as if it appeared in place of that line. In those commands `$ARGUMENTS` stands for everything the user wrote after naming this skill (shell-quoted; nothing if they wrote nothing), and `$0`, `$1`, … for its first, second, … word.'
    fi
    skill_body "$skill" | substitute_paths "$skill" "$mod_dir" | perl -pe 's/(^|\s)!`([^`]+)`/$1**Run:** `$2`/g'
  } > "$out/SKILL.md"
}

# An opencode command keeps the !`…` lines: opencode runs them the same way Claude does.
# Claude numbers arguments from $0, opencode from $1.
render_opencode_command() {
  local skill="$1" mod_dir="$2" out="$3"
  mkdir -p "$(dirname "$out")"
  {
    printf -- '---\ndescription: %s\n---\n' "$(skill_field "$skill" description)"
    generated_note "$skill"
    skill_body "$skill" | substitute_paths "$skill" "$mod_dir" |
      perl -pe 's/(?<!\\)\$(?:ARGUMENTS\[(\d+)\]|(\d+))/"\$" . ((defined $1 ? $1 : $2) + 1)/ge'
  } > "$out"
}

generate_mod() {
  local mod="$1" skill name
  while IFS= read -r skill; do
    [[ -n "$skill" ]] || continue
    name="$(basename "$skill")"
    rm -rf "$build/agents/skills/$name" "$build/opencode/commands/$name.md"
    render_agents_skill "$skill" "$root/mods/$mod" "$build/agents/skills/$name"
    render_opencode_command "$skill" "$root/mods/$mod" "$build/opencode/commands/$name.md"
  done < <(skill_dirs "$mod")
}

# --- Links into the harnesses' folders ------------------------------------------

owned() { [[ -L "$1" && "$(readlink "$1")" == "$build/"* ]]; }

link() {
  local target="$1" link_path="$2"
  mkdir -p "$(dirname "$link_path")"
  if [[ -e "$link_path" || -L "$link_path" ]] && ! owned "$link_path"; then
    warn "$link_path already exists and isn't ours; left alone"
    return 1
  fi
  ln -sfn "$target" "$link_path"
}

unlink_owned() { if owned "$1"; then rm "$1"; echo "Removed $1"; fi; return 0; }

# --- Installed state -----------------------------------------------------------

claude_installed=""
uses claude && claude_installed="$("$claude_bin" plugin list --json | jq -r '.[].id')"

in_claude() { grep -qx "$1@$marketplace" <<<"$claude_installed"; }
all_skills_linked() {  # <mod> <dir> <suffix>
  local skill found=1
  while IFS= read -r skill; do
    [[ -n "$skill" ]] || continue
    owned "$2/$(basename "$skill")$3" || return 1
    found=0
  done < <(skill_dirs "$1")
  return $found
}
in_codex() { all_skills_linked "$1" "$agents_skills" ""; }
in_opencode() { all_skills_linked "$1" "$agents_skills" "" && all_skills_linked "$1" "$opencode_commands" ".md"; }

# --- Checks --------------------------------------------------------------------

check_skill() {
  local dir="$1" name description cmd exe
  name="$(skill_field "$dir" name)"
  description="$(skill_field "$dir" description)"
  # opencode is the strictest: name required, kebab-case, equal to the folder name.
  [[ "$name" == "$(basename "$dir")" ]] || die "$dir/SKILL.md: name '$name' must equal the folder name"
  [[ "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "$dir/SKILL.md: name must be kebab-case"
  [[ -n "$description" ]] || die "$dir/SKILL.md: description is required"

  while IFS= read -r cmd; do
    [[ -n "$cmd" ]] || continue
    exe="$(substitute_paths "$dir" "$(dirname "$(dirname "$dir")")" <<<"${cmd%% *}")"
    if [[ "$exe" == /* && ! -x "$exe" ]]; then die "$dir/SKILL.md runs $exe, which is missing or not executable"; fi
  done < <(bang_commands "$dir")

  if [[ -n "$(bang_commands "$dir")" && -z "$(skill_field "$dir" allowed-tools)" ]]; then
    warn "$dir/SKILL.md has !\`…\` lines but no allowed-tools; Claude Code aborts them unless your permission rules allow the command"
  fi
  if grep -q '^```!' "$dir/SKILL.md"; then warn "$dir/SKILL.md: \`\`\`! blocks are Claude-only; use inline !\`…\` lines so they're translated"; fi
  if [[ -n "$(skill_field "$dir" arguments)" ]]; then warn "$dir/SKILL.md: named arguments are Claude-only; use \$ARGUMENTS or \$0, \$1, …"; fi
  return 0
}

run_checks_for() {
  local mod="$1" dir="$root/mods/$1" skill
  echo "Checking ${mod}…"
  while IFS= read -r skill; do [[ -n "$skill" ]] && check_skill "$skill"; done < <(skill_dirs "$mod")
  if [[ -n "$claude_bin" ]]; then
    "$claude_bin" plugin validate "$dir" >/dev/null || { "$claude_bin" plugin validate "$dir" || true; die "$mod failed validation"; }
    if compgen -G "$dir/hooks/*.test.ts" >/dev/null || compgen -G "$dir/hooks/*.test.tsx" >/dev/null; then
      "$claude_bin" plugin test "$dir" >/dev/null 2>&1 || { "$claude_bin" plugin test "$dir" || true; die "$mod tests failed"; }
    fi
  fi
}

# Codex and opencode share ~/.agents/skills, so skill names must be unique across mods.
check_unique_skills() {
  local seen=" " mod skill name
  for mod in "${listed[@]}"; do
    while IFS= read -r skill; do
      [[ -n "$skill" ]] || continue
      name="$(basename "$skill")"
      [[ "$seen" == *" $name "* ]] && die "skill '$name' is defined by more than one mod"
      seen+="$name "
    done < <(skill_dirs "$mod")
  done
}

# --- Actions -------------------------------------------------------------------

mark() { if "$@"; then printf '✔'; else printf '·'; fi; }

case "$action" in
  list)
    printf '%-24s' "mod"; for h in "${harnesses[@]}"; do printf '%-10s' "$h"; done; echo
    for mod in "${listed[@]}"; do
      printf '%-24s' "$mod"
      for h in "${harnesses[@]}"; do printf '%s%9s' "$(mark "in_$h" "$mod")" ""; done
      echo
    done
    ;;

  uninstall)
    # ~/.agents/skills serves Codex and opencode both; drop a skill there only when every
    # installed one of them is being uninstalled.
    drop_agents=1
    for h in codex opencode; do [[ -n "$(harness_bin "$h")" ]] && ! uses "$h" && drop_agents=0; done
    for mod in "${mods[@]}"; do
      if uses claude && in_claude "$mod"; then
        "$claude_bin" plugin uninstall "$mod@$marketplace" --scope "$scope"
      fi
      while IFS= read -r skill; do
        [[ -n "$skill" ]] || continue
        name="$(basename "$skill")"
        if uses opencode; then unlink_owned "$opencode_commands/$name.md"; fi
        if [[ $drop_agents -eq 1 ]]; then unlink_owned "$agents_skills/$name"; fi
      done < <(skill_dirs "$mod")
    done
    ;;

  install)
    echo "Harnesses: ${harnesses[*]}"
    if [[ $run_checks -eq 1 ]]; then
      if [[ -n "$claude_bin" ]]; then
        "$claude_bin" plugin validate "$root" >/dev/null || { "$claude_bin" plugin validate "$root" || true; die "marketplace failed validation"; }
      fi
      check_unique_skills
      for mod in "${mods[@]}"; do run_checks_for "$mod"; done
    fi

    for mod in "${mods[@]}"; do generate_mod "$mod"; done
    echo "Generated Codex/opencode files in ${build#"$root"/}/"

    if uses claude; then
      echo "— Claude Code"
      "$claude_bin" plugin marketplace add "$root" >/dev/null
      "$claude_bin" plugin marketplace update "$marketplace" >/dev/null
      for mod in "${mods[@]}"; do "$claude_bin" plugin install "$mod@$marketplace" --scope "$scope"; done
    fi

    if uses codex || uses opencode; then
      echo "— Codex / opencode skills ($agents_skills)"
      for mod in "${mods[@]}"; do
        while IFS= read -r skill; do
          [[ -n "$skill" ]] || continue
          name="$(basename "$skill")"
          link "$build/agents/skills/$name" "$agents_skills/$name" && echo "Linked skill $name ($mod)"
        done < <(skill_dirs "$mod")
      done
    fi

    if uses opencode; then
      echo "— opencode commands ($opencode_commands)"
      for mod in "${mods[@]}"; do
        while IFS= read -r skill; do
          [[ -n "$skill" ]] || continue
          name="$(basename "$skill")"
          link "$build/opencode/commands/$name.md" "$opencode_commands/$name.md" && echo "Linked command /$name ($mod)"
        done < <(skill_dirs "$mod")
      done
    fi

    echo
    echo "Done. Start a new session, or run /reload-plugins in an open Claude Code session."
    ;;
esac
