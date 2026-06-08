//
//  WeekSelector.Tests.swift
//  TeslaSync — P4 feature view · 0079 · WeekSelector (Apple)
//
//  Unit coverage for the WeekSelector surface:
//    • Adapter (selected `weekOffset` → Monday-based range / label /
//      current-week flag / Next gate / prev-next arithmetic) — the parity port of
//      web `getWeekRange`, `weekLabel`, `isCurrentWeek`, and the `goToNextWeek`
//      `!isCurrentWeek` gate, deterministic under an injected `now`/`Calendar`/
//      `Locale`.
//    • Accessibility — the composed VoiceOver copy for the center group.
//    • State holder — `WeekSelectorModel` phase resolution across loading /
//      loaded / empty / failed, the navigation wiring (prev steps back, next
//      clamps at the current week), the stale auto-refresh guard, plus the
//      P1/S11 `view.opened` telemetry + source wiring (start/stop/refresh/select).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryWeekSelectorSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixed clock helpers (deterministic week math)

private enum WeekSelectorFixtures {
    /// 2024-06-05T12:00:00Z — a Wednesday, so the current week is Mon 2024-06-03
    /// → Sun 2024-06-09 (`Jun 3 – Jun 9` in `en_US`).
    static let now = Date(timeIntervalSince1970: 1_717_588_800)

    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }

    static let locale = Locale(identifier: "en_US")
}

// MARK: - Adapter: week range / label / navigation arithmetic

final class WeekSelectorProjectionTests: XCTestCase {
    private let calendar = WeekSelectorFixtures.calendar
    private let locale = WeekSelectorFixtures.locale
    private let now = WeekSelectorFixtures.now

    func testCurrentWeekRangeStartsOnMonday() {
        let range = WeekSelectorProjection.weekRange(offset: 0, now: now, calendar: calendar)
        // Gregorian weekday: Sunday = 1 … Monday = 2.
        XCTAssertEqual(calendar.component(.weekday, from: range.start), 2)
        let spanDays = calendar.dateComponents([.day], from: range.start, to: range.end).day
        XCTAssertEqual(spanDays, 6)
    }

    func testCurrentWeekLabelMatchesTheWebShortDateJoin() {
        let label = WeekSelectorProjection.weekLabel(
            offset: 0, now: now, calendar: calendar, locale: locale
        )
        XCTAssertEqual(label, "Jun 3 – Jun 9")
    }

    func testPastWeekLabelShiftsBackSevenDays() {
        let label = WeekSelectorProjection.weekLabel(
            offset: -1, now: now, calendar: calendar, locale: locale
        )
        XCTAssertEqual(label, "May 27 – Jun 2")
    }

    func testLabelJoinsTheTwoShortEndpointsWithASpacedEnDash() {
        let range = WeekSelectorProjection.weekRange(offset: -3, now: now, calendar: calendar)
        let startText = WeekSelectorProjection.shortDate(range.start, calendar: calendar, locale: locale)
        let endText = WeekSelectorProjection.shortDate(range.end, calendar: calendar, locale: locale)
        let label = WeekSelectorProjection.weekLabel(
            offset: -3, now: now, calendar: calendar, locale: locale
        )
        XCTAssertEqual(label, "\(startText) – \(endText)")
        XCTAssertTrue(label.contains(" – "))
    }

    func testIsCurrentWeekIsTrueOnlyAtOffsetZero() {
        XCTAssertTrue(WeekSelectorProjection.isCurrentWeek(offset: 0))
        XCTAssertFalse(WeekSelectorProjection.isCurrentWeek(offset: -1))
        XCTAssertFalse(WeekSelectorProjection.isCurrentWeek(offset: -7))
    }

    func testNextIsEnabledOnlyOffTheCurrentWeek() {
        XCTAssertFalse(WeekSelectorProjection.canGoToNextWeek(offset: 0))
        XCTAssertTrue(WeekSelectorProjection.canGoToNextWeek(offset: -1))
        XCTAssertTrue(WeekSelectorProjection.canGoToNextWeek(offset: -5))
    }

    func testPreviousOffsetAlwaysStepsBack() {
        XCTAssertEqual(WeekSelectorProjection.previousOffset(from: 0), -1)
        XCTAssertEqual(WeekSelectorProjection.previousOffset(from: -4), -5)
    }

    func testNextOffsetClampsAtTheCurrentWeek() {
        XCTAssertEqual(WeekSelectorProjection.nextOffset(from: -3), -2)
        XCTAssertEqual(WeekSelectorProjection.nextOffset(from: -1), 0)
        XCTAssertEqual(WeekSelectorProjection.nextOffset(from: 0), 0)
    }
}

// MARK: - Accessibility: composed VoiceOver copy

final class WeekSelectorAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCurrentWeekSummaryAppendsTheCurrentQualifier() {
        let summary = WeekSelectorAccessibility.weekSummary(
            weekLabel: "Jun 3 – Jun 9", isCurrentWeek: true, localize: echo
        )
        XCTAssertEqual(summary, "Selected week, Jun 3 – Jun 9, Current")
    }

    func testPastWeekSummaryOmitsTheCurrentQualifier() {
        let summary = WeekSelectorAccessibility.weekSummary(
            weekLabel: "May 27 – Jun 2", isCurrentWeek: false, localize: echo
        )
        XCTAssertEqual(summary, "Selected week, May 27 – Jun 2")
    }
}

// MARK: - State holder: phase resolution

final class WeekSelectorPhaseTests: XCTestCase {
    func testLoadingResolvesToLoading() {
        XCTAssertEqual(WeekSelectorModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(WeekSelectorModel.resolvePhase(status: .loading, hasData: true), .loading)
    }

    func testLoadedWithDataIsContent() {
        XCTAssertEqual(WeekSelectorModel.resolvePhase(status: .loaded, hasData: true), .content)
    }

    func testLoadedWithoutDataIsEmpty() {
        XCTAssertEqual(WeekSelectorModel.resolvePhase(status: .loaded, hasData: false), .empty)
    }

    func testExplicitEmptyStatusIsEmpty() {
        XCTAssertEqual(WeekSelectorModel.resolvePhase(status: .empty, hasData: false), .empty)
    }

    func testFailureAlwaysResolvesToError() {
        XCTAssertEqual(
            WeekSelectorModel.resolvePhase(status: .failed("boom"), hasData: true),
            .error("boom")
        )
    }
}

// MARK: - State holder: navigation + telemetry + source wiring

@MainActor
final class WeekSelectorModelTests: XCTestCase {
    /// Telemetry spy capturing each `view.opened` surface slug.
    private final class SpyTelemetry: WeekSelectorTelemetry, @unchecked Sendable {
        private(set) var surfaces: [String] = []
        func viewOpened(surface: String) {
            surfaces.append(surface)
        }
    }

    private func makeModel(
        source: InMemoryWeekSelectorSource,
        telemetry: WeekSelectorTelemetry = OSLogWeekSelectorTelemetry(),
        initialOffset: Int = 0
    ) -> WeekSelectorModel {
        WeekSelectorModel(
            source: source,
            telemetry: telemetry,
            initialOffset: initialOffset,
            now: { WeekSelectorFixtures.now },
            calendar: WeekSelectorFixtures.calendar,
            locale: WeekSelectorFixtures.locale
        )
    }

    func testDerivedLabelAndFlagsMatchTheProjection() {
        let model = makeModel(source: InMemoryWeekSelectorSource())
        XCTAssertEqual(model.weekLabel, "Jun 3 – Jun 9")
        XCTAssertTrue(model.isCurrentWeek)
        XCTAssertFalse(model.canGoToNextWeek)
    }

    func testStartEmitsViewOpenedOnceAndSelectsTheInitialWeek() {
        let spy = SpyTelemetry()
        let source = InMemoryWeekSelectorSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [WeekSelector.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.selectedOffsets, [0])
    }

    func testPreviousWeekStepsBackAndReselects() {
        let source = InMemoryWeekSelectorSource()
        let model = makeModel(source: source)
        model.start()
        model.goToPreviousWeek()
        XCTAssertEqual(model.weekOffset, -1)
        XCTAssertFalse(model.isCurrentWeek)
        XCTAssertTrue(model.canGoToNextWeek)
        XCTAssertEqual(model.weekLabel, "May 27 – Jun 2")
        XCTAssertEqual(source.selectedOffsets, [0, -1])
    }

    func testNextWeekAdvancesTowardThePresentAndClamps() {
        let source = InMemoryWeekSelectorSource()
        let model = makeModel(source: source, initialOffset: -2)
        model.start()
        model.goToNextWeek()
        XCTAssertEqual(model.weekOffset, -1)
        model.goToNextWeek()
        XCTAssertEqual(model.weekOffset, 0)
        XCTAssertTrue(model.isCurrentWeek)
        XCTAssertEqual(source.selectedOffsets, [-2, -1, 0])
    }

    func testNextWeekIsANoOpOnTheCurrentWeek() {
        let source = InMemoryWeekSelectorSource()
        let model = makeModel(source: source)
        model.start()
        model.goToNextWeek()
        XCTAssertEqual(model.weekOffset, 0)
        XCTAssertEqual(source.selectedOffsets, [0])
    }

    func testPushedSnapshotUpdatesPhaseConnectionAndData() {
        let source = InMemoryWeekSelectorSource()
        let model = makeModel(source: source)
        model.start()
        source.push(WeekSelectorUpdate(status: .loaded, connection: .offline, hasData: true))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.hasData)
    }

    func testStaleConnectionAutoRefreshesExactlyOncePerEpisode() {
        let source = InMemoryWeekSelectorSource()
        let model = makeModel(source: source)
        model.start()
        source.push(WeekSelectorUpdate(status: .loaded, connection: .stale, hasData: true))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(WeekSelectorUpdate(status: .loaded, connection: .stale, hasData: true))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(WeekSelectorUpdate(status: .loaded, connection: .live, hasData: true))
        source.push(WeekSelectorUpdate(status: .loaded, connection: .stale, hasData: true))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineConnectionDoesNotAutoRefresh() {
        let source = InMemoryWeekSelectorSource()
        let model = makeModel(source: source)
        model.start()
        source.push(WeekSelectorUpdate(status: .loaded, connection: .offline, hasData: true))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshAndStopDelegateToTheSource() {
        let spy = SpyTelemetry()
        let source = InMemoryWeekSelectorSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        model.start()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testStartReplaysTheInitialSnapshot() {
        let source = InMemoryWeekSelectorSource(
            initial: WeekSelectorUpdate(status: .loaded, connection: .stale, hasData: false)
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertFalse(model.hasData)
    }
}
