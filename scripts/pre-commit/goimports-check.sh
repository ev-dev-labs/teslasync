#!/usr/bin/env bash
# goimports-check.sh — pre-commit hook body for Go imports grouping.
#
# Receives staged .go file paths as positional args. Fails (exit 1)
# when any file has ungrouped or unused imports per goimports' rules.
# No output and exit 0 when all clean.
#
# Why a script instead of an inline `entry:` in .pre-commit-config.yaml:
# matches gofmt-check.sh — nested quotes + colons break YAML parsing.
#
# Install goimports if missing:
#   go install golang.org/x/tools/cmd/goimports@latest
# (it ships outside the Go toolchain so it's not on $PATH by default).
#
# Windows note: same CRLF caveat as gofmt-check.sh applies.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  exit 0
fi

if ! command -v goimports >/dev/null 2>&1; then
  echo "goimports: not found on PATH" >&2
  echo "Install: go install golang.org/x/tools/cmd/goimports@latest" >&2
  echo "Then ensure \$GOPATH/bin (typically ~/go/bin) is on PATH." >&2
  exit 1
fi

unfmt=$(goimports -l "$@")
if [ -n "$unfmt" ]; then
  echo "goimports: the following files have ungrouped or unused imports:" >&2
  echo "$unfmt" >&2
  echo "" >&2
  echo "Fix: goimports -w <file>" >&2
  exit 1
fi
exit 0
