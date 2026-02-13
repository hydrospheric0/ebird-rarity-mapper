#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

usage() {
  cat <<'EOF'
Usage:
  ./pushit.sh [message]
  ./pushit.sh --all [message]
  ./pushit.sh --release <version> [--notes "text"] [message]

Behavior:
  - Stages and commits changes, rebases on origin, then pushes.
  - Default staging is tracked-only (safe): `git add -u`
  - Use --all to include untracked/new files too: `git add -A`
  - Use --release to create a versioned tag and GitHub release

Examples:
  ./pushit.sh "Fix county zoom"
  ./pushit.sh --all "Add release tooling"
  ./pushit.sh --release 1.0.1 --notes "Initial clean release"
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

stage_mode="tracked"
release_version=""
release_notes=""
msg_parts=()

get_version() {
  if [[ -f VERSION ]]; then
    tr -d '[:space:]' < VERSION
  else
    echo ""
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      stage_mode="all"
      shift
      ;;
    --release)
      release_version="${2:-}"
      if [[ -z "$release_version" ]]; then
        echo "ERROR: --release requires a version (e.g., 1.0.1)." >&2
        exit 1
      fi
      shift 2
      ;;
    --notes)
      release_notes="${2:-}"
      if [[ -z "$release_notes" ]]; then
        echo "ERROR: --notes requires text." >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      msg_parts+=("$@")
      break
      ;;
    *)
      msg_parts+=("$1")
      shift
      ;;
  esac
done

msg="${msg_parts[*]:-}"
if [[ -z "$msg" ]]; then
  msg="Update $(date -Iseconds)"
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: Not inside a git repository." >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "HEAD" ]]; then
  echo "ERROR: Detached HEAD; checkout a branch first." >&2
  exit 1
fi

if [[ -d .git/rebase-merge || -d .git/rebase-apply ]]; then
  echo "ERROR: Rebase in progress. Resolve it first, then rerun." >&2
  exit 1
fi

if [[ "$stage_mode" == "all" ]]; then
  git add -A
else
  git add -u
fi

if [[ "$stage_mode" == "tracked" ]]; then
  mapfile -t untracked_files < <(git ls-files --others --exclude-standard)
  if (( ${#untracked_files[@]} > 0 )); then
    git fetch -q origin "$branch" || true
    if git rev-parse --verify -q "origin/$branch" >/dev/null; then
      mapfile -t upstream_tracked < <(git ls-tree -r --name-only "origin/$branch")
      declare -A upstream_map=()
      for path in "${upstream_tracked[@]}"; do
        upstream_map["$path"]=1
      done

      conflicting_untracked=()
      for path in "${untracked_files[@]}"; do
        if [[ -n "${upstream_map[$path]+x}" ]]; then
          conflicting_untracked+=("$path")
        fi
      done

      if (( ${#conflicting_untracked[@]} > 0 )); then
        preview_count=20
        total_count=${#conflicting_untracked[@]}
        echo "ERROR: Untracked files conflict with files tracked on origin/$branch." >&2
        echo "These can block pull --rebase by preventing checkout of upstream files." >&2
        echo "Either run with --all, or stash/remove the conflicting untracked files first." >&2
        echo "Found $total_count conflicting untracked paths. Showing first $preview_count:" >&2
        for path in "${conflicting_untracked[@]:0:$preview_count}"; do
          echo "  - $path" >&2
        done
        if (( total_count > preview_count )); then
          echo "  ... and $((total_count - preview_count)) more" >&2
        fi
        exit 1
      fi
    fi
  fi
fi

if ! git diff --cached --quiet; then
  git commit -m "$msg"
else
  echo "No staged changes to commit. (Tip: use --all to include untracked files.)"
fi

git pull --rebase origin "$branch"

git push origin HEAD

current_version="$(get_version)"
if [[ -n "$current_version" ]]; then
  echo "OK: pushed $(git rev-parse --short HEAD) to origin/$branch (version $current_version)"
else
  echo "OK: pushed $(git rev-parse --short HEAD) to origin/$branch"
fi

if [[ -n "$release_version" ]]; then
  if [[ ! -x "./release.sh" ]]; then
    echo "ERROR: release.sh not found or not executable." >&2
    exit 1
  fi
  if [[ -n "$release_notes" ]]; then
    ./release.sh "$release_version" "$release_notes"
  else
    ./release.sh "$release_version"
  fi
fi
