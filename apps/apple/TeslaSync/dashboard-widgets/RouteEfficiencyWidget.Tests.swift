//
//  RouteEfficiencyWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0082 · RouteEfficiencyWidget (Apple)
//
//  Unit coverage for the RouteEfficiencyWidget surface:
//    • Adapter (cached → projection) — `RouteEfficiencyProjection`, the tier badge
//      classifier, and the SI→display unit conversion, parity with the web `useMemo` /
//      `efficiencyBadge` / `toEfficiencyDisplay`.
//    • State holder — `RouteEfficiencyModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `route-efficiency` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for a ranked row.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryRouteEfficiencySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (parity with the web useMemo)

final class RouteEfficiencyAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testDistancePreferenceFromLabelOnlyMilesIsImperial() {
        XCTAssertEqual(RouteDistancePreference.from(label: "mi"), .miles)
        XCTAssertEqual(RouteDistancePreference.from(label: "MI"), .miles)
        XCTAssertEqual(RouteDistancePreference.from(label: "km"), .kilometers)
        XCTAssertEqual(RouteDistancePreference.from(label: "ft"), .kilometers)
        XCTAssertEqual(RouteDistancePreference.from(label: ""), .kilometers)
    }

    func testEfficiencyUnitSuffix() {
        XCTAssertEqual(RouteDistancePreference.kilometers.efficiencyUnit, "Wh/km")
        XCTAssertEqual(RouteDistancePreference.miles.efficiencyUnit, "Wh/mi")
    }

    func testToDisplayConvertsWhPerKmToWhPerMileForImperial() {
        XCTAssertEqual(RouteDistancePreference.kilometers.toDisplay(200), 200, accuracy: 0.0001)
        XCTAssertEqual(RouteDistancePreference.miles.toDisplay(200), 200 * 1.609344, accuracy: 0.0001)
    }

    func testBadgeThresholdsApplyToRawWhPerKm() {
        XCTAssertEqual(RouteEfficiencyBadge.classify(rawWhPerKm: 0), .excellent)
        XCTAssertEqual(RouteEfficiencyBadge.classify(rawWhPerKm: 250), .excellent)
        XCTAssertEqual(RouteEfficiencyBadge.classify(rawWhPerKm: 251), .good)
        XCTAssertEqual(RouteEfficiencyBadge.classify(rawWhPerKm: 325), .good)
        XCTAssertEqual(RouteEfficiencyBadge.classify(rawWhPerKm: 326), .fair)
        XCTAssertEqual(RouteEfficiencyBadge.classify(rawWhPerKm: 400), .fair)
        XCTAssertEqual(RouteEfficiencyBadge.classify(rawWhPerKm: 401), .poor)
    }

    func testBadgeTonesMatchWebVariants() {
        XCTAssertEqual(RouteEfficiencyBadge.excellent.tone, .success)
        XCTAssertEqual(RouteEfficiencyBadge.good.tone, .success)
        XCTAssertEqual(RouteEfficiencyBadge.fair.tone, .warning)
        XCTAssertEqual(RouteEfficiencyBadge.poor.tone, .danger)
    }

    func testProjectionRanksLowerWhFirstAndFlagsBest() {
        let routes = [
            RouteEfficiencyInput(id: 1, avgEfficiency: 300),
            RouteEfficiencyInput(id: 2, avgEfficiency: 200),
            RouteEfficiencyInput(id: 3, avgEfficiency: 400)
        ]
        let rows = RouteEfficiencyProjection.build(
            routes: routes, unit: .kilometers, isWide: false, localize: echo
        )
        // Lower Wh/km ⇒ higher inverted value ⇒ ranks first.
        XCTAssertEqual(rows.map(\.id), [2, 1, 3])
        XCTAssertTrue(rows[0].isBest)
        XCTAssertFalse(rows[1].isBest)
        XCTAssertFalse(rows[2].isBest)
    }

    func testProjectionNilAvgDoesNotLowerBestRawAndRanksLast() {
        // web: bestRaw uses `?? Infinity`, the row uses `?? 0` — a nil-avg route must
        // neither steal "best" nor suppress the real best.
        let routes = [
            RouteEfficiencyInput(id: 1, avgEfficiency: 300),
            RouteEfficiencyInput(id: 2, avgEfficiency: 200),
            RouteEfficiencyInput(id: 3, avgEfficiency: nil)
        ]
        let rows = RouteEfficiencyProjection.build(
            routes: routes, unit: .kilometers, isWide: false, localize: echo
        )
        XCTAssertEqual(rows.first?.id, 2)
        XCTAssertTrue(rows.first?.isBest == true)
        XCTAssertEqual(rows.last?.id, 3)
        XCTAssertEqual(rows.last?.value, 0)
        XCTAssertFalse(rows.last?.isBest == true)
    }

    func testProjectionFormattedValueCarriesUnitAndTripMarker() {
        let routes = [RouteEfficiencyInput(id: 1, avgEfficiency: 200, tripCount: 12)]
        let kmRow = RouteEfficiencyProjection.build(
            routes: routes, unit: .kilometers, isWide: false, localize: echo
        )[0]
        XCTAssertTrue(kmRow.formattedValue.contains("Wh/km"))
        XCTAssertTrue(kmRow.formattedValue.contains("×"))

        let miRow = RouteEfficiencyProjection.build(
            routes: routes, unit: .miles, isWide: false, localize: echo
        )[0]
        XCTAssertTrue(miRow.formattedValue.contains("Wh/mi"))
    }

    func testProjectionWideAppendsBestWorstSuffixOnlyWhenWide() {
        let routes = [
            RouteEfficiencyInput(
                id: 1, startLocation: "A", endLocation: "B",
                avgEfficiency: 200, bestEfficiency: 180, worstEfficiency: 240
            )
        ]
        let narrow = RouteEfficiencyProjection.build(
            routes: routes, unit: .kilometers, isWide: false, localize: echo
        )[0]
        XCTAssertEqual(narrow.label, "A → B")
        XCTAssertFalse(narrow.label.contains("best"))

        let wide = RouteEfficiencyProjection.build(
            routes: routes, unit: .kilometers, isWide: true, localize: echo
        )[0]
        XCTAssertTrue(wide.label.contains("A → B"))
        XCTAssertTrue(wide.label.contains("best"))
        XCTAssertTrue(wide.label.contains("worst"))
        XCTAssertTrue(wide.label.contains("Wh/km"))
    }

    func testProjectionWideUsesLocalizedBestWorstKeys() {
        let routes = [RouteEfficiencyInput(id: 1, avgEfficiency: 200, bestEfficiency: 180, worstEfficiency: 240)]
        let wide = RouteEfficiencyProjection.build(
            routes: routes, unit: .kilometers, isWide: true, localize: keyTap
        )[0]
        XCTAssertTrue(wide.label.contains("L:widget.routeEfficiency.best"))
        XCTAssertTrue(wide.label.contains("L:widget.routeEfficiency.worst"))
    }

    func testProjectionMissingLocationsUseEmDash() {
        let routes = [RouteEfficiencyInput(id: 1, avgEfficiency: 200)]
        let row = RouteEfficiencyProjection.build(
            routes: routes, unit: .kilometers, isWide: false, localize: echo
        )[0]
        XCTAssertEqual(row.label, "— → —")
    }

    func testProjectionHonorsLimit() {
        let routes = (0 ..< 5).map { RouteEfficiencyInput(id: $0, avgEfficiency: Double(150 + $0 * 40)) }
        let rows = RouteEfficiencyProjection.build(
            routes: routes, unit: .kilometers, isWide: false, limit: 2, localize: echo
        )
        XCTAssertEqual(rows.count, 2)
        // Most efficient (lowest Wh) ranks first.
        XCTAssertEqual(rows.first?.id, 0)
    }

    func testProjectionEmptyRoutesYieldsEmpty() {
        let rows = RouteEfficiencyProjection.build(
            routes: [], unit: .kilometers, isWide: true, localize: echo
        )
        XCTAssertTrue(rows.isEmpty)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class RouteEfficiencyModelTests: XCTestCase {
    private func makeModel(
        _ update: RouteEfficiencyUpdate,
        telemetry: RouteEfficiencyTelemetry = OSLogRouteEfficiencyTelemetry()
    ) -> (RouteEfficiencyModel, InMemoryRouteEfficiencySource) {
        let source = InMemoryRouteEfficiencySource(initial: update)
        let model = RouteEfficiencyModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleRoutes() -> [RouteEfficiencyInput] {
        [RouteEfficiencyInput(id: 1, startLocation: "A", endLocation: "B", avgEfficiency: 210, tripCount: 9)]
    }

    func testLoadingWithoutRoutesShowsLoading() {
        let (model, _) = makeModel(RouteEfficiencyUpdate(status: .loading, routes: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutRoutesShowsEmpty() {
        let (model, _) = makeModel(RouteEfficiencyUpdate(status: .loaded, routes: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedShowsErrorRegardlessOfCache() {
        let (noCache, _) = makeModel(RouteEfficiencyUpdate(status: .failed("boom"), routes: []))
        noCache.start()
        XCTAssertEqual(noCache.phase, .error("boom"))

        let (cached, _) = makeModel(RouteEfficiencyUpdate(status: .failed("net"), routes: sampleRoutes()))
        cached.start()
        XCTAssertEqual(cached.phase, .error("net"))
    }

    func testLoadedWithRoutesShowsContent() {
        let (model, _) = makeModel(RouteEfficiencyUpdate(status: .loaded, routes: sampleRoutes()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.routes.count, 1)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyRouteEfficiencyTelemetry()
        let (model, source) = makeModel(RouteEfficiencyUpdate(status: .loading, routes: []), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RouteEfficiencyWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(RouteEfficiencyUpdate(status: .loaded, routes: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionRoutesAndUnitTrackUpdates() {
        let (model, source) = makeModel(RouteEfficiencyUpdate(status: .loading, routes: []))
        model.start()
        source.push(
            RouteEfficiencyUpdate(
                status: .loaded,
                connection: .offline,
                routes: sampleRoutes(),
                unit: .miles,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.unit, .miles)
        XCTAssertEqual(model.routes.count, 1)
    }
}

// MARK: - Registry parity

final class RouteEfficiencyRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = RouteEfficiencyWidget.registration
        XCTAssertEqual(registration.id, "route-efficiency")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = RouteEfficiencyWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 2, rows: 4)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

final class RouteEfficiencyAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testRowSummaryIncludesRankLabelValueAndBadge() {
        let row = RouteEfficiencyRow(
            id: 1,
            label: "Home → Office",
            value: 60,
            formattedValue: "165 Wh/km · 42×",
            badge: .excellent,
            isBest: true
        )
        let summary = RouteEfficiencyAccessibility.rowSummary(rank: 1, row: row, localize: echo)
        XCTAssertTrue(summary.contains("1."))
        XCTAssertTrue(summary.contains("Home → Office"))
        XCTAssertTrue(summary.contains("165 Wh/km · 42×"))
        XCTAssertTrue(summary.contains("Excellent"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRouteEfficiencyTelemetry: RouteEfficiencyTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
