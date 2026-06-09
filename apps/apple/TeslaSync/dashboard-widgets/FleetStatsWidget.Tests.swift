//
//  FleetStatsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0051 · FleetStatsWidget (Apple)
//
//  Unit coverage for the FleetStatsWidget surface:
//    • Adapter (cached → projection) — `FleetStatsWidgetProjector` folds a snapshot into
//      the widget's render shape, reproducing the web card values (km → mi conversion,
//      fmtNumber formatting, sparkline reversal) and the load-phase envelope.
//    • Freshness — `FleetStatsWidgetFreshness` maps (connection, refreshing) to the
//      chip tone / label / glyph (web `DataFreshness`).
//    • State holder — `FleetStatsWidgetModel` emits the P1/S11 `view.opened` once,
//      re-arms after stop, and delegates refresh to the underlying source.
//    • Registry — canonical `fleet-stats` metadata + size clamping.
//    • Accessibility — the bar summary content the widget contains.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryFleetStatsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached snapshot → widget projection (web value parity)

@MainActor
final class FleetStatsWidgetProjectorTests: XCTestCase {
    private let enUS = Locale(identifier: "en_US")

    private let sample = FleetStatsInput(
        vehicleCount: 4,
        onlineCount: 3,
        unreadAlerts: 2,
        analytics: FleetAnalyticsSnapshot(
            totalDistanceSI: 1_234_000,
            totalEnergyKwh: 312.5,
            avgEfficiencyWhKm: 158
        ),
        recentDriveDistancesM: [42000, 38000, 51000, 33000, 47000],
        recentChargeEnergiesWh: [42000, 18000, 55000, 30000],
        unit: .km
    )

    func testContentProjectionKilometers() {
        let update = FleetStatsUpdate(status: .loaded, input: sample, connection: .live)
        let projection = FleetStatsWidgetProjector.project(update, locale: enUS)

        XCTAssertEqual(projection.phase, .content)
        XCTAssertEqual(projection.freshnessTone, .live)
        XCTAssertEqual(projection.cards.count, 5)

        XCTAssertEqual(projection.cards[0].valueText, "4")
        XCTAssertEqual(projection.cards[0].accent, .neutral)
        XCTAssertEqual(projection.cards[0].caption, .online(3))

        XCTAssertEqual(projection.cards[1].valueText, "1,234 km")
        XCTAssertEqual(projection.cards[1].accent, .distance)

        XCTAssertEqual(projection.cards[2].valueText, "312.5 kWh")
        XCTAssertEqual(projection.cards[2].accent, .energy)

        XCTAssertEqual(projection.cards[3].valueText, "158 Wh/km")
        XCTAssertEqual(projection.cards[3].accent, .efficiency)
        XCTAssertEqual(projection.cards[3].caption, .localized(key: "fleet.average", fallback: "fleet average"))

        XCTAssertEqual(projection.cards[4].valueText, "2")
        XCTAssertEqual(projection.cards[4].accent, .alert)
        XCTAssertEqual(projection.cards[4].caption, .localized(key: "fleet.unread", fallback: "unread"))
    }

    func testContentProjectionMiles() {
        var miles = sample
        miles.unit = .mi
        let projection = FleetStatsWidgetProjector.project(
            FleetStatsUpdate(status: .loaded, input: miles, connection: .live),
            locale: enUS
        )
        XCTAssertEqual(projection.cards[1].valueText, "767 mi")
        XCTAssertEqual(projection.cards[3].valueText, "254 Wh/mi")
    }

    func testSparklineSeriesAreReversed() {
        let projection = FleetStatsWidgetProjector.project(
            FleetStatsUpdate(status: .loaded, input: sample, connection: .live),
            locale: enUS
        )
        XCTAssertEqual(projection.cards[1].sparkline, [47000, 33000, 51000, 38000, 42000] as [Double])
        XCTAssertEqual(projection.cards[2].sparkline, [30000, 55000, 18000, 42000] as [Double])
        XCTAssertNil(projection.cards[0].sparkline)
    }

    func testEmptyInputProjectsEmptyPhase() {
        let projection = FleetStatsWidgetProjector.project(
            FleetStatsUpdate(status: .loaded, input: FleetStatsInput(), connection: .live),
            locale: enUS
        )
        XCTAssertEqual(projection.phase, .empty)
    }

    func testLoadingStatusProjectsLoadingPhase() {
        let projection = FleetStatsWidgetProjector.project(
            FleetStatsUpdate(status: .loading, input: FleetStatsInput(), connection: .live),
            locale: enUS
        )
        XCTAssertEqual(projection.phase, .loading)
    }

    func testFailedStatusProjectsErrorPhase() {
        let projection = FleetStatsWidgetProjector.project(
            FleetStatsUpdate(status: .failed("boom"), input: FleetStatsInput(), connection: .live),
            locale: enUS
        )
        XCTAssertEqual(projection.phase, .error("boom"))
    }

    func testProjectionCarriesConnectionAndTimestamp() {
        let stamp = Date(timeIntervalSince1970: 1_700_000_000)
        let projection = FleetStatsWidgetProjector.project(
            FleetStatsUpdate(status: .loaded, input: sample, connection: .offline, updatedAt: stamp),
            locale: enUS
        )
        XCTAssertEqual(projection.connection, .offline)
        XCTAssertEqual(projection.freshnessTone, .offline)
        XCTAssertEqual(projection.updatedAt, stamp)
    }
}

// MARK: - Freshness chip derivation

@MainActor
final class FleetStatsWidgetFreshnessTests: XCTestCase {
    func testToneRefreshingOutranksConnection() {
        XCTAssertEqual(FleetStatsWidgetFreshness.tone(connection: .live, refreshing: true), .fetching)
        XCTAssertEqual(FleetStatsWidgetFreshness.tone(connection: .stale, refreshing: true), .fetching)
        XCTAssertEqual(FleetStatsWidgetFreshness.tone(connection: .offline, refreshing: true), .fetching)
    }

    func testToneFollowsConnectionWhenIdle() {
        XCTAssertEqual(FleetStatsWidgetFreshness.tone(connection: .live, refreshing: false), .live)
        XCTAssertEqual(FleetStatsWidgetFreshness.tone(connection: .stale, refreshing: false), .stale)
        XCTAssertEqual(FleetStatsWidgetFreshness.tone(connection: .offline, refreshing: false), .offline)
    }

    func testLabelKeysMatchEachTone() {
        XCTAssertEqual(FleetStatsWidgetFreshness.label(for: .live).key, "widget.fleetStats.live")
        XCTAssertEqual(FleetStatsWidgetFreshness.label(for: .fetching).key, "widget.fleetStats.updating")
        XCTAssertEqual(FleetStatsWidgetFreshness.label(for: .stale).key, "widget.fleetStats.stale")
        XCTAssertEqual(FleetStatsWidgetFreshness.label(for: .offline).key, "widget.fleetStats.offline")
    }

    func testSymbolsAndAnimationFlag() {
        XCTAssertEqual(FleetStatsWidgetFreshness.symbol(for: .live), "wifi")
        XCTAssertEqual(FleetStatsWidgetFreshness.symbol(for: .fetching), "arrow.triangle.2.circlepath")
        XCTAssertEqual(FleetStatsWidgetFreshness.symbol(for: .offline), "wifi.slash")
        XCTAssertTrue(FleetStatsWidgetFreshness.isAnimating(.fetching))
        XCTAssertFalse(FleetStatsWidgetFreshness.isAnimating(.live))
    }
}

// MARK: - State holder: telemetry + refresh wiring

@MainActor
final class FleetStatsWidgetModelTests: XCTestCase {
    private func makeModel(
        telemetry: FleetStatsWidgetTelemetry
    ) -> (FleetStatsWidgetModel, InMemoryFleetStatsSource) {
        let source = InMemoryFleetStatsSource()
        let bar = FleetStatsBarViewModel(source: source, telemetry: SilentBarTelemetry())
        let model = FleetStatsWidgetModel(bar: bar, telemetry: telemetry)
        return (model, source)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyWidgetTelemetry()
        let (model, _) = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [FleetStatsWidget.surfaceSlug])
        XCTAssertEqual(FleetStatsWidget.surfaceSlug, "FleetStatsWidget")
    }

    func testStopReArmsViewOpened() {
        let spy = SpyWidgetTelemetry()
        let (model, _) = makeModel(telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, ["FleetStatsWidget", "FleetStatsWidget"])
    }

    func testRefreshDelegatesToUnderlyingSource() {
        let (model, source) = makeModel(telemetry: SpyWidgetTelemetry())
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConvenienceInitComposesBar() {
        let source = InMemoryFleetStatsSource()
        let model = FleetStatsWidgetModel(
            source: source,
            telemetry: SpyWidgetTelemetry(),
            barTelemetry: SilentBarTelemetry()
        )
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Registry parity

@MainActor
final class FleetStatsWidgetRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = FleetStatsWidget.registration
        XCTAssertEqual(registration.id, "fleet-stats")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 4, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = FleetStatsWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 2, rows: 2))
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

// MARK: - Accessibility: the bar summary the widget contains

@MainActor
final class FleetStatsWidgetAccessibilityTests: XCTestCase {
    func testBarSummaryIncludesEveryCard() {
        let input = FleetStatsInput(
            vehicleCount: 4,
            onlineCount: 3,
            unreadAlerts: 2,
            analytics: FleetAnalyticsSnapshot(
                totalDistanceSI: 1_234_000,
                totalEnergyKwh: 312.5,
                avgEfficiencyWhKm: 158
            ),
            unit: .km
        )
        let cards = FleetStatsWidgetProjector.project(
            FleetStatsUpdate(status: .loaded, input: input, connection: .live),
            locale: Locale(identifier: "en_US")
        ).cards
        let summary = FleetStatsAccessibility.barSummary(cards: cards) { _, fallback in fallback }

        XCTAssertTrue(summary.contains("Fleet statistics"))
        XCTAssertTrue(summary.contains("Fleet Size 4"))
        XCTAssertTrue(summary.contains("Distance (30d) 1,234 km"))
        XCTAssertTrue(summary.contains("Energy (30d) 312.5 kWh"))
        XCTAssertTrue(summary.contains("Efficiency 158 Wh/km"))
        XCTAssertTrue(summary.contains("Alerts 2"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the widget telemetry contract can be asserted.
private final class SpyWidgetTelemetry: FleetStatsWidgetTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Silent bar telemetry so composing the bar model doesn't log during tests.
private struct SilentBarTelemetry: FleetStatsTelemetry {
    func viewOpened(surface _: String) {}
}
