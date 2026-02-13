#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

version="${1:-}"
notes="${2:-}"

if [[ -z "$version" ]]; then
  echo "Usage: ./release.sh <version> [notes]" >&2
  exit 1
fi

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: version must be semver (e.g., 1.0.1)." >&2
  exit 1
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
  echo "ERROR: Rebase in progress. Resolve first." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: Working tree is not clean. Commit/stash changes first." >&2
  exit 1
fi

tag="v$version"

if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "ERROR: Tag $tag already exists." >&2
  exit 1
fi

echo "$version" > VERSION
git add VERSION
if ! git diff --cached --quiet; then
  git commit -m "chore(release): $tag"
  git push origin "$branch"
fi

msg="Release $tag"
if [[ -n "$notes" ]]; then
  msg="$msg - $notes"
fi

git tag -a "$tag" -m "$msg"
git push origin "$tag"

if command -v gh >/dev/null 2>&1; then
  if [[ -n "$notes" ]]; then
    gh release create "$tag" --title "$tag" --notes "$notes" >/dev/null
  else
    gh release create "$tag" --title "$tag" --generate-notes >/dev/null
  fi
  echo "OK: created GitHub release $tag"
else
  echo "OK: pushed tag $tag (gh CLI not found; skipped GitHub release)."
fi
