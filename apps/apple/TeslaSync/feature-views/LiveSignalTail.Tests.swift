//
//  LiveSignalTail.Tests.swift
//  TeslaSync — P4 feature view · 0263 · LiveSignalTail (Apple)
//
//  Unit coverage for the LiveSignalTail surface:
//    • Adapter (cached → projection) — `LiveSignalTailFormat` + `…Builder` parity
//      with the web `formatTime` / `<FreshnessIndicator>` math / filter + stats.
//    • State holder — `LiveSignalTailModel` phase resolution across loading / empty
//      / error / content, the P1/S11 `view.opened` telemetry, and the
//      pause / clear / refresh / auto-scroll / filter wiring.
//    • Accessibility — the VoiceOver tail summary + row labels + age labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryLiveSignalTailSource`. The pure
//  adapter subset is additionally proven by an executed host harness (gate log).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: timestamp + clock + age + freshness + bucket

@MainActor final class LiveSignalTailFormatTests: XCTestCase {
    func testParseTimestampHandlesIsoVariantsAndJunk() {
        XCTAssertNotNil(LiveSignalTailFormat.parseTimestamp("2026-06-07T19:00:00Z"))
        XCTAssertNotNil(LiveSignalTailFormat.parseTimestamp("2026-06-07T19:00:00.500Z"))
        XCTAssertNil(LiveSignalTailFormat.parseTimestamp(nil))
        XCTAssertNil(LiveSignalTailFormat.parseTimestamp(""))
        XCTAssertNil(LiveSignalTailFormat.parseTimestamp("not-a-date"))
    }

    func testClockReturnsDashForNilAndTimeForDate() {
        XCTAssertEqual(LiveSignalTailFormat.clock(nil, locale: Locale(identifier: "en_US"), timeZone: .gmt), "—")
        let date = Date(timeIntervalSince1970: 1_000_000)
        let text = LiveSignalTailFormat.clock(date, locale: Locale(identifier: "en_US"), timeZone: .gmt)
        XCTAssertFalse(text.isEmpty)
        XCTAssertTrue(text.contains(where: \.isNumber), "expected a clock with digits, got \(text)")
    }

    func testClockDiffersForDifferentInstants() {
        let locale = Locale(identifier: "en_US")
        let early = LiveSignalTailFormat.clock(Date(timeIntervalSince1970: 0), locale: locale, timeZone: .gmt)
        let later = LiveSignalTailFormat.clock(Date(timeIntervalSince1970: 3600), locale: locale, timeZone: .gmt)
        XCTAssertNotEqual(early, later)
    }

    func testAgeIsFlooredSecondsClampedAtZero() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(LiveSignalTailFormat.age(of: now.addingTimeInterval(-65), now: now), 65)
        XCTAssertEqual(LiveSignalTailFormat.age(of: now.addingTimeInterval(-0.9), now: now), 0)
        XCTAssertEqual(LiveSignalTailFormat.age(of: now.addingTimeInterval(30), now: now), 0)
        XCTAssertNil(LiveSignalTailFormat.age(of: nil, now: now))
    }

    func testFreshnessBucketsMatchWebThresholds() {
        XCTAssertEqual(LiveSignalTailFormat.freshness(forAge: nil), .unknown)
        XCTAssertEqual(LiveSignalTailFormat.freshness(forAge: 0), .fresh)
        XCTAssertEqual(LiveSignalTailFormat.freshness(forAge: 119), .fresh)
        XCTAssertEqual(LiveSignalTailFormat.freshness(forAge: 120), .stale)
        XCTAssertEqual(LiveSignalTailFormat.freshness(forAge: 599), .stale)
        XCTAssertEqual(LiveSignalTailFormat.freshness(forAge: 600), .offline)
    }

    func testAgeBucketMatchesWebFormatAge() {
        XCTAssertEqual(LiveSignalTailFormat.ageBucket(nil), .none)
        XCTAssertEqual(LiveSignalTailFormat.ageBucket(0), .justNow)
        XCTAssertEqual(LiveSignalTailFormat.ageBucket(9), .justNow)
        XCTAssertEqual(LiveSignalTailFormat.ageBucket(10), .seconds(10))
        XCTAssertEqual(LiveSignalTailFormat.ageBucket(59), .seconds(59))
        XCTAssertEqual(LiveSignalTailFormat.ageBucket(60), .minutes(1))
        XCTAssertEqual(LiveSignalTailFormat.ageBucket(3599), .minutes(59))
        XCTAssertEqual(LiveSignalTailFormat.ageBucket(3600), .hours(1))
        XCTAssertEqual(LiveSignalTailFormat.ageBucket(7320), .hours(2))
    }
}

// MARK: - Adapter: projection + filter + stats

@MainActor final class LiveSignalTailBuilderTests: XCTestCase {
    private func entry(_ id: Int, _ name: String, _ value: String, _ kind: LiveSignalTailValueKind) -> SignalTailEntry {
        SignalTailEntry(id: id, name: name, value: value, kind: kind, timestampRaw: "", timestamp: nil)
    }

    func testBuildProjectionPreservesOrderAndCountsUnique() {
        let entries = [
            entry(3, "vehicle_speed", "42", .number),
            entry(2, "vehicle_speed", "41", .number),
            entry(1, "charging_state", "Charging", .string)
        ]
        let projection = LiveSignalTailBuilder.buildProjection(from: entries)
        XCTAssertEqual(projection.entries.map(\.id), [3, 2, 1])
        XCTAssertEqual(projection.uniqueSignals, 2)
        XCTAssertTrue(projection.hasData)
    }

    func testEmptyProjectionHasNoData() {
        XCTAssertFalse(LiveSignalTailBuilder.buildProjection(from: []).hasData)
        XCTAssertEqual(LiveSignalTailProjection.empty.entries, [])
        XCTAssertEqual(LiveSignalTailProjection.empty.uniqueSignals, 0)
    }

    func testFilterIsCaseInsensitiveSubstringWithoutTrim() {
        let entries = [
            entry(1, "vehicle_speed", "42", .number),
            entry(2, "battery_level", "78", .number),
            entry(3, "charging_state", "Charging", .string)
        ]
        XCTAssertEqual(LiveSignalTailBuilder.filter(entries, query: "bat").map(\.id), [2])
        XCTAssertEqual(LiveSignalTailBuilder.filter(entries, query: "SPEED").map(\.id), [1])
        XCTAssertEqual(LiveSignalTailBuilder.filter(entries, query: "").count, entries.count)
        XCTAssertTrue(LiveSignalTailBuilder.filter(entries, query: "zzz").isEmpty)
    }

    func testFilterDoesNotTrimWhitespace() {
        // The web `filter ? ... : entries` does NOT trim; a non-empty space query is
        // a real (narrowing) filter, unlike a trimmed one which would match all.
        let entries = [entry(1, "vehicle_speed", "42", .number), entry(2, "battery_level", "78", .number)]
        XCTAssertTrue(LiveSignalTailBuilder.filter(entries, query: " ").isEmpty)
    }

    func testStatsDeriveFromBufferAndFilteredCount() {
        let entries = [
            entry(1, "a", "1", .number),
            entry(2, "b", "2", .number),
            entry(3, "a", "3", .number)
        ]
        let projection = LiveSignalTailBuilder.buildProjection(from: entries)
        let stats = LiveSignalTailBuilder.stats(projection: projection, rate: 9, bufferMax: 500, filteredCount: 2)
        XCTAssertEqual(stats.rate, 9)
        XCTAssertEqual(stats.bufferUsed, 3)
        XCTAssertEqual(stats.bufferMax, 500)
        XCTAssertEqual(stats.unique, 2)
        XCTAssertEqual(stats.filtered, 2)
    }
}

// MARK: - State holder: phases + telemetry + control wiring

@MainActor final class LiveSignalTailModelTests: XCTestCase {
    private func makeModel(
        _ update: LiveSignalTailUpdate,
        telemetry: LiveSignalTailTelemetry = OSLogLiveSignalTailTelemetry()
    ) -> (LiveSignalTailModel, InMemoryLiveSignalTailSource) {
        let source = InMemoryLiveSignalTailSource(initial: update)
        let model = LiveSignalTailModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func entries() -> [SignalTailEntry] {
        [
            SignalTailEntry(id: 3, name: "vehicle_speed", value: "42", kind: .number, timestampRaw: "", timestamp: nil),
            SignalTailEntry(id: 2, name: "battery_level", value: "78", kind: .number, timestampRaw: "", timestamp: nil),
            SignalTailEntry(
                id: 1,
                name: "charging_state",
                value: "Charging",
                kind: .string,
                timestampRaw: "",
                timestamp: nil
            )
        ]
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(LiveSignalTailUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.isFetching)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(LiveSignalTailUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutBufferShowsError() {
        let (model, _) = makeModel(LiveSignalTailUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let (loading, _) = makeModel(LiveSignalTailUpdate(status: .loading, entries: entries()))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(LiveSignalTailUpdate(status: .failed("net"), entries: entries()))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyLiveSignalTailTelemetry()
        let (model, source) = makeModel(LiveSignalTailUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LiveSignalTail.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testControlsDelegateToSource() {
        let (model, source) = makeModel(LiveSignalTailUpdate(status: .loaded, entries: entries()))
        model.start()
        model.togglePause()
        model.clear()
        model.refresh()
        model.refresh()
        model.stop()
        model.start()
        XCTAssertEqual(source.pauseToggleCount, 1)
        XCTAssertEqual(source.clearCount, 1)
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }

    func testTogglePauseFlipsOptimisticFlag() {
        let (model, _) = makeModel(LiveSignalTailUpdate(status: .loaded, entries: entries()))
        model.start()
        XCTAssertFalse(model.paused)
        model.togglePause()
        XCTAssertTrue(model.paused)
    }

    func testToggleAutoScrollFlipsState() {
        let (model, _) = makeModel(LiveSignalTailUpdate(status: .loaded, entries: entries()))
        model.start()
        XCTAssertTrue(model.autoScroll)
        model.toggleAutoScroll()
        XCTAssertFalse(model.autoScroll)
    }

    func testUpdateTracksConnectionRateBufferAndPaused() {
        let (model, source) = makeModel(LiveSignalTailUpdate(status: .loading))
        model.start()
        source.push(LiveSignalTailUpdate(
            status: .loaded,
            connection: .offline,
            entries: entries(),
            rate: 7,
            bufferMax: 250,
            paused: true,
            updatedAt: Date()
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.rate, 7)
        XCTAssertEqual(model.bufferMax, 250)
        XCTAssertTrue(model.paused)
        XCTAssertEqual(model.projection.entries.count, 3)
        XCTAssertFalse(model.isFetching)
    }

    func testFilterNarrowsDisplayedEntriesAndStats() {
        let (model, _) = makeModel(LiveSignalTailUpdate(status: .loaded, entries: entries(), rate: 3, bufferMax: 500))
        model.start()
        model.filterText = "speed"
        XCTAssertEqual(model.displayedEntries.map(\.id), [3])
        XCTAssertEqual(model.stats.filtered, 1)
        XCTAssertEqual(model.stats.bufferUsed, 3)
        XCTAssertEqual(model.stats.unique, 3)
        XCTAssertFalse(model.isFilteredEmpty)
    }

    func testIsFilteredEmptyWhenFilterHidesEverything() {
        let (model, _) = makeModel(LiveSignalTailUpdate(status: .loaded, entries: entries()))
        model.start()
        model.filterText = "zzz"
        XCTAssertTrue(model.displayedEntries.isEmpty)
        XCTAssertTrue(model.isFilteredEmpty)
    }
}

// MARK: - Accessibility

@MainActor final class LiveSignalTailAccessibilityTests: XCTestCase {
    func testTailSummaryFallsBackToWaiting() {
        XCTAssertEqual(LiveSignalTailAccessibility.tailSummary(rowCount: 0), LiveSignalTailStrings.waiting)
    }

    func testTailSummaryIncludesCount() {
        XCTAssertTrue(LiveSignalTailAccessibility.tailSummary(rowCount: 4).contains("4"))
    }

    func testRowLabelIncludesEveryColumn() {
        let label = LiveSignalTailAccessibility.rowLabel(
            LiveSignalTailRowSpeech(
                time: "02:30",
                name: "vehicle_speed",
                value: "42",
                kind: .number,
                age: "2m ago",
                freshness: .fresh
            )
        )
        XCTAssertTrue(label.contains("02:30"))
        XCTAssertTrue(label.contains("vehicle_speed"))
        XCTAssertTrue(label.contains("42"))
        XCTAssertTrue(label.contains("number"))
        XCTAssertTrue(label.contains("2m ago"))
        XCTAssertTrue(label.contains(LiveSignalTailStrings.freshnessLabel(.fresh)))
    }

    func testRowLabelFallsBackWhenNoAge() {
        let label = LiveSignalTailAccessibility.rowLabel(
            LiveSignalTailRowSpeech(
                time: "—",
                name: "locked",
                value: "true",
                kind: .boolean,
                age: "",
                freshness: .unknown
            )
        )
        XCTAssertTrue(label.contains(LiveSignalTailStrings.noTimestamp))
    }

    func testAgeLabelFormatsBuckets() {
        XCTAssertEqual(LiveSignalTailStrings.ageLabel(.none), LiveSignalTailStrings.ageNone)
        XCTAssertEqual(LiveSignalTailStrings.ageLabel(.justNow), LiveSignalTailStrings.ageJustNow)
        XCTAssertTrue(LiveSignalTailStrings.ageLabel(.seconds(42)).contains("42"))
        XCTAssertTrue(LiveSignalTailStrings.ageLabel(.minutes(5)).contains("5"))
        XCTAssertTrue(LiveSignalTailStrings.ageLabel(.hours(3)).contains("3"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLiveSignalTailTelemetry: LiveSignalTailTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
