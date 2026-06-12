//
//  WidgetEventFeed.Tests.swift
//  TeslaSync — P4 widget primitive · 0005 · WidgetEventFeed (Apple)
//
//  Adapter + projection coverage for the WidgetEventFeed surface:
//    • Keys — the web `t('widget.noEvents', …)` key plus the relative-time keys that localize the web
//      inline strings.
//    • Tone / Severity — the value enums mirroring the web `color` / `severity`.
//    • RelativeTime — the exact web `formatRelativeTime` thresholds (just-now / minutes / hours /
//      absolute fallback), including the interpolation tokens and the future-timestamp edge.
//    • Arrange — the web sort-desc + `maxItems ?? (compact ? 3 : 10)` slice, the stable tiebreak, and
//      the empty input.
//    • Accessibility — the composed row VoiceOver label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

private let identityResolver: WidgetEventFeedResolve = { _, fallback in fallback }
private let keyResolver: WidgetEventFeedResolve = { key, _ in key }
private let absoluteStub: WidgetEventFeedDateFormat = { _ in "ABSOLUTE" }

private func makeItem(
    id: String,
    timestamp: Date,
    tone: WidgetEventTone = .accent,
    severity: WidgetEventSeverity? = nil,
    href: String? = nil,
    title: String = "Event",
    subtitle: String? = nil
) -> WidgetEventFeedItem {
    WidgetEventFeedItem(
        id: id,
        iconSymbol: "bolt.fill",
        title: title,
        subtitle: subtitle,
        timestamp: timestamp,
        tone: tone,
        severity: severity,
        href: href
    )
}

// MARK: - i18n keys (web source `t(...)` key + relative-time keys)

final class WidgetEventFeedKeyTests: XCTestCase {
    func testNoEventsKeyMatchesWebSource() {
        XCTAssertEqual(WidgetEventFeedKeys.noEvents, "widget.noEvents")
    }

    func testRelativeTimeKeysAreStable() {
        XCTAssertEqual(WidgetEventFeedKeys.justNow, "widgetEventFeed.justNow")
        XCTAssertEqual(WidgetEventFeedKeys.minutesAgo, "widgetEventFeed.minutesAgo")
        XCTAssertEqual(WidgetEventFeedKeys.hoursAgo, "widgetEventFeed.hoursAgo")
    }

    func testSymbolsAreNonEmpty() {
        XCTAssertFalse(WidgetEventFeedSymbols.empty.isEmpty)
        XCTAssertFalse(WidgetEventFeedSymbols.fallbackEvent.isEmpty)
    }
}

// MARK: - Tone / Severity (web `color` / `severity`)

final class WidgetEventFeedToneSeverityTests: XCTestCase {
    func testToneCoversTheSemanticPalette() {
        XCTAssertEqual(
            Set(WidgetEventTone.allCases),
            [.accent, .success, .warning, .danger, .info, .neutral]
        )
    }

    func testSeverityCarriesKeyAndFallback() {
        XCTAssertEqual(WidgetEventSeverity.critical.accessibilityKey, "widgetEventFeed.severity.critical")
        XCTAssertEqual(WidgetEventSeverity.warning.accessibilityFallback, "Warning")
        XCTAssertEqual(WidgetEventSeverity.info.accessibilityFallback, "Info")
    }
}

// MARK: - Relative time (web `formatRelativeTime`)

final class WidgetEventFeedRelativeTimeTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func format(secondsAgo: TimeInterval, resolve: WidgetEventFeedResolve = identityResolver) -> String {
        WidgetEventFeedRelativeTime.format(
            now.addingTimeInterval(-secondsAgo),
            now: now,
            resolve: resolve,
            absolute: absoluteStub
        )
    }

    func testUnderOneMinuteIsJustNow() {
        XCTAssertEqual(format(secondsAgo: 0), "Just now")
        XCTAssertEqual(format(secondsAgo: 30), "Just now")
        XCTAssertEqual(format(secondsAgo: 59), "Just now")
    }

    func testFutureTimestampIsJustNow() {
        XCTAssertEqual(format(secondsAgo: -120), "Just now")
    }

    func testUnderOneHourIsMinutes() {
        XCTAssertEqual(format(secondsAgo: 60), "1m ago")
        XCTAssertEqual(format(secondsAgo: 5 * 60), "5m ago")
        XCTAssertEqual(format(secondsAgo: 59 * 60), "59m ago")
    }

    func testUnderOneDayIsHours() {
        XCTAssertEqual(format(secondsAgo: 60 * 60), "1h ago")
        XCTAssertEqual(format(secondsAgo: 5 * 3600), "5h ago")
        XCTAssertEqual(format(secondsAgo: 23 * 3600), "23h ago")
    }

    func testTwentyFourHoursAndBeyondIsAbsolute() {
        XCTAssertEqual(format(secondsAgo: 24 * 3600), "ABSOLUTE")
        XCTAssertEqual(format(secondsAgo: 48 * 3600), "ABSOLUTE")
    }

    func testConsultsTheLocalizationKeys() {
        XCTAssertEqual(format(secondsAgo: 10, resolve: keyResolver), "widgetEventFeed.justNow")
    }

    func testInterpolatesTheMinutesToken() {
        let templateResolver: WidgetEventFeedResolve = { key, fallback in
            key == WidgetEventFeedKeys.minutesAgo ? "{{minutes}} min" : fallback
        }
        XCTAssertEqual(format(secondsAgo: 7 * 60, resolve: templateResolver), "7 min")
    }
}

// MARK: - Arrange (web sort-desc + limit slice)

final class WidgetEventFeedArrangeTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 2_000_000)

    private func items(_ count: Int) -> [WidgetEventFeedItem] {
        (0 ..< count).map { index in
            makeItem(id: "\(index)", timestamp: base.addingTimeInterval(Double(index) * 60))
        }
    }

    func testDefaultLimitMatchesWeb() {
        XCTAssertEqual(WidgetEventFeedArrange.defaultLimit(compact: true), 3)
        XCTAssertEqual(WidgetEventFeedArrange.defaultLimit(compact: false), 10)
    }

    func testSortsNewestFirst() {
        let arranged = WidgetEventFeedArrange.arrange(items(4), compact: false, maxItems: nil)
        XCTAssertEqual(arranged.map(\.id), ["3", "2", "1", "0"])
    }

    func testFullLimitCapsAtTen() {
        let arranged = WidgetEventFeedArrange.arrange(items(12), compact: false, maxItems: nil)
        XCTAssertEqual(arranged.count, 10)
        XCTAssertEqual(arranged.first?.id, "11")
        XCTAssertEqual(arranged.last?.id, "2")
    }

    func testCompactLimitCapsAtThree() {
        let arranged = WidgetEventFeedArrange.arrange(items(12), compact: true, maxItems: nil)
        XCTAssertEqual(arranged.count, 3)
        XCTAssertEqual(arranged.map(\.id), ["11", "10", "9"])
    }

    func testMaxItemsOverridesCompactDefault() {
        let arranged = WidgetEventFeedArrange.arrange(items(12), compact: true, maxItems: 5)
        XCTAssertEqual(arranged.count, 5)
    }

    func testZeroMaxItemsYieldsEmpty() {
        XCTAssertTrue(WidgetEventFeedArrange.arrange(items(4), compact: false, maxItems: 0).isEmpty)
    }

    func testStableTiebreakPreservesInputOrderOnEqualTimestamps() {
        let stamp = base
        let tied = [
            makeItem(id: "a", timestamp: stamp),
            makeItem(id: "b", timestamp: stamp),
            makeItem(id: "c", timestamp: stamp)
        ]
        let arranged = WidgetEventFeedArrange.arrange(tied, compact: false, maxItems: nil)
        XCTAssertEqual(arranged.map(\.id), ["a", "b", "c"])
    }

    func testEmptyInputYieldsEmpty() {
        XCTAssertTrue(WidgetEventFeedArrange.arrange([], compact: false, maxItems: nil).isEmpty)
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class WidgetEventFeedProjectionTests: XCTestCase {
    private let base = Date(timeIntervalSince1970: 3_000_000)

    private func populated() -> WidgetEventFeedInput {
        WidgetEventFeedInput(items: [makeItem(id: "1", timestamp: base)])
    }

    func testErrorTakesPrecedenceOverEverything() {
        let resolved = WidgetEventFeedProjection.resolve(input: WidgetEventFeedInput(
            items: [makeItem(id: "1", timestamp: base)],
            isLoading: true,
            errorMessage: "boom"
        ))
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.items.isEmpty)
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        var input = populated()
        input.errorMessage = ""
        XCTAssertEqual(WidgetEventFeedProjection.resolve(input: input).phase, .feed)
    }

    func testLoadingWhenFlaggedAndNoError() {
        var input = populated()
        input.isLoading = true
        let resolved = WidgetEventFeedProjection.resolve(input: input)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.items.isEmpty)
    }

    func testFeedWhenItemsPresent() {
        let resolved = WidgetEventFeedProjection.resolve(input: populated())
        XCTAssertEqual(resolved.phase, .feed)
        XCTAssertEqual(resolved.items.count, 1)
    }

    func testEmptyWhenNoItems() {
        let resolved = WidgetEventFeedProjection.resolve(input: WidgetEventFeedInput())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.items.isEmpty)
    }

    func testConnectivityNeverHidesTheList() {
        for connection in [WidgetEventFeedConnection.stale, .offline] {
            var input = populated()
            input.connection = connection
            let resolved = WidgetEventFeedProjection.resolve(input: input)
            XCTAssertEqual(resolved.phase, .feed, "\(connection) must keep the list")
            XCTAssertEqual(resolved.items.count, 1)
        }
    }

    func testFeedItemsAreArrangedNewestFirst() {
        let input = WidgetEventFeedInput(items: [
            makeItem(id: "old", timestamp: base),
            makeItem(id: "new", timestamp: base.addingTimeInterval(3600))
        ])
        XCTAssertEqual(WidgetEventFeedProjection.resolve(input: input).items.map(\.id), ["new", "old"])
    }

    func testEmptyMessageOverrideIsCarried() {
        let input = WidgetEventFeedInput(emptyMessage: "Nothing here", emptyIconSymbol: "checkmark.seal")
        let resolved = WidgetEventFeedProjection.resolve(input: input)
        XCTAssertEqual(resolved.emptyMessage, "Nothing here")
        XCTAssertEqual(resolved.emptyIconSymbol, "checkmark.seal")
    }
}

// MARK: - Accessibility

final class WidgetEventFeedAccessibilityTests: XCTestCase {
    func testLabelReadsSeverityTitleSubtitleThenTime() {
        let label = WidgetEventFeedAccessibility.rowLabel(
            severity: "Critical",
            title: "Tire pressure low",
            subtitle: "Front-left",
            time: "3h ago"
        )
        XCTAssertEqual(label, "Critical. Tire pressure low. Front-left. 3h ago")
    }

    func testLabelSkipsMissingSeverityAndSubtitle() {
        let label = WidgetEventFeedAccessibility.rowLabel(
            severity: nil,
            title: "Charging started",
            subtitle: nil,
            time: "Just now"
        )
        XCTAssertEqual(label, "Charging started. Just now")
    }

    func testLabelDoesNotDoubleTerminalPunctuation() {
        let label = WidgetEventFeedAccessibility.rowLabel(
            severity: nil,
            title: "Drive completed.",
            subtitle: nil,
            time: "5m ago"
        )
        XCTAssertEqual(label, "Drive completed. 5m ago")
    }

    func testLabelEmptyWhenAllEmpty() {
        XCTAssertEqual(
            WidgetEventFeedAccessibility.rowLabel(severity: nil, title: "", subtitle: "", time: ""),
            ""
        )
    }
}
