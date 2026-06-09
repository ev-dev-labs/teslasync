//
//  SignalHealthWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0088 · SignalHealthWidget (Apple)
//
//  Unit coverage for the SignalHealthWidget surface:
//    • Adapter (cached → projection) — `SignalHealthAdapter` parity with the web
//      `analysis` / `healthLevel` `useMemo`: the total / active / gap counts, the
//      5-minute stale threshold, the freshness age, the gap-list sort (no-seen
//      first, then oldest), the health-level ratio test, the `formatAge` /
//      `formatRelative` / `fmtInt` formatter ports, and the `hasData` decision.
//    • State holder — `SignalHealthModel` phase resolution across loading / empty
//      / error / content, plus the P1/S11 `view.opened` telemetry + source wiring
//      + freshness/projection tracking + compact/wide thresholds.
//    • Registry — canonical `signal-health` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + gap-row label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySignalHealthSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

private let enUS = SignalHealthFormatOptions(localeIdentifier: "en-US", timeZoneIdentifier: "UTC")
private let fixedNow = Date(timeIntervalSince1970: 1_000_000)

private func ago(_ seconds: TimeInterval) -> Date {
    fixedNow.addingTimeInterval(-seconds)
}

private func entry(_ seconds: TimeInterval) -> SignalHealthLiveEntry {
    SignalHealthLiveEntry(timestamp: fixedNow.addingTimeInterval(-seconds))
}

private let gapEntry = SignalHealthLiveEntry(timestamp: nil)

// MARK: - Adapter: cached DTO → projection (parity with the web source)

@MainActor final class SignalHealthAdapterTests: XCTestCase {
    func testTotalSignalsIsAvailableNameCount() {
        let projection = SignalHealthAdapter.project(
            signals: ["a", "b", "c"],
            liveEntries: [:],
            statsAvailable: false,
            now: fixedNow,
            options: enUS
        )
        XCTAssertEqual(projection.totalSignals, 3)
        XCTAssertEqual(projection.totalSignalsText, "3")
    }

    func testFreshUnderThresholdCountsActiveStaleAboveCountsGap() {
        let projection = SignalHealthAdapter.project(
            signals: nil,
            liveEntries: [
                "fresh": entry(10),
                "alsoFresh": entry(120),
                "stale": entry(10 * 60)
            ],
            statsAvailable: false,
            now: fixedNow,
            options: enUS
        )
        XCTAssertEqual(projection.activeCount, 2)
        XCTAssertEqual(projection.staleCount, 1)
        XCTAssertEqual(projection.coveredText, "2/3")
    }

    func testStaleThresholdIsExclusiveAtFiveMinutes() {
        // Exactly 300s old is NOT stale (web `age > STALE_THRESHOLD_MS`).
        let atThreshold = SignalHealthAdapter.project(
            signals: nil,
            liveEntries: ["edge": entry(300)],
            statsAvailable: false,
            now: fixedNow,
            options: enUS
        )
        XCTAssertEqual(atThreshold.activeCount, 1)
        XCTAssertEqual(atThreshold.staleCount, 0)

        // Just over 300s is stale.
        let overThreshold = SignalHealthAdapter.project(
            signals: nil,
            liveEntries: ["edge": entry(301)],
            statsAvailable: false,
            now: fixedNow,
            options: enUS
        )
        XCTAssertEqual(overThreshold.activeCount, 0)
        XCTAssertEqual(overThreshold.staleCount, 1)
    }

    func testMissingTimestampCountsAsGap() {
        let projection = SignalHealthAdapter.project(
            signals: nil,
            liveEntries: ["noStamp": gapEntry],
            statsAvailable: false,
            now: fixedNow,
            options: enUS
        )
        XCTAssertEqual(projection.activeCount, 0)
        XCTAssertEqual(projection.staleCount, 1)
        XCTAssertEqual(projection.gapSignals.first?.name, "noStamp")
        XCTAssertNil(projection.gapSignals.first?.lastSeen)
        XCTAssertEqual(projection.gapSignals.first?.lastSeenText, "—")
    }

    func testGapSortPutsNoSeenFirstThenOldest() {
        let projection = SignalHealthAdapter.project(
            signals: nil,
            liveEntries: [
                "bGap": gapEntry,
                "aGap": gapEntry,
                "newerStale": entry(10 * 60),
                "olderStale": entry(20 * 60)
            ],
            statsAvailable: false,
            now: fixedNow,
            options: enUS
        )
        // No-last-seen first (by name), then oldest-seen first.
        XCTAssertEqual(projection.gapSignals.map(\.name), ["aGap", "bGap", "olderStale", "newerStale"])
    }

    func testFreshnessAgeIsNewestEntryAgeInSeconds() {
        let projection = SignalHealthAdapter.project(
            signals: nil,
            liveEntries: [
                "newest": entry(15),
                "older": entry(600)
            ],
            statsAvailable: false,
            now: fixedNow,
            options: enUS
        )
        XCTAssertEqual(projection.freshnessAgeSeconds, 15)
        XCTAssertEqual(projection.freshnessText, "15s ago")
    }

    func testFreshnessAgeNilWhenNoTimestamps() {
        let projection = SignalHealthAdapter.project(
            signals: nil,
            liveEntries: ["noStamp": gapEntry],
            statsAvailable: false,
            now: fixedNow,
            options: enUS
        )
        XCTAssertNil(projection.freshnessAgeSeconds)
        XCTAssertEqual(projection.freshnessText, "—")
    }

    func testHealthLevelRatioBoundaries() {
        XCTAssertEqual(SignalHealthAdapter.healthLevel(activeCount: 0, staleCount: 0), .neutral)
        XCTAssertEqual(SignalHealthAdapter.healthLevel(activeCount: 3, staleCount: 0), .green)
        XCTAssertEqual(SignalHealthAdapter.healthLevel(activeCount: 3, staleCount: 1), .amber)
        XCTAssertEqual(SignalHealthAdapter.healthLevel(activeCount: 1, staleCount: 1), .red)
        XCTAssertEqual(SignalHealthAdapter.healthLevel(activeCount: 1, staleCount: 3), .red)
    }

    func testAgeFormatterMatchesWebFormatAge() {
        XCTAssertEqual(SignalHealthFormat.age(seconds: nil), "—")
        XCTAssertEqual(SignalHealthFormat.age(seconds: 5), "5s ago")
        XCTAssertEqual(SignalHealthFormat.age(seconds: 59), "59s ago")
        XCTAssertEqual(SignalHealthFormat.age(seconds: 60), "1m ago")
        XCTAssertEqual(SignalHealthFormat.age(seconds: 600), "10m ago")
        XCTAssertEqual(SignalHealthFormat.age(seconds: 3599), "59m ago")
        XCTAssertEqual(SignalHealthFormat.age(seconds: 3600), "1h ago")
        XCTAssertEqual(SignalHealthFormat.age(seconds: 7200), "2h ago")
    }

    func testRelativeFormatterMatchesWebFormatRelative() {
        XCTAssertEqual(SignalHealthFormat.relative(nil, now: fixedNow, options: enUS), "—")
        XCTAssertEqual(SignalHealthFormat.relative(ago(30), now: fixedNow, options: enUS), "just now")
        XCTAssertEqual(SignalHealthFormat.relative(ago(120), now: fixedNow, options: enUS), "2m ago")
        XCTAssertEqual(SignalHealthFormat.relative(ago(3 * 3600), now: fixedNow, options: enUS), "3h ago")
        XCTAssertEqual(SignalHealthFormat.relative(ago(2 * 86400), now: fixedNow, options: enUS), "2d ago")
        // Beyond a week falls back to the absolute "MMM d, yyyy" date.
        XCTAssertEqual(SignalHealthFormat.relative(ago(10 * 86400), now: fixedNow, options: enUS), "Jan 2, 1970")
    }

    func testIntegerFormattingGroupsThousands() {
        XCTAssertEqual(SignalHealthFormat.integer(0, locale: enUS.locale), "0")
        XCTAssertEqual(SignalHealthFormat.integer(7, locale: enUS.locale), "7")
        XCTAssertEqual(SignalHealthFormat.integer(1234, locale: enUS.locale), "1,234")
    }

    func testHasDataMirrorsWebTruthiness() {
        // All three sources unresolved → no data (web initial render).
        let none = SignalHealthAdapter.project(
            signals: nil, liveEntries: nil, statsAvailable: false, now: fixedNow, options: enUS
        )
        XCTAssertFalse(none.hasData)

        // Stats present alone → data (web `stats || …`).
        let stats = SignalHealthAdapter.project(
            signals: nil, liveEntries: nil, statsAvailable: true, now: fixedNow, options: enUS
        )
        XCTAssertTrue(stats.hasData)

        // An empty-but-resolved signals array is still "present" (web `[]` is truthy).
        let emptySignals = SignalHealthAdapter.project(
            signals: [], liveEntries: nil, statsAvailable: false, now: fixedNow, options: enUS
        )
        XCTAssertTrue(emptySignals.hasData)

        // An empty-but-resolved live map is still "present" (web `{}` is truthy).
        let emptyLive = SignalHealthAdapter.project(
            signals: nil, liveEntries: [:], statsAvailable: false, now: fixedNow, options: enUS
        )
        XCTAssertTrue(emptyLive.hasData)
    }

    func testGreenWhenAllFresh() {
        let projection = SignalHealthAdapter.project(
            signals: ["a", "b"],
            liveEntries: ["a": entry(5), "b": entry(20)],
            statsAvailable: true,
            now: fixedNow,
            options: enUS
        )
        XCTAssertEqual(projection.healthLevel, .green)
        XCTAssertFalse(projection.hasGapSignals)
        XCTAssertEqual(projection.activeCountText, "2")
        XCTAssertEqual(projection.staleCountText, "0")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class SignalHealthModelTests: XCTestCase {
    private func makeModel(
        _ update: SignalHealthUpdate,
        telemetry: SignalHealthTelemetry = OSLogSignalHealthTelemetry()
    ) -> (SignalHealthModel, InMemorySignalHealthSource) {
        let source = InMemorySignalHealthSource(initial: update)
        let model = SignalHealthModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SignalHealthUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(SignalHealthUpdate(status: .loaded, signals: nil, liveEntries: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SignalHealthUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let loadingWithData = SignalHealthUpdate(
            status: .loading, signals: ["a"], liveEntries: ["a": entry(5)], statsAvailable: true, now: fixedNow
        )
        let (loading, _) = makeModel(loadingWithData)
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let failedWithData = SignalHealthUpdate(
            status: .failed("net"), signals: ["a"], liveEntries: ["a": entry(5)], statsAvailable: true, now: fixedNow
        )
        let (failed, _) = makeModel(failedWithData)
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySignalHealthTelemetry()
        let (model, source) = makeModel(SignalHealthUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SignalHealthWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SignalHealthUpdate(status: .loaded, statsAvailable: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(SignalHealthUpdate(status: .loading))
        model.start()
        source.push(
            SignalHealthUpdate(
                status: .loaded,
                connection: .offline,
                signals: ["a", "b", "c"],
                liveEntries: ["a": entry(5), "b": entry(600), "c": gapEntry],
                statsAvailable: true,
                now: fixedNow,
                options: enUS,
                updatedAt: ago(0)
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.totalSignals, 3)
        XCTAssertEqual(model.projection.activeCount, 1)
        XCTAssertEqual(model.projection.staleCount, 2)
        XCTAssertTrue(model.projection.hasGapSignals)
        XCTAssertEqual(model.updatedAt, fixedNow)
    }

    func testIsCompactAndWideThresholds() {
        XCTAssertTrue(SignalHealthModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(SignalHealthModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertFalse(SignalHealthModel.isWide(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(SignalHealthModel.isWide(for: DashboardWidgetSize(cols: 3, rows: 4)))
        XCTAssertTrue(SignalHealthModel.isWide(for: DashboardWidgetSize(cols: 4, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor final class SignalHealthRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SignalHealthWidget.registration
        XCTAssertEqual(registration.id, "signal-health")
        XCTAssertEqual(registration.category, "telemetry")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SignalHealthWidget.surfaceSlug, "SignalHealthWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = SignalHealthWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 10)),
            DashboardWidgetSize(cols: 3, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class SignalHealthAccessibilityTests: XCTestCase {
    func testSummaryIncludesTitleCountsAndStatus() {
        let projection = SignalHealthAdapter.project(
            signals: ["a", "b", "c", "d"],
            liveEntries: ["a": entry(5), "b": entry(5), "c": entry(600), "d": gapEntry],
            statsAvailable: true,
            now: fixedNow,
            options: enUS
        )
        let summary = SignalHealthAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Signal Health"))
        XCTAssertTrue(summary.contains("4 total signals"))
        XCTAssertTrue(summary.contains("2 active"))
        XCTAssertTrue(summary.contains("2 with gaps"))
        XCTAssertTrue(summary.contains("Status"))
        XCTAssertTrue(summary.contains("Critical"))
    }

    func testSummaryHandlesNoData() {
        let projection = SignalHealthAdapter.project(
            signals: nil, liveEntries: nil, statsAvailable: false, now: fixedNow, options: enUS
        )
        let summary = SignalHealthAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Signal Health"))
        XCTAssertTrue(summary.contains("No signal health data"))
    }

    func testGapLabelIncludesNameAndLastSeen() {
        let label = SignalHealthAccessibility.gapLabel(name: "VehicleSpeed", lastSeen: "12m ago")
        XCTAssertTrue(label.contains("VehicleSpeed"))
        XCTAssertTrue(label.contains("12m ago"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalHealthTelemetry: SignalHealthTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
