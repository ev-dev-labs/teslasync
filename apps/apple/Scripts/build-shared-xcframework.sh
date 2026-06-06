#!/bin/bash
#
# Build the KMP shared core as a static XCFramework and stage it for the Xcode
# app targets. Wired as a pre-build Run Script phase (project.yml) so the Apple
# build always links a fresh `Shared.xcframework` (ADR-004).
#
# Requires the Kotlin/Native Apple toolchain (full Xcode). On CI this runs on a
# `macos-latest` runner; see apps/macos-pending-verifications.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SHARED_DIR="$REPO_ROOT/apps/shared"
DEST="$REPO_ROOT/apps/apple/Frameworks/Shared.xcframework"
SRC="$SHARED_DIR/core/build/XCFrameworks/release/Shared.xcframework"

echo "▸ Assembling Shared.xcframework via Gradle…"
"$SHARED_DIR/gradlew" -p "$SHARED_DIR" :core:assembleSharedXCFramework

if [ ! -d "$SRC" ]; then
    echo "error: expected XCFramework not found at $SRC" >&2
    exit 1
fi

echo "▸ Staging $SRC → $DEST"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
echo "✓ Shared.xcframework staged"
