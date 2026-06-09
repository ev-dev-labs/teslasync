//
//  DrivingTips.Tests.swift
//  TeslaSync — P4 feature view · 0168 · DrivingTips (Apple)
//
//  Unit coverage for the DrivingTips surface:
//    • Adapter — the recommendation catalog (the exact port of the web `useMemo` branch
//      order + the RAW `> 20` / `> 80` / `> 120` thresholds, incl. NaN/∞ parity), each
//      tip's i18n key + web fallback, the throttle-style derivation (`getThrottleStyle`),
//      and the row-icon selection (web `throttleStyle === 'conservative' ? … : …`).
//    • State holder — `DrivingTipsProjection` across loading / empty / error / data and
//      the derived list + icon, plus the `DrivingTipsModel` wiring, the P1/S11
//      `view.opened` telemetry, and the stale auto-refresh transition.
//    • Accessibility — the VoiceOver list-summary join.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryDrivingTipsSource`.
//

import XCTest
@testable import TeslaSync

private func metrics(averagePowerKW: Double, maxMotorTempC: Double = 60) -> DrivingTipsMetrics {
    DrivingTipsMetrics(averagePowerKW: averagePowerKW, maxMotorTempC: maxMotorTempC)
}

// MARK: - Recommendation catalog (web DrivingTips.tsx useMemo)

final class DrivingTipsCatalogTests: XCTestCase {
    func testNilMetricsYieldsTheSingleNoDataTip() {
        XCTAssertEqual(DrivingTipsCatalog.tips(for: nil), [.noData])
    }

    func testConservativeBranchBelowOrAtTwenty() {
        // `avgPower > 20` is false at and below 20 → the "great" pair.
        XCTAssertEqual(DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 0)), [.great, .keep])
        XCTAssertEqual(DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 20)), [.great, .keep])
    }

    func testModerateBranchAboveTwentyThroughEighty() {
        // `avgPower > 20` && `!(avgPower > 80)` → the "smooth throttle" pair.
        XCTAssertEqual(DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 20.01)), [.smoothThrottle, .coast])
        XCTAssertEqual(DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 48)), [.smoothThrottle, .coast])
        XCTAssertEqual(DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 80)), [.smoothThrottle, .coast])
    }

    func testAggressiveBranchAboveEighty() {
        // `avgPower > 80` → the "ease accelerator" pair.
        XCTAssertEqual(DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 80.01)), [.easeAccel, .brakeEarly])
        XCTAssertEqual(DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 132)), [.easeAccel, .brakeEarly])
    }

    func testThermalTipAppendedOnlyAboveOneTwenty() {
        // `maxMotorTemp > 120` appends the thermal tip after the power branch.
        XCTAssertEqual(
            DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 132, maxMotorTempC: 120)),
            [.easeAccel, .brakeEarly]
        )
        XCTAssertEqual(
            DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 132, maxMotorTempC: 120.01)),
            [.easeAccel, .brakeEarly, .thermal]
        )
        XCTAssertEqual(
            DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 10, maxMotorTempC: 148)),
            [.great, .keep, .thermal]
        )
    }

    func testNonFiniteMatchesWebComparisonSemantics() {
        // Web uses raw `>`; NaN/-∞ are not `> 20`/`> 80` → the "great" branch, and
        // NaN/-∞ are not `> 120` → no thermal tip. `+∞` is `> 80` and `> 120`.
        XCTAssertEqual(
            DrivingTipsCatalog.tips(for: metrics(averagePowerKW: .nan, maxMotorTempC: .nan)),
            [.great, .keep]
        )
        XCTAssertEqual(
            DrivingTipsCatalog.tips(for: metrics(averagePowerKW: -.infinity, maxMotorTempC: -.infinity)),
            [.great, .keep]
        )
        XCTAssertEqual(
            DrivingTipsCatalog.tips(for: metrics(averagePowerKW: .infinity, maxMotorTempC: .infinity)),
            [.easeAccel, .brakeEarly, .thermal]
        )
    }
}

// MARK: - Tip i18n keys + web fallbacks

final class DrivingTipStringContractTests: XCTestCase {
    func testKeysMatchTheWebSource() {
        XCTAssertEqual(DrivingTip.noData.key, "dynamics.tipNoData")
        XCTAssertEqual(DrivingTip.easeAccel.key, "dynamics.tipEaseAccel")
        XCTAssertEqual(DrivingTip.brakeEarly.key, "dynamics.tipBrakeEarly")
        XCTAssertEqual(DrivingTip.smoothThrottle.key, "dynamics.tipSmoothThrottle")
        XCTAssertEqual(DrivingTip.coast.key, "dynamics.tipCoast")
        XCTAssertEqual(DrivingTip.great.key, "dynamics.tipGreat")
        XCTAssertEqual(DrivingTip.keep.key, "dynamics.tipKeep")
        XCTAssertEqual(DrivingTip.thermal.key, "dynamics.tipThermal")
    }

    func testFallbacksMatchTheWebDefaults() {
        XCTAssertEqual(DrivingTip.noData.fallback, "Drive your vehicle to start collecting dynamics data.")
        XCTAssertEqual(DrivingTip.brakeEarly.fallback, "Brake earlier and lighter to improve regen capture.")
        XCTAssertEqual(DrivingTip.coast.fallback, "Lift off the pedal earlier to let regen do the work.")
        XCTAssertEqual(DrivingTip.keep.fallback, "Keep monitoring your scores — consistency is key.")
        XCTAssertEqual(
            DrivingTip.smoothThrottle.fallback,
            "Smooth throttle transitions can improve efficiency by 10–15%."
        )
    }

    func testEveryTipHasANonEmptyDynamicsKeyAndFallback() {
        for tip in DrivingTip.allCases {
            XCTAssertTrue(tip.key.hasPrefix("dynamics.tip"), "unexpected key \(tip.key)")
            XCTAssertFalse(tip.fallback.isEmpty)
        }
    }
}

// MARK: - Throttle style derivation (web helpers.ts getThrottleStyle)

final class DrivingThrottleStyleTests: XCTestCase {
    func testThresholds() {
        XCTAssertEqual(DrivingThrottle.style(forAveragePowerKW: 0), .conservative)
        XCTAssertEqual(DrivingThrottle.style(forAveragePowerKW: 19.99), .conservative)
        XCTAssertEqual(DrivingThrottle.style(forAveragePowerKW: 20), .moderate)
        XCTAssertEqual(DrivingThrottle.style(forAveragePowerKW: 79.99), .moderate)
        XCTAssertEqual(DrivingThrottle.style(forAveragePowerKW: 80), .aggressive)
        XCTAssertEqual(DrivingThrottle.style(forAveragePowerKW: 250), .aggressive)
    }

    func testNonFiniteMatchesWebComparisonSemantics() {
        XCTAssertEqual(DrivingThrottle.style(forAveragePowerKW: .nan), .aggressive)
        XCTAssertEqual(DrivingThrottle.style(forAveragePowerKW: .infinity), .aggressive)
        XCTAssertEqual(DrivingThrottle.style(forAveragePowerKW: -.infinity), .conservative)
    }
}

// MARK: - Row icon selection (web throttleStyle === 'conservative' ? Shield : Triangle)

final class DrivingTipIconTests: XCTestCase {
    func testConservativeIsReassuringEverythingElseCaution() {
        XCTAssertEqual(DrivingTipIcon.from(throttleStyle: .conservative), .reassuring)
        XCTAssertEqual(DrivingTipIcon.from(throttleStyle: .moderate), .caution)
        XCTAssertEqual(DrivingTipIcon.from(throttleStyle: .aggressive), .caution)
    }

    func testNilStyleIsCaution() {
        // The web `null !== 'conservative'` → AlertTriangle.
        XCTAssertEqual(DrivingTipIcon.from(throttleStyle: nil), .caution)
    }
}

// MARK: - Projection (web render branch + P4 leaf contract)

final class DrivingTipsProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = DrivingTipsProjection.resolve(
            DrivingTipsInput(metrics: metrics(averagePowerKW: 48), errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.tips.isEmpty)
    }

    func testEmptyErrorMessageIsNotAnError() {
        let resolved = DrivingTipsProjection.resolve(DrivingTipsInput(isLoading: true, errorMessage: ""))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testLoadingWhenFlagged() {
        let resolved = DrivingTipsProjection.resolve(DrivingTipsInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.tips.isEmpty)
    }

    func testEmptyKeepsTheNoDataRecommendation() {
        let resolved = DrivingTipsProjection.resolve(DrivingTipsInput(metrics: nil))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.tips, [.noData])
        XCTAssertEqual(resolved.icon, .caution)
    }

    func testEmptyHonoursAConservativeStyleForTheIcon() {
        let resolved = DrivingTipsProjection.resolve(
            DrivingTipsInput(metrics: nil, throttleStyle: .conservative)
        )
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.tips, [.noData])
        XCTAssertEqual(resolved.icon, .reassuring)
    }

    func testDataResolvesTipsAndIconFromProp() {
        let resolved = DrivingTipsProjection.resolve(
            DrivingTipsInput(metrics: metrics(averagePowerKW: 48), throttleStyle: .moderate)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.tips, [.smoothThrottle, .coast])
        XCTAssertEqual(resolved.icon, .caution)
    }

    func testDataDerivesIconStyleWhenPropOmitted() {
        let resolved = DrivingTipsProjection.resolve(
            DrivingTipsInput(metrics: metrics(averagePowerKW: 10), throttleStyle: nil)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.tips, [.great, .keep])
        XCTAssertEqual(resolved.icon, .reassuring)
    }

    func testDataAppendsThermalAndKeepsAggressiveIcon() {
        let resolved = DrivingTipsProjection.resolve(
            DrivingTipsInput(
                metrics: metrics(averagePowerKW: 132, maxMotorTempC: 148),
                throttleStyle: .aggressive
            )
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.tips, [.easeAccel, .brakeEarly, .thermal])
        XCTAssertEqual(resolved.icon, .caution)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor
final class DrivingTipsModelTests: XCTestCase {
    private func makeModel(
        _ input: DrivingTipsInput,
        telemetry: DrivingTipsTelemetry = OSLogDrivingTipsTelemetry()
    ) -> (DrivingTipsModel, InMemoryDrivingTipsSource) {
        let source = InMemoryDrivingTipsSource(initial: input)
        let model = DrivingTipsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: DrivingTipsInput {
        DrivingTipsInput(metrics: metrics(averagePowerKW: 48), throttleStyle: .moderate)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyDrivingTipsTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.tips, [.smoothThrottle, .coast])
        XCTAssertEqual(spy.surfaces, [DrivingTips.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(DrivingTipsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.resolved.tips.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(DrivingTipsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.tips, [.smoothThrottle, .coast])
    }

    func testEmptyPushProjectsEmpty() {
        let (model, source) = makeModel(DrivingTipsInput(isLoading: true))
        model.start()
        source.push(DrivingTipsInput(metrics: nil))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.resolved.tips, [.noData])
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(DrivingTipsInput(metrics: metrics(averagePowerKW: 48), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(DrivingTipsInput(metrics: metrics(averagePowerKW: 48), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testLiveThenStaleReArmsAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(DrivingTipsInput(metrics: metrics(averagePowerKW: 48), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(DrivingTipsInput(metrics: metrics(averagePowerKW: 48), connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(DrivingTipsInput(metrics: metrics(averagePowerKW: 48), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(DrivingTipsInput(metrics: metrics(averagePowerKW: 48), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(DrivingTips.surfaceSlug, "DrivingTips")
    }
}

// MARK: - Accessibility summary content

final class DrivingTipsAccessibilityTests: XCTestCase {
    func testJoinFiltersEmptyAndJoins() {
        XCTAssertEqual(
            DrivingTipsAccessibility.join(["Brake earlier", "", "Lift off the pedal"]),
            "Brake earlier, Lift off the pedal"
        )
        XCTAssertEqual(DrivingTipsAccessibility.join([]), "")
    }

    func testJoinBuildsTheRecommendationSummary() {
        let parts = DrivingTipsCatalog.tips(for: metrics(averagePowerKW: 48)).map(\.fallback)
        let expected = "\(DrivingTip.smoothThrottle.fallback), \(DrivingTip.coast.fallback)"
        XCTAssertEqual(DrivingTipsAccessibility.join(parts), expected)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDrivingTipsTelemetry: DrivingTipsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
