//
//  DrivingPerformanceCards.Tests.swift
//  TeslaSync — P4 feature view · 0055 · DrivingPerformanceCards (Apple)
//
//  Unit coverage for the DrivingPerformanceCards surface:
//    • Adapter (cached → projection) — `DrivingUnitMath` SI conversion golden vectors +
//      `fmtNumber` grouping/rounding + `safe()` non-finite guard, and
//      `DrivingPerformanceProjection` six-card projection (values, em-dash fallback,
//      subtitles, icons, accents) + phase resolution, all parity with the web `fromKmh` /
//      `fromKm` / `fmtNumber` / `safe` / `?? '—'` rules.
//    • State holder — `DrivingPerformanceModel` phase resolution across loading / empty /
//      error / content, the refresh delegation, the stale auto-refresh, and the P1/S11
//      `view.opened` telemetry.
//    • Accessibility — the VoiceOver tile summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryDrivingPerformanceSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: conversion + formatting (web parity)

@MainActor final class DrivingUnitMathTests: XCTestCase {
    func testSafeCoercesNonFinite() {
        XCTAssertEqual(DrivingUnitMath.safe(42), 42, accuracy: 0.0001)
        XCTAssertEqual(DrivingUnitMath.safe(.nan), 0)
        XCTAssertEqual(DrivingUnitMath.safe(.infinity), 0)
        XCTAssertEqual(DrivingUnitMath.safe(-.infinity), 0)
    }

    func testSpeedConversionMatchesWeb() {
        // fromKmh(kmh, "mph") == kmh / 1.609344 ; "km/h" is the identity.
        XCTAssertEqual(DrivingUnitMath.fromKmh(201, "mph"), 124.89572, accuracy: 0.001)
        XCTAssertEqual(DrivingUnitMath.fromKmh(64.3, "mph"), 39.95416, accuracy: 0.001)
        XCTAssertEqual(DrivingUnitMath.fromKmh(201, "km/h"), 201, accuracy: 0.0001)
    }

    func testDistanceConversionMatchesWeb() {
        // fromKm(km, "mi") == km / 1.609344 ; "km" is the identity.
        XCTAssertEqual(DrivingUnitMath.fromKm(412.7, "mi"), 256.43961, accuracy: 0.001)
        XCTAssertEqual(DrivingUnitMath.fromKm(38.4, "mi"), 23.86054, accuracy: 0.001)
        XCTAssertEqual(DrivingUnitMath.fromKm(412.7, "km"), 412.7, accuracy: 0.0001)
    }

    func testFmtNumberGroupingRoundingAndPrecision() {
        XCTAssertEqual(DrivingUnitMath.fmtNumber(124.8957, decimals: 0), "125")
        XCTAssertEqual(DrivingUnitMath.fmtNumber(64.3, decimals: 0), "64")
        XCTAssertEqual(DrivingUnitMath.fmtNumber(23.8605, decimals: 1), "23.9")
        XCTAssertEqual(DrivingUnitMath.fmtNumber(412.7, decimals: 1), "412.7")
        XCTAssertEqual(DrivingUnitMath.fmtNumber(1234.5, decimals: 0), "1,235")
    }

    func testFmtNumberGuardsNonFinite() {
        XCTAssertEqual(DrivingUnitMath.fmtNumber(.nan, decimals: 0), "0")
        XCTAssertEqual(DrivingUnitMath.fmtNumber(.infinity, decimals: 1), "0.0")
    }
}

// MARK: - Adapter: projection (web parity)

@MainActor final class DrivingPerformanceProjectionTests: XCTestCase {
    private let imperial = DrivingUnitPrefs(distance: "mi", speed: "mph", locale: "en-US")
    private let metric = DrivingUnitPrefs(distance: "km", speed: "km/h", locale: "en-US")

    private func fullInput() -> DrivingPerformanceInput {
        DrivingPerformanceInput(
            speed: DrivingStat(max: 201.0, avg: 64.3),
            power: DrivingStat(max: 285.0, avg: 41.2),
            regen: DrivingStat(max: 92.0, avg: 15.4),
            distance: DrivingStat(max: 412.7, avg: 38.4)
        )
    }

    func testCardCountOrderAndIdentity() {
        let cards = DrivingPerformanceProjection.cards(from: fullInput(), prefs: imperial)
        XCTAssertEqual(cards.count, 6)
        XCTAssertEqual(
            cards.map(\.id),
            ["topSpeed", "avgSpeed", "peakPower", "peakRegen", "avgDriveDist", "longestDrive"]
        )
    }

    func testImperialValuesMatchWeb() {
        let cards = DrivingPerformanceProjection.cards(from: fullInput(), prefs: imperial)
        XCTAssertEqual(cards[0].value, "125") // Top Speed  201 km/h → mph
        XCTAssertEqual(cards[1].value, "40") // Avg Speed   64.3 km/h → mph
        XCTAssertEqual(cards[2].value, "285") // Peak Power  kW (no conversion)
        XCTAssertEqual(cards[3].value, "92") // Peak Regen  kW (no conversion)
        XCTAssertEqual(cards[4].value, "23.9") // Avg Distance 38.4 km → mi
        XCTAssertEqual(cards[5].value, "256.4") // Longest      412.7 km → mi
    }

    func testMetricValuesAreIdentityConversions() {
        let cards = DrivingPerformanceProjection.cards(from: fullInput(), prefs: metric)
        XCTAssertEqual(cards[0].value, "201")
        XCTAssertEqual(cards[1].value, "64")
        XCTAssertEqual(cards[4].value, "38.4")
        XCTAssertEqual(cards[5].value, "412.7")
    }

    func testSubtitlesIconsAndAccents() {
        let cards = DrivingPerformanceProjection.cards(from: fullInput(), prefs: imperial)
        XCTAssertEqual(cards.map(\.subtitle), ["mph", "mph", "kW", "kW", "mi", "mi"])
        XCTAssertEqual(
            cards.map(\.systemImage),
            [
                "speedometer",
                "chart.line.uptrend.xyaxis",
                "bolt.fill",
                "battery.100.bolt",
                "mappin.and.ellipse",
                "car.fill"
            ]
        )
        XCTAssertEqual(cards.map(\.accent), [.cyan, .purple, .amber, .green, .cyan, .purple])
    }

    func testNilInputRendersAllEmDash() {
        let cards = DrivingPerformanceProjection.cards(from: nil, prefs: imperial)
        XCTAssertEqual(cards.count, 6)
        XCTAssertTrue(cards.allSatisfy { $0.value == DrivingPerformanceProjection.emDash })
        // The unit subtitles still render even when the value is absent (web parity).
        XCTAssertEqual(cards[0].subtitle, "mph")
        XCTAssertEqual(cards[2].subtitle, "kW")
    }

    func testPartialInputEmDashesOnlyMissingGroups() {
        let input = DrivingPerformanceInput(
            speed: nil,
            power: DrivingStat(max: 120, avg: 30),
            regen: nil,
            distance: nil
        )
        let cards = DrivingPerformanceProjection.cards(from: input, prefs: imperial)
        XCTAssertEqual(cards[0].value, DrivingPerformanceProjection.emDash) // speed missing
        XCTAssertEqual(cards[1].value, DrivingPerformanceProjection.emDash)
        XCTAssertEqual(cards[2].value, "120") // power present
        XCTAssertEqual(cards[3].value, DrivingPerformanceProjection.emDash) // regen missing
        XCTAssertEqual(cards[4].value, DrivingPerformanceProjection.emDash) // distance missing
        XCTAssertEqual(cards[5].value, DrivingPerformanceProjection.emDash)
    }

    func testSafeAppliesToNonFiniteStat() {
        let input = DrivingPerformanceInput(speed: DrivingStat(max: .nan, avg: .infinity))
        let cards = DrivingPerformanceProjection.cards(from: input, prefs: imperial)
        XCTAssertEqual(cards[0].value, "0")
        XCTAssertEqual(cards[1].value, "0")
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(DrivingPerformanceProjection.resolvePhase(.loading, hasValue: false), .loading)
        XCTAssertEqual(DrivingPerformanceProjection.resolvePhase(.loading, hasValue: true), .content)
        XCTAssertEqual(DrivingPerformanceProjection.resolvePhase(.empty, hasValue: false), .empty)
        XCTAssertEqual(DrivingPerformanceProjection.resolvePhase(.empty, hasValue: true), .empty)
        XCTAssertEqual(DrivingPerformanceProjection.resolvePhase(.loaded, hasValue: false), .empty)
        XCTAssertEqual(DrivingPerformanceProjection.resolvePhase(.loaded, hasValue: true), .content)
        XCTAssertEqual(DrivingPerformanceProjection.resolvePhase(.failed("e"), hasValue: false), .error("e"))
        XCTAssertEqual(DrivingPerformanceProjection.resolvePhase(.failed("e"), hasValue: true), .content)
    }

    func testAccentColorsAreDistinctForPurple() {
        // Purple maps to the brand chart-series purple (no semantic token); the others map
        // to their semantic tokens. Guard that purple is not silently folded onto cyan.
        XCTAssertNotEqual(DrivingAccent.purple.color, DrivingAccent.cyan.color)
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor final class DrivingPerformanceModelTests: XCTestCase {
    private func makeModel(
        _ update: DrivingPerformanceUpdate,
        telemetry: DrivingPerformanceTelemetry = OSLogDrivingPerformanceTelemetry()
    ) -> (DrivingPerformanceModel, InMemoryDrivingPerformanceSource) {
        let source = InMemoryDrivingPerformanceSource(initial: update)
        let model = DrivingPerformanceModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleInput() -> DrivingPerformanceInput {
        DrivingPerformanceInput(
            speed: DrivingStat(max: 201, avg: 64.3),
            power: DrivingStat(max: 285, avg: 41),
            regen: DrivingStat(max: 92, avg: 15),
            distance: DrivingStat(max: 412.7, avg: 38.4)
        )
    }

    private func loaded(_ connection: DrivingPerformanceConnection = .live) -> DrivingPerformanceUpdate {
        DrivingPerformanceUpdate(
            status: .loaded,
            input: sampleInput(),
            unitPrefs: DrivingUnitPrefs(distance: "mi", speed: "mph", locale: "en-US"),
            connection: connection,
            updatedAt: Date()
        )
    }

    func testInitialContentPhaseAndCards() {
        let (model, _) = makeModel(loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertEqual(model.cards[0].value, "125")
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(DrivingPerformanceUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(DrivingPerformanceUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testEmptyPhaseStillProjectsEmDashCards() {
        let (model, _) = makeModel(DrivingPerformanceUpdate(status: .empty, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.cards.count, 6)
        XCTAssertTrue(model.cards.allSatisfy { $0.value == DrivingPerformanceProjection.emDash })
    }

    func testCachedInputStaysContentWhileFailing() {
        let (model, source) = makeModel(loaded())
        model.start()
        source.push(
            DrivingPerformanceUpdate(
                status: .failed("net"),
                input: sampleInput(),
                unitPrefs: DrivingUnitPrefs(distance: "mi", speed: "mph"),
                connection: .stale
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .stale)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(loaded())
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(loaded(.live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(.stale))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loaded(.live))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyDrivingPerformanceTelemetry()
        let (model, source) = makeModel(DrivingPerformanceUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DrivingPerformanceCards.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(DrivingPerformanceUpdate(status: .loading))
        model.start()
        source.push(
            DrivingPerformanceUpdate(
                status: .loaded,
                input: sampleInput(),
                unitPrefs: DrivingUnitPrefs(distance: "mi", speed: "mph"),
                refreshing: true,
                connection: .offline,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
        XCTAssertNotNil(model.updatedAt)
    }
}

// MARK: - Accessibility summary

@MainActor final class DrivingPerformanceAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCardSummaryReadsLabelValueUnit() {
        let card = DrivingMetricCardModel(
            id: "topSpeed",
            labelKey: "analytics.driving.topSpeed",
            labelFallback: "Top Speed",
            value: "125",
            subtitle: "mph",
            systemImage: "speedometer",
            accent: .cyan
        )
        let summary = DrivingPerformanceAccessibility.cardSummary(card, localize: echo)
        XCTAssertEqual(summary, "Top Speed, 125 mph")
    }

    func testCardSummaryReadsEmDashValue() {
        let card = DrivingMetricCardModel(
            id: "peakPower",
            labelKey: "analytics.driving.peakPower",
            labelFallback: "Peak Power",
            value: DrivingPerformanceProjection.emDash,
            subtitle: "kW",
            systemImage: "bolt.fill",
            accent: .amber
        )
        let summary = DrivingPerformanceAccessibility.cardSummary(card, localize: echo)
        XCTAssertTrue(summary.contains("Peak Power"))
        XCTAssertTrue(summary.contains(DrivingPerformanceProjection.emDash))
        XCTAssertTrue(summary.contains("kW"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDrivingPerformanceTelemetry: DrivingPerformanceTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
