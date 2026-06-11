//
//  EnergyFlowAnimatedWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0045 · EnergyFlowAnimatedWidget (Apple)
//
//  Unit coverage for the EnergyFlowAnimatedWidget surface:
//    • Adapter (cached → projection) — `EnergyFlowAnimatedBuilder` parity with the
//      web node/arrow derivation (always-three nodes, the ±0.5 kW drive dead-band,
//      the compact chips) + the diagram stroke/visibility math.
//    • State holder — `EnergyFlowAnimatedModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + source
//      wiring.
//    • Registry — canonical `energy-flow-animated` metadata + size clamping.
//    • Formatting + accessibility — the VoiceOver summary content (diagram +
//      compact).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryEnergyFlowAnimatedSource`.
//

import XCTest

// MARK: - Adapter: cached DTO → projection (parity with the web memos)

@MainActor final class EnergyFlowAnimatedBuilderTests: XCTestCase {
    private func arrow(
        _ arrows: [EnergyFlowAnimatedArrow],
        _ from: EnergyFlowAnimatedNodeID,
        _ to: EnergyFlowAnimatedNodeID
    ) -> EnergyFlowAnimatedArrow? {
        arrows.first { $0.from == from && $0.to == to }
    }

    func testNilStateYieldsEmptyProjection() {
        let projection = EnergyFlowAnimatedBuilder.buildProjection(nil)
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasState)
        XCTAssertTrue(projection.nodes.isEmpty)
        XCTAssertTrue(projection.arrows.isEmpty)
    }

    func testNodesAlwaysIncludeAllThreeEvenWhenNotCharging() {
        let state = EnergyFlowAnimatedVehicleState(
            powerKw: 18.4,
            isCharging: false,
            chargerPowerKw: 0,
            batteryLevel: 72
        )
        let projection = EnergyFlowAnimatedBuilder.buildProjection(state)
        XCTAssertEqual(projection.nodes.map(\.id), [.battery, .drive, .charger])
        XCTAssertEqual(projection.arrows.count, 3)
        // The charger is present but standby (a dash), not omitted (web nodes memo).
        XCTAssertEqual(projection.node(.charger)?.unit, .standby)
        XCTAssertEqual(arrow(projection.arrows, .charger, .battery)?.active, false)
    }

    func testConsumingNodesUseWebPositionsAndValues() {
        let state = EnergyFlowAnimatedVehicleState(
            powerKw: 18.4,
            isCharging: false,
            chargerPowerKw: 0,
            batteryLevel: 72
        )
        let projection = EnergyFlowAnimatedBuilder.buildProjection(state)
        XCTAssertTrue(projection.hasState)
        XCTAssertEqual(projection.node(.battery)?.position, .left)
        XCTAssertEqual(projection.node(.battery)?.unit, .percent)
        XCTAssertEqual(projection.node(.battery)?.magnitude ?? 0, 72, accuracy: 0.0001)
        XCTAssertEqual(projection.node(.drive)?.position, .right)
        XCTAssertEqual(projection.node(.drive)?.label, .drive)
        XCTAssertEqual(projection.node(.drive)?.unit, .kilowatts(decimals: 1))
        XCTAssertEqual(projection.node(.drive)?.magnitude ?? 0, 18.4, accuracy: 0.0001)
        XCTAssertEqual(projection.node(.charger)?.position, .top)
    }

    func testConsumingArrows() {
        let state = EnergyFlowAnimatedVehicleState(powerKw: 18.4, batteryLevel: 72)
        let arrows = EnergyFlowAnimatedBuilder.buildProjection(state).arrows
        XCTAssertEqual(arrow(arrows, .battery, .drive)?.valueKw ?? 0, 18.4, accuracy: 0.0001)
        XCTAssertEqual(arrow(arrows, .battery, .drive)?.active, true)
        XCTAssertEqual(arrow(arrows, .battery, .drive)?.tint, .cyan)
        XCTAssertEqual(arrow(arrows, .drive, .battery)?.valueKw ?? -1, 0, accuracy: 0.0001)
        XCTAssertEqual(arrow(arrows, .drive, .battery)?.active, false)
        XCTAssertEqual(arrow(arrows, .drive, .battery)?.tint, .emerald)
    }

    func testRegeneratingNodeLabelAndArrows() {
        let state = EnergyFlowAnimatedVehicleState(powerKw: -6.2, batteryLevel: 68)
        let projection = EnergyFlowAnimatedBuilder.buildProjection(state)
        XCTAssertEqual(projection.node(.drive)?.label, .regen)
        XCTAssertEqual(projection.node(.drive)?.magnitude ?? 0, 6.2, accuracy: 0.0001)
        XCTAssertEqual(arrow(projection.arrows, .drive, .battery)?.valueKw ?? 0, 6.2, accuracy: 0.0001)
        XCTAssertEqual(arrow(projection.arrows, .drive, .battery)?.active, true)
        XCTAssertEqual(arrow(projection.arrows, .battery, .drive)?.active, false)
    }

    func testDriveDeadBandTreatsSmallPowerAsIdle() {
        // Web: isConsuming = power > 0.5, isRegen = power < -0.5. Inside the band → Idle.
        for power in [0.0, 0.4, 0.5, -0.4, -0.5] {
            let projection = EnergyFlowAnimatedBuilder.buildProjection(
                EnergyFlowAnimatedVehicleState(powerKw: power, batteryLevel: 80)
            )
            XCTAssertEqual(projection.node(.drive)?.label, .idle, "power=\(power) should be idle")
            XCTAssertEqual(projection.node(.drive)?.unit, .standby, "power=\(power) should be standby")
            XCTAssertFalse(arrow(projection.arrows, .battery, .drive)?.active ?? true)
            XCTAssertFalse(arrow(projection.arrows, .drive, .battery)?.active ?? true)
        }
    }

    func testDriveDeadBandEdgesEngageFlow() {
        let consuming = EnergyFlowAnimatedBuilder.buildProjection(
            EnergyFlowAnimatedVehicleState(powerKw: 0.6, batteryLevel: 80)
        )
        XCTAssertEqual(consuming.node(.drive)?.label, .drive)
        XCTAssertEqual(consuming.node(.drive)?.unit, .kilowatts(decimals: 1))
        let regen = EnergyFlowAnimatedBuilder.buildProjection(
            EnergyFlowAnimatedVehicleState(powerKw: -0.6, batteryLevel: 80)
        )
        XCTAssertEqual(regen.node(.drive)?.label, .regen)
        XCTAssertEqual(regen.node(.drive)?.unit, .kilowatts(decimals: 1))
    }

    func testChargingMakesChargerActiveZeroDecimalKilowatts() {
        let state = EnergyFlowAnimatedVehicleState(powerKw: 0, isCharging: true, chargerPowerKw: 11.0, batteryLevel: 55)
        let projection = EnergyFlowAnimatedBuilder.buildProjection(state)
        XCTAssertEqual(projection.node(.charger)?.unit, .kilowatts(decimals: 0))
        XCTAssertEqual(projection.node(.charger)?.magnitude ?? 0, 11.0, accuracy: 0.0001)
        XCTAssertEqual(arrow(projection.arrows, .charger, .battery)?.valueKw ?? 0, 11.0, accuracy: 0.0001)
        XCTAssertEqual(arrow(projection.arrows, .charger, .battery)?.active, true)
        XCTAssertEqual(arrow(projection.arrows, .charger, .battery)?.tint, .amber)
    }

    func testCompactSummaryOrdersChargingConsumingRegen() {
        // Pathological combo to prove ordering (web pushes charging, consuming, regen).
        let charging = EnergyFlowAnimatedBuilder.compactSummary(
            EnergyFlowAnimatedVehicleState(powerKw: 12.0, isCharging: true, chargerPowerKw: 7.0, batteryLevel: 60)
        )
        XCTAssertEqual(charging.chips.map(\.kind), [.charging, .consuming])
        XCTAssertEqual(charging.batteryLevel, 60, accuracy: 0.0001)
        let regen = EnergyFlowAnimatedBuilder.compactSummary(
            EnergyFlowAnimatedVehicleState(powerKw: -4.0, isCharging: false, chargerPowerKw: 0, batteryLevel: 64)
        )
        XCTAssertEqual(regen.chips.map(\.kind), [.regen])
        XCTAssertEqual(regen.chips.first?.valueKw ?? 0, 4.0, accuracy: 0.0001)
    }

    func testCompactSummaryIdleWhenNothingMoves() {
        let summary = EnergyFlowAnimatedBuilder.compactSummary(
            EnergyFlowAnimatedVehicleState(powerKw: 0.3, isCharging: false, chargerPowerKw: 0, batteryLevel: 90)
        )
        XCTAssertTrue(summary.isIdle)
        XCTAssertEqual(summary.batteryLevel, 90, accuracy: 0.0001)
        XCTAssertTrue(EnergyFlowAnimatedBuilder.compactSummary(nil).isIdle)
    }

    func testVisibleArrowsKeepsThreeLargestWhenCompact() {
        let synthetic = [
            EnergyFlowAnimatedArrow(from: .battery, to: .drive, valueKw: 1, active: true, tint: .cyan),
            EnergyFlowAnimatedArrow(from: .drive, to: .battery, valueKw: 5, active: true, tint: .emerald),
            EnergyFlowAnimatedArrow(from: .charger, to: .battery, valueKw: 3, active: true, tint: .amber),
            EnergyFlowAnimatedArrow(from: .battery, to: .charger, valueKw: 4, active: true, tint: .cyan)
        ]
        let expanded = EnergyFlowAnimatedBuilder.visibleArrows(synthetic, compact: false)
        XCTAssertEqual(expanded.count, 4)
        let compact = EnergyFlowAnimatedBuilder.visibleArrows(synthetic, compact: true)
        XCTAssertEqual(compact.count, 3)
        XCTAssertEqual(compact.map(\.valueKw), [5, 4, 3])
    }

    func testMaxArrowValueFloorsAtOne() {
        XCTAssertEqual(EnergyFlowAnimatedBuilder.maxArrowValue([]), 1, accuracy: 0.0001)
        let arrows = [EnergyFlowAnimatedArrow(from: .battery, to: .drive, valueKw: 7, active: true, tint: .cyan)]
        XCTAssertEqual(EnergyFlowAnimatedBuilder.maxArrowValue(arrows), 7, accuracy: 0.0001)
    }

    func testStrokeScalesBetweenMinAndMax() {
        XCTAssertEqual(EnergyFlowAnimatedBuilder.stroke(for: 0, max: 5), 1, accuracy: 0.0001)
        XCTAssertEqual(EnergyFlowAnimatedBuilder.stroke(for: 5, max: 5), 4, accuracy: 0.0001)
        XCTAssertEqual(EnergyFlowAnimatedBuilder.stroke(for: 2.5, max: 5), 2.5, accuracy: 0.0001)
        XCTAssertEqual(EnergyFlowAnimatedBuilder.stroke(for: 3, max: 0), 1, accuracy: 0.0001)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class EnergyFlowAnimatedModelTests: XCTestCase {
    private func makeModel(
        _ update: EnergyFlowAnimatedUpdate,
        telemetry: EnergyFlowAnimatedTelemetry = OSLogEnergyFlowAnimatedTelemetry()
    ) -> (EnergyFlowAnimatedModel, InMemoryEnergyFlowAnimatedSource) {
        let source = InMemoryEnergyFlowAnimatedSource(initial: update)
        let model = EnergyFlowAnimatedModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private let state = EnergyFlowAnimatedVehicleState(
        powerKw: 18.4, isCharging: false, chargerPowerKw: 0, batteryLevel: 72
    )

    func testLoadingWithoutCachedStateShowsLoading() {
        let (model, _) = makeModel(EnergyFlowAnimatedUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedStateShowsContent() {
        let (model, _) = makeModel(EnergyFlowAnimatedUpdate(status: .loading, state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedWithoutStateShowsEmpty() {
        let (model, _) = makeModel(EnergyFlowAnimatedUpdate(status: .loaded, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithStateShowsContentWithThreeNodes() {
        let (model, _) = makeModel(EnergyFlowAnimatedUpdate(status: .loaded, state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasState)
        XCTAssertEqual(model.projection.nodes.count, 3)
        XCTAssertEqual(model.projection.arrows.count, 3)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(EnergyFlowAnimatedUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedWithCachedStateKeepsContent() {
        let (model, _) = makeModel(EnergyFlowAnimatedUpdate(status: .failed("net"), state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyEnergyFlowAnimatedTelemetry()
        let (model, source) = makeModel(EnergyFlowAnimatedUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [EnergyFlowAnimatedWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(EnergyFlowAnimatedUpdate(status: .loaded, state: state))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionProjectionAndCompactSummaryTrackUpdates() {
        let (model, source) = makeModel(EnergyFlowAnimatedUpdate(status: .loading))
        model.start()
        let charging = EnergyFlowAnimatedVehicleState(
            powerKw: 0,
            isCharging: true,
            chargerPowerKw: 11,
            batteryLevel: 55
        )
        source.push(EnergyFlowAnimatedUpdate(status: .loaded, connection: .offline, state: charging, updatedAt: Date()))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.nodes.count, 3)
        XCTAssertEqual(model.compactSummary.chips.map(\.kind), [.charging])
        XCTAssertEqual(model.compactSummary.batteryLevel, 55, accuracy: 0.0001)
    }

    func testCompactThreshold() {
        XCTAssertFalse(EnergyFlowAnimatedModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(EnergyFlowAnimatedModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
    }
}

// MARK: - Registry parity

@MainActor final class EnergyFlowAnimatedRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = EnergyFlowAnimatedWidget.registration
        XCTAssertEqual(registration.id, "energy-flow-animated")
        XCTAssertEqual(registration.category, "energy")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 3, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = EnergyFlowAnimatedWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 3, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Formatting + accessibility summary content

@MainActor final class EnergyFlowAnimatedAccessibilityTests: XCTestCase {
    func testMagnitudeRendersOneDecimal() {
        XCTAssertTrue(EnergyFlowAnimatedFormat.magnitude(18.4).contains("18"))
        XCTAssertTrue(EnergyFlowAnimatedFormat.magnitude(11).contains("11"))
    }

    func testPercentIsWholeNumber() {
        let value = EnergyFlowAnimatedFormat.percent(72)
        XCTAssertTrue(value.contains("72"))
        XCTAssertTrue(value.contains("%"))
        XCTAssertFalse(value.contains("."))
    }

    func testKilowattsHonorsDecimals() {
        XCTAssertTrue(EnergyFlowAnimatedFormat.kilowatts(18.4, decimals: 1).contains("18.4"))
        XCTAssertTrue(EnergyFlowAnimatedFormat.kilowatts(18.4, decimals: 1).contains("kW"))
        // Zero-decimal charger value rounds to a whole number (web fmtNumber(_, 0)).
        let zero = EnergyFlowAnimatedFormat.kilowatts(11.0, decimals: 0)
        XCTAssertTrue(zero.contains("11"))
        XCTAssertFalse(zero.contains("11.0"))
    }

    func testAccessibleValueByUnit() {
        XCTAssertTrue(EnergyFlowAnimatedFormat.accessibleValue(magnitude: 72, unit: .percent).contains("72"))
        XCTAssertTrue(
            EnergyFlowAnimatedFormat.accessibleValue(magnitude: 18.4, unit: .kilowatts(decimals: 1)).contains("kW")
        )
        XCTAssertEqual(EnergyFlowAnimatedFormat.accessibleValue(magnitude: 0, unit: .standby), "—")
    }

    func testDiagramSummaryListsEveryNodeWithValueAndUnit() {
        let state = EnergyFlowAnimatedVehicleState(
            powerKw: 18.4,
            isCharging: true,
            chargerPowerKw: 11,
            batteryLevel: 72
        )
        let summary = EnergyFlowAnimatedAccessibility.summary(for: EnergyFlowAnimatedBuilder.buildProjection(state))
        XCTAssertTrue(summary.contains("Battery"))
        XCTAssertTrue(summary.contains("Drive"))
        XCTAssertTrue(summary.contains("Charger"))
        XCTAssertTrue(summary.contains("%"))
        XCTAssertTrue(summary.contains("kW"))
    }

    func testDiagramSummaryFallsBackWhenNoData() {
        let summary = EnergyFlowAnimatedAccessibility.summary(for: .empty)
        XCTAssertTrue(summary.contains("No energy data available"))
    }

    func testCompactSummarySpeaksBatteryAndChips() {
        let charging = EnergyFlowAnimatedBuilder.compactSummary(
            EnergyFlowAnimatedVehicleState(powerKw: 0, isCharging: true, chargerPowerKw: 11, batteryLevel: 55)
        )
        let spoken = EnergyFlowAnimatedAccessibility.compactSummary(for: charging)
        XCTAssertTrue(spoken.contains("Battery"))
        XCTAssertTrue(spoken.contains("55"))
        XCTAssertTrue(spoken.contains("Charger"))
        XCTAssertTrue(spoken.contains("kW"))
    }

    func testCompactSummarySpeaksIdle() {
        let idle = EnergyFlowAnimatedBuilder.compactSummary(
            EnergyFlowAnimatedVehicleState(powerKw: 0, isCharging: false, chargerPowerKw: 0, batteryLevel: 80)
        )
        let spoken = EnergyFlowAnimatedAccessibility.compactSummary(for: idle)
        XCTAssertTrue(spoken.contains("Idle"))
        XCTAssertTrue(spoken.contains("80"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyEnergyFlowAnimatedTelemetry: EnergyFlowAnimatedTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
