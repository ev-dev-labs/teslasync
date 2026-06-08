//
//  SuperchargerHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0098 · SuperchargerHistoryWidget (Apple)
//
//  Unit coverage for the SuperchargerHistoryWidget surface:
//    • Adapter (cached → projection) — `SuperchargerHistoryAdapter` sort/slice
//      parity with the web `rankedItems` `useMemo`, the energy + currency
//      formatter ports (`formatEnergy` / `formatCurrency`), the cost-badge
//      gate, the 30-day totals, and the compact spend hero.
//    • State holder — `SuperchargerHistoryModel` phase resolution across loading
//      / empty / error / content, plus the P1/S11 `view.opened` telemetry +
//      source wiring + freshness/projection projection.
//    • Registry — canonical `supercharger-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySuperchargerHistorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

private let enUS = SuperchargerFormatOptions(localeIdentifier: "en-US")

private func at(_ secondsFromEpoch: TimeInterval) -> Date {
    Date(timeIntervalSince1970: secondsFromEpoch)
}

private func session(
    _ id: Int64,
    site: String? = "Site",
    started: Date? = nil,
    wh: Double? = 0,
    due: Double? = 0
) -> SuperchargerSession {
    SuperchargerSession(id: id, siteName: site, startedAt: started, usageWh: wh, totalDue: due)
}

// MARK: - Adapter: cached DTO → projection (parity with the web source)

@MainActor
final class SuperchargerHistoryAdapterTests: XCTestCase {
    func testSessionsSortByStartDescendingAndSliceToTen() {
        // 12 sessions, deliberately out of order; expect newest-first, capped at 10.
        let sessions = (1 ... 12).map { index in
            session(Int64(index), site: "S\(index)", started: at(Double(index) * 1000), wh: 1000)
        }
        let projection = SuperchargerHistoryAdapter.project(sessions: sessions, summary: nil, options: enUS)
        XCTAssertEqual(projection.items.count, 10)
        // Newest start (id 12) first, oldest visible (id 3) last.
        XCTAssertEqual(projection.items.first?.id, 12)
        XCTAssertEqual(projection.items.last?.id, 3)
    }

    func testEnergyFormattingMatchesWebKwhPrecisionOne() {
        let projection = SuperchargerHistoryAdapter.project(
            sessions: [session(1, started: at(1000), wh: 42600, due: 0)],
            summary: nil,
            options: enUS
        )
        XCTAssertEqual(projection.items.first?.formattedValue, "42.6 kWh")
    }

    func testEnergyFormattingHonorsWattHourPreference() {
        let whOptions = SuperchargerFormatOptions(energyUnit: .wattHours, localeIdentifier: "en-US")
        let projection = SuperchargerHistoryAdapter.project(
            sessions: [session(1, started: at(1000), wh: 1500, due: 0)],
            summary: nil,
            options: whOptions
        )
        XCTAssertEqual(projection.items.first?.formattedValue, "1,500.0 Wh")
    }

    func testCostBadgeShownOnlyWhenPositive() {
        let projection = SuperchargerHistoryAdapter.project(
            sessions: [
                session(1, started: at(2000), wh: 1000, due: 12.84),
                session(2, started: at(1000), wh: 1000, due: 0)
            ],
            summary: nil,
            options: enUS
        )
        XCTAssertEqual(projection.items.first?.badge, "$12.84")
        XCTAssertNil(projection.items.last?.badge)
    }

    func testMissingSiteNameUsesEmDashAndMissingEnergyIsZero() {
        let projection = SuperchargerHistoryAdapter.project(
            sessions: [SuperchargerSession(id: 9, siteName: nil, startedAt: at(1000), usageWh: nil, totalDue: nil)],
            summary: nil,
            options: enUS
        )
        XCTAssertEqual(projection.items.first?.label, "—")
        XCTAssertEqual(projection.items.first?.value, 0)
        XCTAssertEqual(projection.items.first?.formattedValue, "0.0 kWh")
        XCTAssertNil(projection.items.first?.badge)
    }

    func testTotalsAndCompactSpend() {
        let summary = SuperchargerSummary(totalWh: 199_300, totalSpend: 55.52)
        let projection = SuperchargerHistoryAdapter.project(sessions: [], summary: summary, options: enUS)
        XCTAssertEqual(projection.totalEnergyText, "199.3 kWh")
        XCTAssertEqual(projection.totalSpendText, "$55.52")
        XCTAssertEqual(projection.compactSpendText, "55.52")
        XCTAssertEqual(projection.currencyUnit, "$")
        XCTAssertFalse(projection.hasSessions)
    }

    func testNilSummaryDefaultsToZeroTotals() {
        let projection = SuperchargerHistoryAdapter.project(sessions: [], summary: nil, options: enUS)
        XCTAssertEqual(projection.totalEnergyText, "0.0 kWh")
        XCTAssertEqual(projection.totalSpendText, "$0.00")
        XCTAssertEqual(projection.compactSpendText, "0.00")
    }

    func testMaxValueIsLargestVisibleEnergy() {
        let projection = SuperchargerHistoryAdapter.project(
            sessions: [
                session(1, started: at(3000), wh: 1000),
                session(2, started: at(2000), wh: 5000),
                session(3, started: at(1000), wh: 2500)
            ],
            summary: nil,
            options: enUS
        )
        XCTAssertEqual(projection.maxValue, 5000)
        XCTAssertTrue(projection.hasSessions)
    }

    func testEnergyUnitFromLabelDefaultsToKilowattHours() {
        XCTAssertEqual(SuperchargerEnergyUnit.fromLabel("Wh"), .wattHours)
        XCTAssertEqual(SuperchargerEnergyUnit.fromLabel("kWh"), .kilowattHours)
        XCTAssertEqual(SuperchargerEnergyUnit.fromLabel(nil), .kilowattHours)
        XCTAssertEqual(SuperchargerEnergyUnit.fromLabel("bogus"), .kilowattHours)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class SuperchargerHistoryModelTests: XCTestCase {
    private func makeModel(
        _ update: SuperchargerHistoryUpdate,
        telemetry: SuperchargerHistoryTelemetry = OSLogSuperchargerHistoryTelemetry()
    ) -> (SuperchargerHistoryModel, InMemorySuperchargerHistorySource) {
        let source = InMemorySuperchargerHistorySource(initial: update)
        let model = SuperchargerHistoryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutSessionsShowsLoading() {
        let (model, _) = makeModel(SuperchargerHistoryUpdate(status: .loading, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutSessionsShowsEmpty() {
        let (model, _) = makeModel(SuperchargerHistoryUpdate(status: .loaded, sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SuperchargerHistoryUpdate(status: .failed("boom"), sessions: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testSessionsPresentShowContentEvenWhileLoadingOrFailed() {
        let rows = [session(1, started: at(1000), wh: 1000, due: 1)]
        let (loading, _) = makeModel(SuperchargerHistoryUpdate(status: .loading, sessions: rows))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(SuperchargerHistoryUpdate(status: .failed("net"), sessions: rows))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySuperchargerHistoryTelemetry()
        let (model, source) = makeModel(SuperchargerHistoryUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SuperchargerHistoryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SuperchargerHistoryUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(SuperchargerHistoryUpdate(status: .loading))
        model.start()
        source.push(
            SuperchargerHistoryUpdate(
                status: .loaded,
                connection: .offline,
                sessions: [
                    session(1, site: "A", started: at(1000), wh: 1000, due: 0),
                    session(2, site: "B", started: at(2000), wh: 99000, due: 30)
                ],
                summary: SuperchargerSummary(totalWh: 100_000, totalSpend: 30),
                options: enUS,
                updatedAt: at(5000)
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.hasSessions)
        // Newest (B, id 2) first.
        XCTAssertEqual(model.projection.items.first?.id, 2)
        XCTAssertEqual(model.projection.totalSpendText, "$30.00")
        XCTAssertEqual(model.updatedAt, at(5000))
    }

    func testIsCompactThreshold() {
        XCTAssertTrue(SuperchargerHistoryModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(SuperchargerHistoryModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor
final class SuperchargerHistoryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SuperchargerHistoryWidget.registration
        XCTAssertEqual(registration.id, "supercharger-history")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SuperchargerHistoryWidget.surfaceSlug, "SuperchargerHistoryWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = SuperchargerHistoryWidget.registration
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

@MainActor
final class SuperchargerHistoryAccessibilityTests: XCTestCase {
    func testSummaryIncludesTitleCountAndTotals() {
        let summary = SuperchargerHistoryAccessibility.summary(
            sessionCount: 3,
            totalEnergyText: "199.3 kWh",
            totalSpendText: "$55.52"
        )
        XCTAssertTrue(summary.contains("Supercharger History"))
        XCTAssertTrue(summary.contains("3 sessions"))
        XCTAssertTrue(summary.contains("199.3 kWh"))
        XCTAssertTrue(summary.contains("$55.52"))
    }

    func testSummaryHandlesNoSessions() {
        let summary = SuperchargerHistoryAccessibility.summary(
            sessionCount: 0,
            totalEnergyText: "0.0 kWh",
            totalSpendText: "$0.00"
        )
        XCTAssertTrue(summary.contains("Supercharger History"))
        XCTAssertTrue(summary.contains("No Supercharger sessions"))
    }

    func testCompactSummary() {
        let summary = SuperchargerHistoryAccessibility.compactSummary(currencyUnit: "$", spendText: "55.52")
        XCTAssertTrue(summary.contains("30-day Supercharger"))
        XCTAssertTrue(summary.contains("$55.52"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySuperchargerHistoryTelemetry: SuperchargerHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
