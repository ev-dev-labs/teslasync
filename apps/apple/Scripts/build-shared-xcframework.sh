#!/bin/bash
#
# Build the KMP shared core as a static XCFramework and stage it for the Xcode
# app targets. Wired as a pre-build Run Script phase (project.yml) so the Apple
# build always links a fresh `Shared.xcframework` (ADR-004).
#
# Requires the Kotlin/Native Apple toolchain (full Xcode). On CI this runs on a
# `macos-latest` runner; see apps/macos-pending-verifications.md.
set -euo pipefail

# Resolve the repo root robustly. When this script runs as an Xcode pre-build
# Run Script phase, Xcode copies its contents into DerivedData before executing,
# so ${BASH_SOURCE} points there — not into the repo. Prefer Xcode's $SRCROOT
# (the directory containing TeslaSync.xcodeproj, i.e. apps/apple) and fall back
# to BASH_SOURCE-relative resolution for standalone/CI invocation.
if [ -n "${SRCROOT:-}" ] && [ -d "$SRCROOT/../../apps/shared" ]; then
    REPO_ROOT="$(cd "$SRCROOT/../.." && pwd)"
else
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
    REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
fi
SHARED_DIR="$REPO_ROOT/apps/shared"
DEST="$REPO_ROOT/apps/apple/Frameworks/Shared.xcframework"
SRC="$SHARED_DIR/core/build/XCFrameworks/release/Shared.xcframework"

echo "▸ Assembling Shared.xcframework via Gradle…"
# Run Gradle non-interactively. Under an Xcode Run Script / scheme pre-action the
# process has no controlling TTY; Gradle's default "auto" console probes the
# terminal and the wrapper can touch stdin, which gets the backgrounded process
# SIGTTIN-stopped (process state "T") and deadlocks the whole build. Forcing
# plain console output and detaching stdin makes it terminal-safe while keeping
# the daemon warm across the many Apple gate invocations.
"$SHARED_DIR/gradlew" -p "$SHARED_DIR" \
    --console=plain \
    :core:assembleSharedXCFramework </dev/null

if [ ! -d "$SRC" ]; then
    echo "error: expected XCFramework not found at $SRC" >&2
    exit 1
fi

echo "▸ Staging $SRC → $DEST"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
echo "✓ Shared.xcframework staged"
