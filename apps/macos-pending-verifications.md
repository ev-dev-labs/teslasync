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
| `p4-apple/feature-views/P-0010-ToolCard` | Full-app iOS-Simulator + macOS `xcodebuild build test`. The `ToolCard` surface itself is verified green (isolated SwiftPM build + 13/13 tests under Swift 6 strict concurrency; swiftlint/swiftformat/placeholder clean). The full-app build is blocked by **pre-existing, unrelated** parallel-merge collisions — `public struct DashboardWidgetSize` (and `PowerFlowConnection`) redefined 8× across `Sources/DashboardWidgets/*` + `TeslaSync/dashboard-widgets/*`, co-located `*.Tests.swift` importing `XCTest` into the app target, and macOS development-signing. Zero `ToolCard`/`feature-views` errors. | `p4-apple/P99-0001-apple-acceptance-gate` (runs on `macos-latest` with signing identities) | `cd apps/apple && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test` | macOS-pending |
| `p4-apple/feature-views/0180-AlertMessageEditor` | Full-app iOS-Simulator + macOS `xcodebuild build test`. The `AlertMessageEditor` surface itself is verified green (isolated SwiftPM build + 41/41 tests under Swift 6 strict concurrency; real iOS-18 + macOS-15 `swiftc -typecheck`; swiftlint --strict / swiftformat --lint / placeholder gate all clean, 0 opt-outs). The full-app build is blocked by the same **pre-existing, unrelated** parallel-merge collisions — `struct DashboardWidgetSize` redefined 15×, 116 co-located `*.Tests.swift` importing `XCTest` into the app target, the unstaged `Shared.xcframework`, and macOS development-signing. Zero `AlertMessageEditor`/`feature-views` errors. | `p4-apple/P99-0001-apple-acceptance-gate` (runs on `macos-latest` with signing identities) | `cd apps/apple && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test` | macOS-pending |
| `p4-apple/feature-views/0231-FSMTimelineChart` | Full-app iOS-Simulator + macOS `xcodebuild build test`. The `FSMTimelineChart` surface itself is verified green (isolated SwiftPM build + 38/38 tests under Swift 6 strict concurrency; real iOS-18 + macOS-15 `swiftc -typecheck`; swiftlint --strict / swiftformat --lint / placeholder gate all clean, 0 opt-outs; `xcodegen generate` enumerates the 10 files). Surface uses Swift Charts (stacked AreaMark), proven on both SDKs. The full-app build is blocked by the same **pre-existing, unrelated** parallel-merge collisions — `struct DashboardWidgetSize` redefined 15×, 152 co-located `*.Tests.swift`/`*.ModelTests.swift` importing `XCTest` into the app target, the unstaged `Shared.xcframework`, and macOS development-signing. Zero `FSMTimelineChart`/`feature-views` errors. | `p4-apple/P99-0001-apple-acceptance-gate` (runs on `macos-latest` with signing identities) | `cd apps/apple && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test` | macOS-pending |

## Resolution protocol

When a macOS runner (CI or local) executes one of these verifications and the
artifact is produced + verified, append a row below recording the run + SHA,
and strike through the corresponding row above. Do NOT delete the row — the
audit trail matters more than the parking-lot tidiness.

## Resolved verifications

_(none yet)_
