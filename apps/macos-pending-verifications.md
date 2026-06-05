# macOS-pending verifications

Tracks acceptance-criteria items from monorepo prompts that **must be verified
on a macOS host** because Kotlin/Native + Xcode toolchain restrictions
prevent producing or running the artifact on Windows/Linux dev hosts.

Items here are *not unfinished work* — the code is written, committed, and
all host-runnable gates are green. They are *deferred artifact verifications*
that ADR-012's CI matrix is designed to run on `macos-latest` runners.

| Origin prompt | Artifact / verification | Deferred to | Verification command on macOS | Status |
|---|---|---|---|---|
| `p1-shared/S3-0001-kmp-scaffold` (commit `5317ebcb1`) | `apps/shared/core/build/XCFrameworks/release/Shared.xcframework` — actual binary produced + signed | `p5-hardening/H8-0001-store-packaging` (runs on `macos-latest`) | `cd apps/shared && ./gradlew :core:assembleSharedXCFramework && ls -lah core/build/XCFrameworks/release/Shared.xcframework` | macOS-pending |

## Resolution protocol

When a macOS runner (CI or local) executes one of these verifications and the
artifact is produced + verified, append a row below recording the run + SHA,
and strike through the corresponding row above. Do NOT delete the row — the
audit trail matters more than the parking-lot tidiness.

## Resolved verifications

_(none yet)_
