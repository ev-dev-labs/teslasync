#!/usr/bin/env bash
# gofmt-check.sh — pre-commit hook body for Go formatting check.
#
# Receives staged .go file paths as positional args. Fails (exit 1)
# when any file is not gofmt-clean and prints the offenders + fix
# command. No output and exit 0 when all clean.
#
# Why a script instead of an inline `entry:` in .pre-commit-config.yaml:
# the inline form breaks YAML scalar parsing because the body needs
# nested single quotes plus colons inside the if/then branches.
# Pulling it into a script also makes it directly runnable for
# local debugging (./scripts/pre-commit/gofmt-check.sh path/to/file.go).
#
# Windows note: this expects bash (Git for Windows ships one). If you
# see false positives on Windows, your working tree probably has CRLF
# for .go files — the .gitattributes (A2.3) `*.go text eol=lf` rule
# fixes that on next checkout. See docs/CONTRIBUTING.md.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  exit 0
fi

unfmt=$(gofmt -l -s "$@")
if [ -n "$unfmt" ]; then
  echo "gofmt: the following files are not formatted:" >&2
  echo "$unfmt" >&2
  echo "" >&2
  echo "Fix: gofmt -s -w <file>  (or run: make fmt)" >&2
  exit 1
fi
exit 0
