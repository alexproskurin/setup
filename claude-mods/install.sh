#!/usr/bin/env bash
# Install the mods in this repo into Claude Code.
#
# Usage:
#   ./install.sh                  validate, test and install every mod in mods/
#   ./install.sh my-mod other     install only these mods
#   ./install.sh --uninstall [mod...]
#   ./install.sh --list           show each mod and whether it is installed
#
# Options:
#   -s, --scope <user|project|local>  where to install (default: user)
#   --skip-checks                     skip `claude plugin validate` / `claude plugin test`
#   -h, --help
#
# The repo is added as a local-folder marketplace, so installed mods are read
# straight from mods/<name>: after editing one, run /reload-plugins in a session.
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
marketplace_file="$root/.claude-plugin/marketplace.json"

action=install
scope=user
run_checks=1
mods=()

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -u|--uninstall) action=uninstall ;;
    -l|--list) action=list ;;
    -s|--scope) scope="${2:?--scope needs a value}"; shift ;;
    --skip-checks) run_checks=0 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) mods+=("$1") ;;
  esac
  shift
done

command -v claude >/dev/null || die "claude CLI not found on PATH"
command -v jq >/dev/null || die "jq not found (brew install jq)"
[[ "$scope" =~ ^(user|project|local)$ ]] || die "scope must be user, project or local"
[[ -f "$marketplace_file" ]] || die "$marketplace_file not found"

marketplace="$(jq -r .name "$marketplace_file")"
listed=()
while IFS= read -r name; do listed+=("$name"); done < <(jq -r '.plugins[].name' "$marketplace_file")

is_listed() { local m; for m in ${listed[@]+"${listed[@]}"}; do [[ "$m" == "$1" ]] && return 0; done; return 1; }

# Folders under mods/ the marketplace doesn't list would silently never install.
for dir in "$root"/mods/*/; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  is_listed "$name" || echo "warning: mods/$name is not listed in .claude-plugin/marketplace.json (scripts/new-mod.sh adds it)" >&2
done

[[ ${#mods[@]} -gt 0 ]] || mods=("${listed[@]}")
for mod in "${mods[@]}"; do
  is_listed "$mod" || die "'$mod' is not listed in .claude-plugin/marketplace.json"
done

installed_ids="$(claude plugin list --json | jq -r '.[].id')"
is_installed() { grep -qx "$1@$marketplace" <<<"$installed_ids"; }

case "$action" in
  list)
    for mod in "${listed[@]}"; do
      if is_installed "$mod"; then echo "  ✔ $mod (installed)"; else echo "  · $mod"; fi
    done
    ;;

  uninstall)
    for mod in "${mods[@]}"; do
      if is_installed "$mod"; then
        claude plugin uninstall "$mod@$marketplace" --scope "$scope"
      else
        echo "· $mod is not installed"
      fi
    done
    ;;

  install)
    if [[ $run_checks -eq 1 ]]; then
      echo "Checking marketplace…"
      claude plugin validate "$root" >/dev/null || { claude plugin validate "$root" || true; die "marketplace failed validation"; }
      for mod in "${mods[@]}"; do
        dir="$root/mods/$mod"
        echo "Checking ${mod}…"
        claude plugin validate "$dir" >/dev/null || { claude plugin validate "$dir" || true; die "$mod failed validation"; }
        if compgen -G "$dir/hooks/*.test.ts" >/dev/null || compgen -G "$dir/hooks/*.test.tsx" >/dev/null; then
          claude plugin test "$dir" >/dev/null 2>&1 || { claude plugin test "$dir" || true; die "$mod tests failed"; }
        fi
      done
    fi

    # Adding is idempotent; the update re-reads marketplace.json so newly listed mods are found.
    claude plugin marketplace add "$root" >/dev/null
    claude plugin marketplace update "$marketplace" >/dev/null

    for mod in "${mods[@]}"; do
      claude plugin install "$mod@$marketplace" --scope "$scope"
    done

    echo
    echo "Done. Open sessions pick up changes after /reload-plugins; new sessions load them automatically."
    ;;
esac
