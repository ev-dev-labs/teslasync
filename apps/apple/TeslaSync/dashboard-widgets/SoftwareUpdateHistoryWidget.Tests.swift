//
//  SoftwareUpdateHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0091 · SoftwareUpdateHistoryWidget (Apple)
//
//  Unit coverage for the SoftwareUpdateHistoryWidget surface:
//    • Adapter (cached → projection) — `SoftwareUpdateProjection` status mapping,
//      `feedItems` parity with the web `STATUS_MAP` + `feedItems` `useMemo`
//      (isCurrent from original order, timestamp precedence, sort desc, slice 15),
//      the compact `latest` badge logic, and the `formatRelativeTime` port.
//    • State holder — `SoftwareUpdateHistoryModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + source
//      wiring + freshness/feed/latest projection.
//    • Registry — canonical `software-update-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySoftwareUpdateHistorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

private let enUS = Locale(identifier: "en_US")
private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

private func minutesBefore(_ minutes: Int) -> Date {
    fixedNow.addingTimeInterval(TimeInterval(-minutes * 60))
}

private func daysBefore(_ days: Int) -> Date {
    fixedNow.addingTimeInterval(TimeInterval(-days * 86400))
}

// MARK: - Adapter: status mapping (parity with the web STATUS_MAP)

@MainActor
final class SoftwareUpdateStatusTests: XCTestCase {
    func testRawParsingRoundTrips() {
        XCTAssertEqual(SoftwareUpdateStatus(raw: "installed"), .installed)
        XCTAssertEqual(SoftwareUpdateStatus(raw: "installing"), .installing)
        XCTAssertEqual(SoftwareUpdateStatus(raw: "downloading"), .downloading)
        XCTAssertEqual(SoftwareUpdateStatus(raw: "available"), .available)
        XCTAssertEqual(SoftwareUpdateStatus(raw: "scheduled"), .scheduled)
        XCTAssertEqual(SoftwareUpdateStatus(raw: "weird"), .other("weird"))
        XCTAssertEqual(SoftwareUpdateStatus(raw: "weird").rawValue, "weird")
    }

    func testToneMatchesWebStatusMap() {
        XCTAssertEqual(SoftwareUpdateStatus.installed.tone, .success)
        XCTAssertEqual(SoftwareUpdateStatus.installing.tone, .warning)
        XCTAssertEqual(SoftwareUpdateStatus.downloading.tone, .info)
        XCTAssertEqual(SoftwareUpdateStatus.available.tone, .neutral)
        XCTAssertEqual(SoftwareUpdateStatus.scheduled.tone, .scheduled)
        XCTAssertEqual(SoftwareUpdateStatus.other("x").tone, .neutral)
    }

    func testSymbolMatchesWebStatusMap() {
        XCTAssertEqual(SoftwareUpdateStatus.installed.symbol, "checkmark.circle.fill")
        XCTAssertEqual(SoftwareUpdateStatus.installing.symbol, "arrow.down.circle")
        XCTAssertEqual(SoftwareUpdateStatus.downloading.symbol, "arrow.down.circle")
        XCTAssertEqual(SoftwareUpdateStatus.available.symbol, "square.and.arrow.down")
        XCTAssertEqual(SoftwareUpdateStatus.scheduled.symbol, "clock")
        XCTAssertEqual(SoftwareUpdateStatus.other("x").symbol, "square.and.arrow.down")
    }

    func testSeverityMatchesWebStatusMap() {
        XCTAssertEqual(SoftwareUpdateStatus.installing.severity, .warning)
        XCTAssertEqual(SoftwareUpdateStatus.installed.severity, .info)
        XCTAssertEqual(SoftwareUpdateStatus.downloading.severity, .info)
        XCTAssertEqual(SoftwareUpdateStatus.available.severity, .info)
        XCTAssertEqual(SoftwareUpdateStatus.scheduled.severity, .info)
    }

    func testCompactToneMatchesWebVariantTernary() {
        XCTAssertEqual(SoftwareUpdateStatus.installed.compactTone, .success)
        XCTAssertEqual(SoftwareUpdateStatus.installing.compactTone, .warning)
        XCTAssertEqual(SoftwareUpdateStatus.downloading.compactTone, .info)
        XCTAssertEqual(SoftwareUpdateStatus.available.compactTone, .info)
        XCTAssertEqual(SoftwareUpdateStatus.scheduled.compactTone, .info)
        XCTAssertEqual(SoftwareUpdateStatus.other("x").compactTone, .info)
    }
}

// MARK: - Adapter: feed projection (parity with the web feedItems useMemo)

@MainActor
final class SoftwareUpdateProjectionTests: XCTestCase {
    func testCurrentIsFirstInstalledFromOriginalOrder() {
        let updates = [
            SoftwareUpdate(id: "a", version: "2024.8.7", status: .installed, installedAt: minutesBefore(40)),
            SoftwareUpdate(id: "b", version: "2024.8.3", status: .downloading, createdAt: minutesBefore(10)),
            SoftwareUpdate(id: "c", version: "2024.2.1", status: .scheduled, scheduledAt: daysBefore(2))
        ]
        let items = SoftwareUpdateProjection.feedItems(from: updates, now: fixedNow, locale: enUS)
        // Sorted by timestamp desc: b (10m) > a (40m) > c (2d).
        XCTAssertEqual(items.map(\.id), ["b", "a", "c"])
        // isCurrent is computed from the ORIGINAL order (index 0 == installed), not post-sort.
        XCTAssertEqual(items.first { $0.id == "a" }?.isCurrent, true)
        XCTAssertEqual(items.first { $0.id == "b" }?.isCurrent, false)
    }

    func testCurrentRowUsesCheckmarkCyanAndCurrentSubtitle() {
        let updates = [SoftwareUpdate(id: "a", version: "2024.8.7", status: .installed, installedAt: minutesBefore(5))]
        let item = SoftwareUpdateProjection.feedItems(from: updates, now: fixedNow, locale: enUS).first
        XCTAssertEqual(item?.symbol, "checkmark.circle.fill")
        XCTAssertEqual(item?.tone, .current)
        XCTAssertEqual(item?.subtitle, "Current")
        XCTAssertEqual(item?.title, "2024.8.7")
        XCTAssertEqual(item?.relativeTime, "5m ago")
    }

    func testNonCurrentRowUsesStatusLabelToneAndSymbol() {
        let updates = [
            SoftwareUpdate(id: "x", version: "2024.8.7", status: .installed, installedAt: minutesBefore(1)),
            SoftwareUpdate(id: "y", version: "2024.8.3", status: .downloading, createdAt: minutesBefore(90))
        ]
        let item = SoftwareUpdateProjection.feedItems(from: updates, now: fixedNow, locale: enUS)
            .first { $0.id == "y" }
        XCTAssertEqual(item?.subtitle, "Downloading")
        XCTAssertEqual(item?.tone, .info)
        XCTAssertEqual(item?.symbol, "arrow.down.circle")
        XCTAssertEqual(item?.relativeTime, "1h ago")
        XCTAssertEqual(item?.isCurrent, false)
    }

    func testInstalledButNotFirstIsNotCurrent() {
        let updates = [
            SoftwareUpdate(id: "a", version: "2024.8.7", status: .downloading, createdAt: minutesBefore(5)),
            SoftwareUpdate(id: "b", version: "2024.8.3", status: .installed, installedAt: minutesBefore(50))
        ]
        let installed = SoftwareUpdateProjection.feedItems(from: updates, now: fixedNow, locale: enUS)
            .first { $0.id == "b" }
        XCTAssertEqual(installed?.isCurrent, false)
        XCTAssertEqual(installed?.subtitle, "Installed")
        XCTAssertEqual(installed?.tone, .success)
    }

    func testTimestampPrecedenceInstalledThenScheduledThenCreated() {
        let installed = SoftwareUpdate(
            id: "1",
            status: .installed,
            installedAt: minutesBefore(10),
            scheduledAt: minutesBefore(20),
            createdAt: minutesBefore(30)
        )
        let scheduled = SoftwareUpdate(
            id: "2",
            status: .scheduled,
            scheduledAt: minutesBefore(20),
            createdAt: minutesBefore(30)
        )
        let created = SoftwareUpdate(id: "3", status: .available, createdAt: minutesBefore(30))
        XCTAssertEqual(SoftwareUpdateProjection.displayTimestamp(for: installed), minutesBefore(10))
        XCTAssertEqual(SoftwareUpdateProjection.displayTimestamp(for: scheduled), minutesBefore(20))
        XCTAssertEqual(SoftwareUpdateProjection.displayTimestamp(for: created), minutesBefore(30))
    }

    func testMissingAllTimestampsFallsBackToEpoch() {
        let update = SoftwareUpdate(id: "1", status: .available)
        XCTAssertEqual(SoftwareUpdateProjection.displayTimestamp(for: update), Date(timeIntervalSince1970: 0))
    }

    func testMissingVersionUsesDash() {
        let updates = [SoftwareUpdate(id: "1", version: nil, status: .available, createdAt: minutesBefore(5))]
        let item = SoftwareUpdateProjection.feedItems(from: updates, now: fixedNow, locale: enUS).first
        XCTAssertEqual(item?.title, "—")
    }

    func testFeedIsSlicedToMaxItems() {
        let updates = (1 ... 25).map {
            SoftwareUpdate(id: "\($0)", version: "v\($0)", status: .available, createdAt: minutesBefore($0))
        }
        let items = SoftwareUpdateProjection.feedItems(from: updates, now: fixedNow, locale: enUS)
        XCTAssertEqual(items.count, SoftwareUpdateProjection.maxItems)
        // Newest (smallest minutes-before) first.
        XCTAssertEqual(items.first?.id, "1")
    }

    func testEmptyHistoryProducesNoRowsAndNoLatest() {
        XCTAssertTrue(SoftwareUpdateProjection.feedItems(from: [], now: fixedNow, locale: enUS).isEmpty)
        XCTAssertNil(SoftwareUpdateProjection.latest(from: []))
    }
}

// MARK: - Adapter: compact latest badge (parity with the web CompactView)

@MainActor
final class SoftwareUpdateLatestTests: XCTestCase {
    func testInstalledLatestShowsCurrentSuccess() {
        let updates = [SoftwareUpdate(id: "1", version: "2024.8.7", status: .installed, installedAt: minutesBefore(5))]
        let latest = SoftwareUpdateProjection.latest(from: updates)
        XCTAssertEqual(latest?.version, "2024.8.7")
        XCTAssertEqual(latest?.statusLabel, "Current")
        XCTAssertEqual(latest?.tone, .success)
        XCTAssertEqual(latest?.isInstalled, true)
    }

    func testInstallingLatestShowsStatusWarning() {
        let updates = [SoftwareUpdate(id: "1", version: "2024.8.3", status: .installing, scheduledAt: minutesBefore(5))]
        let latest = SoftwareUpdateProjection.latest(from: updates)
        XCTAssertEqual(latest?.statusLabel, "Installing")
        XCTAssertEqual(latest?.tone, .warning)
        XCTAssertEqual(latest?.isInstalled, false)
    }

    func testOtherLatestShowsStatusInfo() {
        let updates = [SoftwareUpdate(id: "1", version: "2024.8.1", status: .downloading, createdAt: minutesBefore(5))]
        let latest = SoftwareUpdateProjection.latest(from: updates)
        XCTAssertEqual(latest?.statusLabel, "Downloading")
        XCTAssertEqual(latest?.tone, .info)
    }

    func testLatestUsesFirstElementNotNewest() {
        let updates = [
            SoftwareUpdate(id: "first", version: "OLD", status: .installed, installedAt: daysBefore(5)),
            SoftwareUpdate(id: "second", version: "NEW", status: .downloading, createdAt: minutesBefore(1))
        ]
        XCTAssertEqual(SoftwareUpdateProjection.latest(from: updates)?.version, "OLD")
    }
}

// MARK: - Adapter: relative-time formatter (port of formatRelativeTime)

@MainActor
final class SoftwareUpdateRelativeFormatterTests: XCTestCase {
    func testBuckets() {
        XCTAssertEqual(
            SoftwareUpdateRelativeFormatter.string(for: fixedNow.addingTimeInterval(-30), now: fixedNow, locale: enUS),
            "Just now"
        )
        XCTAssertEqual(
            SoftwareUpdateRelativeFormatter.string(for: minutesBefore(5), now: fixedNow, locale: enUS),
            "5m ago"
        )
        XCTAssertEqual(
            SoftwareUpdateRelativeFormatter.string(for: minutesBefore(180), now: fixedNow, locale: enUS),
            "3h ago"
        )
    }

    func testBoundaryAtOneMinuteAndOneHour() {
        XCTAssertEqual(
            SoftwareUpdateRelativeFormatter.string(for: minutesBefore(1), now: fixedNow, locale: enUS),
            "1m ago"
        )
        XCTAssertEqual(
            SoftwareUpdateRelativeFormatter.string(for: minutesBefore(60), now: fixedNow, locale: enUS),
            "1h ago"
        )
    }

    func testOverTwentyFourHoursUsesAbsoluteDate() {
        let absolute = SoftwareUpdateRelativeFormatter.string(for: daysBefore(3), now: fixedNow, locale: enUS)
        XCTAssertFalse(absolute.contains("ago"))
        XCTAssertFalse(absolute.isEmpty)
    }
}
