//
//  DashboardStatsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0033 · DashboardStatsWidget (Apple)
//
//  Unit coverage for the DashboardStatsWidget surface:
//    • Adapter (cached → projection) — `DashboardStatsProjector` value parity with the web widget's
//      stat grid (fmtInt(totalVehicles/totalTrips/totalChargingSessions), fsm.data?.state ?? '—'),
//      the compact `fmtInt(totalTrips)` big number, and the capitalized recent-transition rows.
//    • Relative time — `DashboardStatsRelativeTime` bucket parity with the web `formatRelative`.
//    • ISO parsing — `DashboardStatsDateParse` (web `new Date(iso)` / `isNaN` guard).
//    • State holder — `DashboardStatsModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `dashboard-stats` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryDashboardStatsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor final class DashboardStatsAdapterTests: XCTestCase {
    private let statsSample = DashboardStatsDTO(
        totalVehicles: 2,
        totalTrips: 1284,
        totalChargingSessions: 312
    )

    private func project(
        fsmState: String? = "driving",
        transitions: [DashboardTransitionDTO] = []
    ) -> DashboardStatsProjection {
        DashboardStatsProjector.project(
            stats: statsSample,
            fsmState: fsmState,
            transitions: transitions,
            units: DashboardStatsUnitPrefs(localeIdentifier: "en_US")
        )
    }

    /// Pins the four stat-grid cells in web source order with grouped integers + the raw FSM state.
    func testStatItemsMatchWebGrid() {
        let projection = project()
        XCTAssertEqual(projection.statItems.map(\.id), ["vehicles", "trips", "sessions", "fsm-state"])
        XCTAssertEqual(projection.statItems.map(\.label), ["Vehicles", "Trips", "Charge Sessions", "FSM State"])
        XCTAssertEqual(projection.statItems.map(\.value), ["2", "1,284", "312", "driving"])
    }

    /// The compact (1-column) layout centers `fmtInt(totalTrips)`.
    func testCompactTripValueIsGroupedTrips() {
        XCTAssertEqual(project().compactTripValue, "1,284")
    }

    /// A missing FSM query collapses to the em-dash (web `fsm.data?.state ?? '—'`) in both the stat
    /// value and the projection's `fsmState`.
    func testFsmStateDefaultsToEmDash() {
        let projection = project(fsmState: nil)
        XCTAssertEqual(projection.fsmState, "—")
        XCTAssertEqual(projection.statItems[3].value, "—")
        XCTAssertEqual(projection.fsmStateKind, .unknown)
    }

    /// A blank FSM state is treated as absent (em-dash), matching the StatusBadge empty guard.
    func testBlankFsmStateCollapsesToEmDash() {
        XCTAssertEqual(project(fsmState: "   ").fsmState, "—")
    }

    /// The FSM state drives the current-state badge dot kind (web `getStateDefinition('vehicle', …)`).
    func testFsmStateKindResolves() {
        XCTAssertEqual(project(fsmState: "driving").fsmStateKind, .driving)
        XCTAssertEqual(project(fsmState: "Charging").fsmStateKind, .charging)
        XCTAssertEqual(project(fsmState: "parked").fsmStateKind, .parked)
        XCTAssertEqual(project(fsmState: "updating").fsmStateKind, .updating)
        XCTAssertEqual(project(fsmState: "asleep").fsmStateKind, .asleep)
        XCTAssertEqual(project(fsmState: "offline").fsmStateKind, .offline)
        XCTAssertEqual(project(fsmState: "online").fsmStateKind, .online)
        XCTAssertEqual(project(fsmState: "bananas").fsmStateKind, .unknown)
    }

    /// Recent transitions keep source order + index, capitalize the state, and parse `startedAt`.
    func testTransitionsProjectInOrder() {
        let projection = project(transitions: [
            DashboardTransitionDTO(state: "driving", startedAt: "2026-06-08T22:46:38Z"),
            DashboardTransitionDTO(state: "parked", startedAt: "2026-06-08T21:00:00Z")
        ])
        XCTAssertEqual(projection.transitions.map(\.index), [0, 1])
        XCTAssertEqual(projection.transitions.map(\.label), ["Driving", "Parked"])
        XCTAssertEqual(projection.transitions.map(\.kind), [.driving, .parked])
        XCTAssertNotNil(projection.transitions.first?.startedAt)
    }

    /// A blank / unparseable transition collapses to the em-dash label + nil date (web `?? '—'`).
    func testBlankTransitionStateAndDate() {
        let projection = project(transitions: [DashboardTransitionDTO(state: "  ", startedAt: "")])
        XCTAssertEqual(projection.transitions.first?.label, "—")
        XCTAssertNil(projection.transitions.first?.startedAt)
    }

    /// `fmtInt` groups thousands and honors the locale (web `toLocaleString`).
    func testIntegerFormattingGroupsThousands() {
        XCTAssertEqual(DashboardStatsFormat.integer(0), "0")
        XCTAssertEqual(DashboardStatsFormat.integer(312), "312")
        XCTAssertEqual(DashboardStatsFormat.integer(1284), "1,284")
        XCTAssertEqual(DashboardStatsFormat.integer(1_000_000), "1,000,000")
    }

    /// Large counts still project as grouped integers in the grid + compact value.
    func testLargeCountsProjectGrouped() {
        let projection = DashboardStatsProjector.project(
            stats: DashboardStatsDTO(totalVehicles: 12, totalTrips: 48230, totalChargingSessions: 9001),
            fsmState: "online",
            transitions: [],
            units: DashboardStatsUnitPrefs(localeIdentifier: "en_US")
        )
        XCTAssertEqual(projection.statItems.map(\.value), ["12", "48,230", "9,001", "online"])
        XCTAssertEqual(projection.compactTripValue, "48,230")
    }
}

// MARK: - Relative time (port parity with web formatRelative)

@MainActor final class DashboardStatsRelativeTimeTests: XCTestCase {
    private let templates = DashboardStatsRelativeTime.Templates(
        justNow: "just now",
        minutesAgo: "%dm ago",
        hoursAgo: "%dh ago",
        daysAgo: "%dd ago",
        emDash: "—",
        localeIdentifier: "en_US"
    )

    private func label(secondsAgo: TimeInterval, now: Date = Date(timeIntervalSince1970: 1_700_000_000)) -> String {
        DashboardStatsRelativeTime.label(
            from: now.addingTimeInterval(-secondsAgo),
            now: now,
            templates: templates
        )
    }

    func testRelativeBucketsMatchWeb() {
        XCTAssertEqual(label(secondsAgo: 30), "just now")
        XCTAssertEqual(label(secondsAgo: 59), "just now")
        XCTAssertEqual(label(secondsAgo: 90), "1m ago")
        XCTAssertEqual(label(secondsAgo: 300), "5m ago")
        XCTAssertEqual(label(secondsAgo: 3600), "1h ago")
        XCTAssertEqual(label(secondsAgo: 7200), "2h ago")
        XCTAssertEqual(label(secondsAgo: 86400), "1d ago")
        XCTAssertEqual(label(secondsAgo: 3 * 86400), "3d ago")
    }

    func testNilDateRendersEmDash() {
        XCTAssertEqual(
            DashboardStatsRelativeTime.label(from: nil, now: Date(), templates: templates),
            "—"
        )
    }

    /// Beyond a week the web falls back to the absolute medium date (`formatDate`).
    func testBeyondAWeekRendersAbsoluteDate() {
        let date = Date(timeIntervalSince1970: 1_592_222_400) // 2020-06-15T12:00:00Z
        let now = date.addingTimeInterval(30 * 86400)
        let result = DashboardStatsRelativeTime.label(from: date, now: now, templates: templates)
        XCTAssertEqual(result, DashboardStatsRelativeTime.absoluteDate(date, localeIdentifier: "en_US"))
        XCTAssertTrue(result.contains("2020"), "expected absolute date to contain the year, got \(result)")
    }
}

// MARK: - ISO parsing (web new Date(iso) / isNaN guard)

@MainActor final class DashboardStatsDateParseTests: XCTestCase {
    func testParsesInternetDateTime() {
        XCTAssertNotNil(DashboardStatsDateParse.parse("2026-06-08T22:46:38Z"))
    }

    func testParsesFractionalSeconds() {
        XCTAssertNotNil(DashboardStatsDateParse.parse("2026-06-08T22:46:38.123Z"))
    }

    func testBlankAndInvalidReturnNil() {
        XCTAssertNil(DashboardStatsDateParse.parse(""))
        XCTAssertNil(DashboardStatsDateParse.parse("   "))
        XCTAssertNil(DashboardStatsDateParse.parse("not-a-date"))
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class DashboardStatsPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(DashboardStatsModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(DashboardStatsModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(DashboardStatsModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(DashboardStatsModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(DashboardStatsModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(DashboardStatsModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(DashboardStatsModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(DashboardStatsModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor final class DashboardStatsModelTests: XCTestCase {
    private func makeModel(
        _ update: DashboardStatsUpdate,
        telemetry: DashboardStatsTelemetry = OSLogDashboardStatsTelemetry()
    ) -> (DashboardStatsModel, InMemoryDashboardStatsSource) {
        let source = InMemoryDashboardStatsSource(initial: update)
        let model = DashboardStatsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(DashboardStatsUpdate(status: .loading, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testLoadedWithoutStatsShowsEmpty() {
        let (model, _) = makeModel(DashboardStatsUpdate(status: .loaded, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(DashboardStatsUpdate(status: .failed("boom"), stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStatsPresentShowsContentEvenWhileFailed() {
        let stats = DashboardStatsDTO(totalVehicles: 1, totalTrips: 5, totalChargingSessions: 2)
        let (model, _) = makeModel(
            DashboardStatsUpdate(status: .failed("net"), stats: stats, fsmState: "parked")
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.statItems.first?.value, "1")
        XCTAssertEqual(model.projection?.fsmState, "parked")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyDashboardStatsTelemetry()
        let (model, source) = makeModel(DashboardStatsUpdate(status: .loading, stats: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DashboardStatsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DashboardStatsUpdate(status: .loaded, stats: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let stats = DashboardStatsDTO(totalVehicles: 1, totalTrips: 5, totalChargingSessions: 2)
        let (model, source) = makeModel(DashboardStatsUpdate(status: .loaded, stats: stats))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(DashboardStatsUpdate(status: .loaded, connection: .stale, isFetching: true, stats: stats))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(DashboardStatsUpdate(status: .loaded, connection: .stale, isFetching: false, stats: stats))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(DashboardStatsUpdate(status: .loading, stats: nil))
        model.start()
        source.push(
            DashboardStatsUpdate(
                status: .loaded,
                connection: .offline,
                stats: DashboardStatsDTO(totalVehicles: 3, totalTrips: 2048, totalChargingSessions: 17),
                fsmState: "charging",
                transitions: [DashboardTransitionDTO(state: "driving", startedAt: "2026-06-08T22:46:38Z")],
                units: DashboardStatsUnitPrefs(localeIdentifier: "en_US"),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.statItems[1].value, "2,048")
        XCTAssertEqual(model.projection?.fsmState, "charging")
        XCTAssertEqual(model.projection?.transitions.count, 1)
    }
}

// MARK: - Registry parity

@MainActor final class DashboardStatsRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = DashboardStatsWidget.registration
        XCTAssertEqual(registration.id, "dashboard-stats")
        XCTAssertEqual(registration.category, "system")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(DashboardStatsWidget.surfaceSlug, "DashboardStatsWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = DashboardStatsWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }

    func testCompactAndWideThresholds() {
        XCTAssertTrue(DashboardStatsModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(DashboardStatsModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertFalse(DashboardStatsModel.isWide(for: DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertTrue(DashboardStatsModel.isWide(for: DashboardWidgetSize(cols: 3, rows: 4)))
        XCTAssertTrue(DashboardStatsModel.isWide(for: DashboardWidgetSize(cols: 4, rows: 4)))
    }
}

// MARK: - Accessibility summary content

@MainActor final class DashboardStatsAccessibilityTests: XCTestCase {
    func testSummaryReadsEveryStat() {
        let projection = DashboardStatsProjector.project(
            stats: DashboardStatsDTO(totalVehicles: 2, totalTrips: 1284, totalChargingSessions: 312),
            fsmState: "driving",
            transitions: [],
            units: DashboardStatsUnitPrefs(localeIdentifier: "en_US")
        )
        XCTAssertEqual(
            DashboardStatsAccessibility.summary(for: projection),
            "Dashboard Stats. Vehicles 2. Trips 1,284. Charge Sessions 312. FSM State driving"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDashboardStatsTelemetry: DashboardStatsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
