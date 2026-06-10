//
//  LiveStatusPill.Tests.swift
//  TeslaSync — P4 feature view · 0249 · LiveStatusPill (Apple)
//
//  Unit coverage for the LiveStatusPill surface. LiveStatusPill is a pure
//  presentational chip (the web source fetches nothing), so the meaningful,
//  host-free surface area is:
//    • the `TONE` tone map (tint / pulse / glyph / label per state),
//    • the `relative(now, lastUpdateAt)` ladder (incl. the boundaries, the
//      negative/non-finite clamps, and the `nil ⇒ "—"` branch),
//    • the relative-time + state-label + composed aria-label localization,
//    • the `view.opened` telemetry slug.
//  These mirror the three branches the web component carries. The view itself is
//  exercised by a per-state `ImageRenderer` render smoke.
//
//  The whole file is gated on `canImport(XCTest)`: the feature-views group is a
//  member of the app targets as well as the test bundle, and the app targets do
//  not link XCTest. The guard means this file compiles to nothing there (so it
//  never breaks the app build) while still compiling and running in the XCTest
//  bundle.
//

#if canImport(XCTest)
    import SwiftUI
    import XCTest
    @testable import TeslaSync

    @MainActor final class LiveStatusPillTests: XCTestCase {
        // MARK: - Tone map (web `TONE[state]`)

        func testStateCoversExactlyThreeTones() {
            // Web `TONE` has exactly three keys: live / reconnecting / offline.
            XCTAssertEqual(LiveStatusState.allCases.map(\.rawValue), ["live", "reconnecting", "offline"])
        }

        func testTintMapsToStatusTokens() {
            XCTAssertEqual(LiveStatusState.live.tint, Color.TS.statusSuccess)
            XCTAssertEqual(LiveStatusState.reconnecting.tint, Color.TS.statusWarning)
            XCTAssertEqual(LiveStatusState.offline.tint, Color.TS.textMuted)
        }

        func testOnlyReconnectingPulses() {
            // Web `animate-pulse` is set only on the reconnecting tone.
            XCTAssertFalse(LiveStatusState.live.pulses)
            XCTAssertTrue(LiveStatusState.reconnecting.pulses)
            XCTAssertFalse(LiveStatusState.offline.pulses)
        }

        func testIconGlyphsMatchLucideMapping() {
            XCTAssertEqual(LiveStatusState.live.iconSystemName, "waveform.path.ecg") // Activity
            XCTAssertEqual(LiveStatusState.reconnecting.iconSystemName, "wifi") // Wifi
            XCTAssertEqual(LiveStatusState.offline.iconSystemName, "wifi.slash") // WifiOff
        }

        func testLabelKeysAndFallbacksMatchWeb() {
            XCTAssertEqual(LiveStatusState.live.labelKey, "liveStatusPill.state.live")
            XCTAssertEqual(LiveStatusState.reconnecting.labelKey, "liveStatusPill.state.reconnecting")
            XCTAssertEqual(LiveStatusState.offline.labelKey, "liveStatusPill.state.offline")
            XCTAssertEqual(LiveStatusState.live.labelFallback, "Live")
            XCTAssertEqual(LiveStatusState.reconnecting.labelFallback, "Reconnecting")
            XCTAssertEqual(LiveStatusState.offline.labelFallback, "Offline")
        }

        // MARK: - Relative ladder (web `relative(now, lastUpdateAt)`)

        private let now: Double = 1_000_000_000_000

        func testRelativeNilIsNone() {
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: nil), .none)
        }

        func testRelativeJustNowBelowFiveSeconds() {
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now), .justNow)
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now - 4999), .justNow)
        }

        func testRelativeSecondsBoundary() {
            // 5s is the first non-"just now" bucket; 59s is the last seconds bucket.
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now - 5000), .seconds(5))
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now - 59000), .seconds(59))
        }

        func testRelativeMinutesBoundary() {
            // 60s ⇒ 1m (floor); 3599s ⇒ 59m (floor).
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now - 60000), .minutes(1))
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now - 3_599_000), .minutes(59))
        }

        func testRelativeHoursBoundary() {
            // 3600s ⇒ 1h; 7200s ⇒ 2h (floor).
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now - 3_600_000), .hours(1))
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now - 7_200_000), .hours(2))
        }

        func testRelativeFloorsRatherThanRounds() {
            // Web uses Math.floor, not rounding, at every rung — a value that would
            // round up must still floor down.
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now - 5500), .seconds(5)) // 5.5s ⇒ 5
            XCTAssertEqual(
                LiveStatusRelative.bucket(now: now, lastUpdateAt: now - 3_570_000),
                .minutes(59)
            ) // 59.5m ⇒ 59
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now - 7_199_000), .hours(1)) // 1.99h ⇒ 1
        }

        func testRelativeNegativeElapsedClampsToJustNow() {
            // Clock skew (now < lastUpdateAt) ⇒ max(0, …) ⇒ justNow, as on the web.
            XCTAssertEqual(LiveStatusRelative.bucket(now: now, lastUpdateAt: now + 10000), .justNow)
        }

        func testRelativeNonFiniteIsJustNow() {
            XCTAssertEqual(LiveStatusRelative.bucket(now: .infinity, lastUpdateAt: 0), .justNow)
            XCTAssertEqual(LiveStatusRelative.bucket(now: .nan, lastUpdateAt: 0), .justNow)
        }

        // MARK: - Localization (web labels + relative strings + aria-label)

        func testStateLabelResolvesToWebText() {
            XCTAssertEqual(LiveStatusPillStrings.label(.live), "Live")
            XCTAssertEqual(LiveStatusPillStrings.label(.reconnecting), "Reconnecting")
            XCTAssertEqual(LiveStatusPillStrings.label(.offline), "Offline")
        }

        func testRelativeLabelsMatchWeb() {
            XCTAssertEqual(LiveStatusPillStrings.relativeLabel(.none), "—")
            XCTAssertEqual(LiveStatusPillStrings.relativeLabel(.justNow), "just now")
            XCTAssertEqual(LiveStatusPillStrings.relativeLabel(.seconds(18)), "18s ago")
            XCTAssertEqual(LiveStatusPillStrings.relativeLabel(.minutes(4)), "4m ago")
            XCTAssertEqual(LiveStatusPillStrings.relativeLabel(.hours(2)), "2h ago")
        }

        func testAccessibilityLabelComposesLikeWebAriaLabel() {
            let label = LiveStatusPillStrings.accessibilityLabel(stateLabel: "Live", relative: "18s ago")
            XCTAssertEqual(label, "Live status stream: Live, updated 18s ago")
        }

        // MARK: - Presentation projection

        func testPresentationDerivesToneAndRelative() {
            let presentation = LiveStatusPillPresentation(state: .reconnecting, now: now, lastUpdateAt: now - 45000)
            XCTAssertEqual(presentation.state, .reconnecting)
            XCTAssertEqual(presentation.relative, .seconds(45))
            XCTAssertEqual(presentation.tint, Color.TS.statusWarning)
            XCTAssertTrue(presentation.pulses)
            XCTAssertEqual(presentation.iconSystemName, "wifi")
        }

        func testPresentationExposesLocalizedText() {
            let presentation = LiveStatusPillPresentation(state: .offline, now: now, lastUpdateAt: nil)
            XCTAssertEqual(presentation.labelText, "Offline")
            XCTAssertEqual(presentation.relativeText, "—")
            XCTAssertEqual(presentation.accessibilityLabel, "Live status stream: Offline, updated —")
        }

        func testPresentationIsValueEquatable() {
            let lhs = LiveStatusPillPresentation(state: .live, now: now, lastUpdateAt: now - 2000)
            let rhs = LiveStatusPillPresentation(state: .live, now: now, lastUpdateAt: now - 1000)
            XCTAssertEqual(lhs, rhs) // both bucket to .justNow
            let other = LiveStatusPillPresentation(state: .offline, now: now, lastUpdateAt: now - 2000)
            XCTAssertNotEqual(lhs, other)
        }

        func testPresentationSurfaceSlugIsStable() {
            XCTAssertEqual(
                LiveStatusPillPresentation(state: .live, now: now, lastUpdateAt: now).surfaceSlug,
                "LiveStatusPill"
            )
        }

        // MARK: - Telemetry (P1/S11 `view.opened`)

        func testSurfaceSlugIsStable() {
            XCTAssertEqual(LiveStatusPillSurface.slug, "LiveStatusPill")
        }

        func testReportOpenEmitsViewOpenedWithSlug() {
            let sink = BufferedLiveStatusPillTelemetry()
            LiveStatusPillSurface.reportOpen(to: sink)
            XCTAssertEqual(sink.opened, ["LiveStatusPill"])
        }
    }

    // MARK: - View render smoke (every tone builds + renders)

    @MainActor
    final class LiveStatusPillViewStateTests: XCTestCase {
        private let now: Double = 1_000_000_000_000

        private func renderSmoke(
            _ state: LiveStatusState,
            lastUpdateAt: Double?,
            file: StaticString = #filePath,
            line: UInt = #line
        ) {
            let pill = LiveStatusPill(
                state: state,
                lastUpdateAt: lastUpdateAt,
                now: now,
                telemetry: BufferedLiveStatusPillTelemetry()
            )
            let renderer = ImageRenderer(content: pill.frame(width: 240, height: 60))
            XCTAssertNotNil(renderer.cgImage, file: file, line: line)
        }

        func testLiveRenders() {
            renderSmoke(.live, lastUpdateAt: now - 2000)
        }

        func testReconnectingRenders() {
            renderSmoke(.reconnecting, lastUpdateAt: now - 45000)
        }

        func testOfflineRenders() {
            renderSmoke(.offline, lastUpdateAt: now - 7_200_000)
        }

        func testNoUpdateYetRenders() {
            renderSmoke(.live, lastUpdateAt: nil)
        }
    }

    // MARK: - Test doubles

    /// A thread-safe buffered diagnostics sink for asserting the `view.opened` slug.
    private final class BufferedLiveStatusPillTelemetry: LiveStatusPillTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var buffer: [String] = []

        var opened: [String] {
            lock.lock()
            defer { lock.unlock() }
            return buffer
        }

        func viewOpened(surface: String) {
            lock.lock()
            defer { lock.unlock() }
            buffer.append(surface)
        }
    }
#endif
