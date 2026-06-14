//
//  WidgetShell.Tests.swift
//  TeslaSync — P4 widget primitive · 0013 · WidgetShell (Apple)
//
//  Unit coverage for the WidgetShell primitive: the pure decisions (state precedence, freshness
//  status/bucket/label, pulse, layout, help resolution), the VoiceOver label builders, the P1/S10
//  i18n fallback + P1/S11 telemetry seam, and a per-state ImageRenderer smoke test for every render
//  branch (loading / error ±retry / titled-plain / full-chrome / each freshness state / title-less
//  overlay / no-padding). Runs in the TeslaSync(/-macOS) XCTest targets. No network, no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Render state precedence

final class WidgetShellStateTests: XCTestCase {
    func testLoadingWinsOverError() {
        XCTAssertEqual(WidgetShellState.resolve(loading: true, error: "boom"), .loading)
    }

    func testErrorWhenNotLoading() {
        XCTAssertEqual(WidgetShellState.resolve(loading: false, error: "boom"), .error)
    }

    func testEmptyErrorStringIsReady() {
        XCTAssertEqual(WidgetShellState.resolve(loading: false, error: ""), .ready)
    }

    func testNilErrorIsReady() {
        XCTAssertEqual(WidgetShellState.resolve(loading: false, error: nil), .ready)
    }
}

// MARK: - Freshness status mapping

final class WidgetShellFreshnessStatusTests: XCTestCase {
    func testErrorTakesPrecedence() {
        XCTAssertEqual(WidgetShellFreshnessStatus.resolve(isError: true, isFetching: true, isStale: true), .error)
    }

    func testFetchingBeforeStale() {
        XCTAssertEqual(WidgetShellFreshnessStatus.resolve(isError: false, isFetching: true, isStale: true), .fetching)
    }

    func testStaleWhenOnlyStale() {
        XCTAssertEqual(WidgetShellFreshnessStatus.resolve(isError: false, isFetching: false, isStale: true), .stale)
    }

    func testFreshWhenNothingSet() {
        XCTAssertEqual(WidgetShellFreshnessStatus.resolve(isError: false, isFetching: false, isStale: false), .fresh)
    }

    func testLocalizationKey() {
        XCTAssertEqual(WidgetShellFreshnessStatus.stale.localizationKey, "freshness.status.stale")
        XCTAssertEqual(WidgetShellFreshnessStatus.error.localizationKey, "freshness.status.error")
    }
}

// MARK: - Relative-time bucket thresholds

final class WidgetShellRelativeTimeBucketTests: XCTestCase {
    private let now: Double = 10_000_000_000 // fixed epoch-ms reference

    private func bucket(secondsAgo: Double) -> WidgetShellRelativeTimeBucket {
        WidgetShellRelativeTimeBucket.bucket(updatedAtMillis: now - secondsAgo * 1000, nowMillis: now)
    }

    func testJustNowUnderOneMinute() {
        XCTAssertEqual(bucket(secondsAgo: 0), .justNow)
        XCTAssertEqual(bucket(secondsAgo: 59), .justNow)
    }

    func testMinutes() {
        XCTAssertEqual(bucket(secondsAgo: 60), .minutes(1))
        XCTAssertEqual(bucket(secondsAgo: 120), .minutes(2))
        XCTAssertEqual(bucket(secondsAgo: 3599), .minutes(59))
    }

    func testHours() {
        XCTAssertEqual(bucket(secondsAgo: 3600), .hours(1))
        XCTAssertEqual(bucket(secondsAgo: 7200), .hours(2))
        XCTAssertEqual(bucket(secondsAgo: 86399), .hours(23))
    }

    func testDays() {
        XCTAssertEqual(bucket(secondsAgo: 86400), .days(1))
        XCTAssertEqual(bucket(secondsAgo: 2 * 86400), .days(2))
        XCTAssertEqual(bucket(secondsAgo: 604_799), .days(6))
    }

    func testWeeks() {
        XCTAssertEqual(bucket(secondsAgo: 604_800), .weeks(1))
        XCTAssertEqual(bucket(secondsAgo: 2 * 604_800), .weeks(2))
    }
}

// MARK: - Freshness label composition

final class WidgetShellFreshnessLabelTests: XCTestCase {
    private let now: Double = 10_000_000_000

    func testRelativeWhenUpdatedAndNotFetching() {
        let label = WidgetShellFreshnessLabel.resolve(
            updatedAtMillis: now - 120_000,
            isFetching: false,
            isError: false,
            nowMillis: now
        )
        XCTAssertEqual(label, .relative(.minutes(2)))
    }

    func testFetchingOverridesRelative() {
        let label = WidgetShellFreshnessLabel.resolve(
            updatedAtMillis: now - 120_000,
            isFetching: true,
            isError: false,
            nowMillis: now
        )
        XCTAssertEqual(label, .updating)
    }

    func testErrorWhenNoTimestampAndNotFetching() {
        let label = WidgetShellFreshnessLabel.resolve(
            updatedAtMillis: nil,
            isFetching: false,
            isError: true,
            nowMillis: now
        )
        XCTAssertEqual(label, .error)
    }

    func testZeroTimestampTreatedAsAbsent() {
        let label = WidgetShellFreshnessLabel.resolve(
            updatedAtMillis: 0,
            isFetching: false,
            isError: false,
            nowMillis: now
        )
        XCTAssertEqual(label, .none)
    }

    func testNoneWhenNothing() {
        let label = WidgetShellFreshnessLabel.resolve(
            updatedAtMillis: nil,
            isFetching: false,
            isError: false,
            nowMillis: now
        )
        XCTAssertEqual(label, .none)
    }
}

// MARK: - Pulse-on-update decision

final class WidgetShellPulseTests: XCTestCase {
    func testNoPulseOnFirstValue() {
        XCTAssertFalse(WidgetShellPulse.shouldPulse(previous: nil, next: 100))
    }

    func testPulseOnChange() {
        XCTAssertTrue(WidgetShellPulse.shouldPulse(previous: 100, next: 200))
    }

    func testNoPulseWhenUnchanged() {
        XCTAssertFalse(WidgetShellPulse.shouldPulse(previous: 100, next: 100))
    }

    func testNoPulseWhenNextNilOrZero() {
        XCTAssertFalse(WidgetShellPulse.shouldPulse(previous: 100, next: nil))
        XCTAssertFalse(WidgetShellPulse.shouldPulse(previous: 100, next: 0))
    }
}

// MARK: - Layout decisions

final class WidgetShellLayoutTests: XCTestCase {
    func testShowsTitleHeaderOnlyWithNonEmptyTitle() {
        XCTAssertTrue(WidgetShellLayout.showsTitleHeader(title: "Battery"))
        XCTAssertFalse(WidgetShellLayout.showsTitleHeader(title: ""))
        XCTAssertFalse(WidgetShellLayout.showsTitleHeader(title: nil))
    }

    func testFreshnessCompactIsInverseOfTitleHeader() {
        XCTAssertFalse(WidgetShellLayout.freshnessIsCompact(title: "Battery"))
        XCTAssertTrue(WidgetShellLayout.freshnessIsCompact(title: nil))
        XCTAssertTrue(WidgetShellLayout.freshnessIsCompact(title: ""))
    }
}

// MARK: - Help resolution

final class WidgetShellHelpTests: XCTestCase {
    /// Facade stub that echoes the supplied fallback (the per-surface table is not loaded in the host).
    private func echoFallback(_: String, _ fallback: String) -> String {
        fallback
    }

    func testPrefersI18nKeyDefaultValue() {
        let help = WidgetHelp(i18nKey: "widget.help.soh", defaultValue: "State of health")
        XCTAssertEqual(help.resolvedText(localize: echoFallback), "State of health")
    }

    func testFallsBackToLiteralText() {
        let help = WidgetHelp(text: "Plain help")
        XCTAssertEqual(help.resolvedText(localize: echoFallback), "Plain help")
    }

    func testEmptyResolvesToNil() {
        XCTAssertNil(WidgetHelp().resolvedText(localize: echoFallback))
        XCTAssertNil(WidgetHelp(text: "").resolvedText(localize: echoFallback))
        XCTAssertNil(WidgetHelp(i18nKey: "k", defaultValue: "").resolvedText(localize: echoFallback))
    }
}

// MARK: - Accessibility label builders

final class WidgetShellAccessibilityTests: XCTestCase {
    func testHelpLabel() {
        XCTAssertEqual(
            WidgetShellAccessibility.helpLabel(format: "More info about %@", title: "Battery"),
            "More info about Battery"
        )
    }

    func testDataFreshnessLabel() {
        XCTAssertEqual(
            WidgetShellAccessibility.dataFreshnessLabel(format: "Data freshness: %@", status: "stale"),
            "Data freshness: stale"
        )
    }
}

// MARK: - i18n facade

final class WidgetShellStringsTests: XCTestCase {
    func testTableName() {
        XCTAssertEqual(WidgetShellStrings.table, "WidgetShell")
    }

    /// The per-surface table is not loaded into the unit-test host's main bundle, so the facade
    /// returns the supplied web English fallback — proving the view never shows a raw key.
    func testFallbackResolves() {
        XCTAssertEqual(WidgetShellStrings.string("freshness.justNow", "just now"), "just now")
        XCTAssertEqual(WidgetShellStrings.string("pin.pin", "Pin"), "Pin")
    }
}

// MARK: - Telemetry seam (P1/S11 view.opened)

private final class SpyWidgetShellTelemetry: WidgetShellTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []
    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}

final class WidgetShellTelemetryTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WidgetShellSurface.slug, "WidgetShell")
        XCTAssertEqual(WidgetShell<Color, EmptyView, EmptyView>.surfaceSlug, "WidgetShell")
    }

    func testSeamRecordsSurfaceSlug() {
        let spy = SpyWidgetShellTelemetry()
        spy.viewOpened(surface: WidgetShellSurface.slug)
        XCTAssertEqual(spy.openedSurfaces, ["WidgetShell"])
    }
}

// MARK: - Per-state render smoke (snapshot of each branch)

@MainActor
final class WidgetShellRenderTests: XCTestCase {
    private func millis(minutesAgo: Double) -> Double {
        Date().addingTimeInterval(-minutesAgo * 60).timeIntervalSince1970 * 1000
    }

    private func assertRenders(_ view: some View, _ message: String, width: CGFloat = 300, height: CGFloat = 160) {
        let renderer = ImageRenderer(content: view.frame(width: width, height: height))
        #if canImport(UIKit)
            XCTAssertNotNil(renderer.uiImage, message)
        #elseif canImport(AppKit)
            XCTAssertNotNil(renderer.nsImage, message)
        #endif
    }

    func testRendersLoading() {
        assertRenders(
            WidgetShell(title: "Battery", loading: true) { Color.clear },
            "loading skeleton should render"
        )
    }

    func testRendersErrorWithoutRetry() {
        assertRenders(
            WidgetShell(title: "Battery", error: "boom") { Color.clear },
            "error (no retry) should render"
        )
    }

    func testRendersErrorWithRetry() {
        assertRenders(
            WidgetShell(
                title: "Battery",
                error: "boom",
                freshness: WidgetShellFreshness(isError: true, onRefresh: {})
            ) { Color.clear },
            "error (with retry) should render"
        )
    }

    func testRendersTitledPlain() {
        assertRenders(
            WidgetShell(title: "Battery health") { WidgetShellSampleRenderContent() },
            "titled plain should render"
        )
    }

    func testRendersFullChrome() {
        assertRenders(
            WidgetShell(
                title: "Battery health",
                freshness: WidgetShellFreshness(updatedAtMillis: millis(minutesAgo: 5), onRefresh: {}),
                help: WidgetHelp(
                    text: "State of health.",
                    learnMore: WidgetHelpLink(url: widgetShellTestURL)
                ),
                pin: WidgetShellPin(isPinned: true, onToggle: {}),
                icon: { Image(systemName: "battery.100") },
                actions: { Image(systemName: "ellipsis") },
                content: { WidgetShellSampleRenderContent() }
            ),
            "full chrome should render",
            width: 340
        )
    }

    func testRendersFreshnessStates() {
        assertRenders(
            WidgetShell(title: "Live", freshness: WidgetShellFreshness(updatedAtMillis: millis(minutesAgo: 0.1))) {
                Color.clear
            },
            "fresh should render"
        )
        assertRenders(
            WidgetShell(
                title: "Live",
                freshness: WidgetShellFreshness(updatedAtMillis: millis(minutesAgo: 3), isFetching: true)
            ) { Color.clear },
            "fetching should render"
        )
        assertRenders(
            WidgetShell(
                title: "Live",
                freshness: WidgetShellFreshness(updatedAtMillis: millis(minutesAgo: 120), isStale: true)
            ) { Color.clear },
            "stale should render"
        )
        assertRenders(
            WidgetShell(title: "Live", freshness: WidgetShellFreshness(isError: true)) { Color.clear },
            "error freshness should render"
        )
    }

    func testRendersTitleLessOverlay() {
        assertRenders(
            WidgetShell(freshness: WidgetShellFreshness(updatedAtMillis: millis(minutesAgo: 2))) {
                Text(verbatim: "1,204").font(Font.TS.display)
            },
            "title-less overlay should render",
            width: 150,
            height: 150
        )
    }

    func testRendersNoPadding() {
        assertRenders(
            WidgetShell(title: "Map", noPadding: true) { Color.TS.accent.opacity(0.2) },
            "no-padding should render"
        )
    }
}

/// Sample "Learn more" destination for the full-chrome render test. Built with a `??` fallback so
/// there is no force-unwrap (and no throwing `XCTUnwrap`) in the test body.
private let widgetShellTestURL = URL(string: "https://example.com") ?? URL(fileURLWithPath: "/")

/// Lightweight content used by the render tests (kept out of the shipped surface).
private struct WidgetShellSampleRenderContent: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: "82%").font(Font.TS.title).foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: "State of health").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
