//
//  EnergyFlowWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0046 · EnergyFlowWidget (Apple)
//
//  Unit coverage for the EnergyFlowWidget surface:
//    • Adapter (cached → projection) — `EnergyFlowBuilder` parity with the web
//      node/arrow derivation + the diagram stroke/visibility math.
//    • State holder — `EnergyFlowModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `energy-flow` metadata + size clamping.
//    • Formatting + accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryEnergyFlowSource`.
//

import XCTest

// MARK: - Adapter: cached DTO → projection (parity with the web memos)

@MainActor final class EnergyFlowBuilderTests: XCTestCase {
    private func arrow(
        _ arrows: [EnergyFlowArrow],
        _ from: EnergyFlowNodeID,
        _ to: EnergyFlowNodeID
    ) -> EnergyFlowArrow? {
        arrows.first { $0.from == from && $0.to == to }
    }

    func testNilStateYieldsEmptyProjection() {
        let projection = EnergyFlowBuilder.buildProjection(nil)
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasState)
        XCTAssertTrue(projection.nodes.isEmpty)
        XCTAssertTrue(projection.arrows.isEmpty)
    }

    func testConsumingNodesUseWebPositionsAndValues() {
        let state = EnergyFlowVehicleState(powerKw: 18.4, isCharging: false, chargerPowerKw: 0, batteryLevel: 72)
        let projection = EnergyFlowBuilder.buildProjection(state)
        XCTAssertTrue(projection.hasState)
        XCTAssertEqual(projection.nodes.map(\.id), [.battery, .motor])
        XCTAssertEqual(projection.node(.battery)?.position, .left)
        XCTAssertEqual(projection.node(.battery)?.unit, .percent)
        XCTAssertEqual(projection.node(.battery)?.tint, .emerald)
        XCTAssertEqual(projection.node(.battery)?.magnitude ?? 0, 72, accuracy: 0.0001)
        XCTAssertEqual(projection.node(.motor)?.position, .right)
        XCTAssertEqual(projection.node(.motor)?.label, .consuming)
        XCTAssertEqual(projection.node(.motor)?.unit, .kilowatts)
        XCTAssertEqual(projection.node(.motor)?.tint, .purple)
        XCTAssertEqual(projection.node(.motor)?.magnitude ?? 0, 18.4, accuracy: 0.0001)
    }

    func testConsumingArrows() {
        let state = EnergyFlowVehicleState(powerKw: 18.4, batteryLevel: 72)
        let arrows = EnergyFlowBuilder.buildProjection(state).arrows
        XCTAssertEqual(arrows.count, 2)
        XCTAssertEqual(arrow(arrows, .battery, .motor)?.valueKw ?? 0, 18.4, accuracy: 0.0001)
        XCTAssertEqual(arrow(arrows, .battery, .motor)?.active, true)
        XCTAssertEqual(arrow(arrows, .battery, .motor)?.tint, .cyan)
        XCTAssertEqual(arrow(arrows, .motor, .battery)?.valueKw ?? -1, 0, accuracy: 0.0001)
        XCTAssertEqual(arrow(arrows, .motor, .battery)?.active, false)
    }

    func testRegeneratingNodeLabelAndArrows() {
        let state = EnergyFlowVehicleState(powerKw: -6.2, batteryLevel: 68)
        let projection = EnergyFlowBuilder.buildProjection(state)
        XCTAssertEqual(projection.node(.motor)?.label, .regenerating)
        XCTAssertEqual(projection.node(.motor)?.magnitude ?? 0, 6.2, accuracy: 0.0001)
        XCTAssertEqual(arrow(projection.arrows, .motor, .battery)?.valueKw ?? 0, 6.2, accuracy: 0.0001)
        XCTAssertEqual(arrow(projection.arrows, .motor, .battery)?.active, true)
        XCTAssertEqual(arrow(projection.arrows, .motor, .battery)?.tint, .emerald)
        XCTAssertEqual(arrow(projection.arrows, .battery, .motor)?.active, false)
    }

    func testStandbyMotorLabelAndUnit() {
        let state = EnergyFlowVehicleState(powerKw: 0, batteryLevel: 80)
        let projection = EnergyFlowBuilder.buildProjection(state)
        XCTAssertEqual(projection.node(.motor)?.label, .standby)
        XCTAssertEqual(projection.node(.motor)?.unit, .standby)
        XCTAssertEqual(projection.node(.motor)?.magnitude ?? -1, 0, accuracy: 0.0001)
        XCTAssertFalse(arrow(projection.arrows, .battery, .motor)?.active ?? true)
        XCTAssertFalse(arrow(projection.arrows, .motor, .battery)?.active ?? true)
    }

    func testChargingAddsChargerNodeAndArrow() {
        let state = EnergyFlowVehicleState(powerKw: 0, isCharging: true, chargerPowerKw: 11.0, batteryLevel: 55)
        let projection = EnergyFlowBuilder.buildProjection(state)
        XCTAssertEqual(projection.nodes.map(\.id), [.battery, .motor, .charger])
        XCTAssertEqual(projection.node(.charger)?.position, .top)
        XCTAssertEqual(projection.node(.charger)?.unit, .kilowatts)
        XCTAssertEqual(projection.node(.charger)?.tint, .amber)
        XCTAssertEqual(projection.node(.charger)?.magnitude ?? 0, 11.0, accuracy: 0.0001)
        XCTAssertEqual(arrow(projection.arrows, .charger, .battery)?.valueKw ?? 0, 11.0, accuracy: 0.0001)
        XCTAssertEqual(arrow(projection.arrows, .charger, .battery)?.active, true)
        XCTAssertEqual(arrow(projection.arrows, .charger, .battery)?.tint, .amber)
    }

    func testNotChargingHasNoChargerNode() {
        let state = EnergyFlowVehicleState(powerKw: 18.4, isCharging: false, chargerPowerKw: 0, batteryLevel: 72)
        let projection = EnergyFlowBuilder.buildProjection(state)
        XCTAssertNil(projection.node(.charger))
        XCTAssertNil(arrow(projection.arrows, .charger, .battery))
    }

    func testVisibleArrowsKeepsThreeLargestWhenCompact() {
        let synthetic = [
            EnergyFlowArrow(from: .battery, to: .motor, valueKw: 1, active: true, tint: .cyan),
            EnergyFlowArrow(from: .motor, to: .battery, valueKw: 5, active: true, tint: .emerald),
            EnergyFlowArrow(from: .charger, to: .battery, valueKw: 3, active: true, tint: .amber),
            EnergyFlowArrow(from: .battery, to: .charger, valueKw: 4, active: true, tint: .cyan)
        ]
        let expanded = EnergyFlowBuilder.visibleArrows(synthetic, compact: false)
        XCTAssertEqual(expanded.count, 4)
        let compact = EnergyFlowBuilder.visibleArrows(synthetic, compact: true)
        XCTAssertEqual(compact.count, 3)
        XCTAssertEqual(compact.map(\.valueKw), [5, 4, 3])
    }

    func testMaxArrowValueFloorsAtOne() {
        XCTAssertEqual(EnergyFlowBuilder.maxArrowValue([]), 1, accuracy: 0.0001)
        let arrows = [EnergyFlowArrow(from: .battery, to: .motor, valueKw: 7, active: true, tint: .cyan)]
        XCTAssertEqual(EnergyFlowBuilder.maxArrowValue(arrows), 7, accuracy: 0.0001)
    }

    func testStrokeScalesBetweenMinAndMax() {
        XCTAssertEqual(EnergyFlowBuilder.stroke(for: 0, max: 5), 1, accuracy: 0.0001)
        XCTAssertEqual(EnergyFlowBuilder.stroke(for: 5, max: 5), 4, accuracy: 0.0001)
        XCTAssertEqual(EnergyFlowBuilder.stroke(for: 2.5, max: 5), 2.5, accuracy: 0.0001)
        XCTAssertEqual(EnergyFlowBuilder.stroke(for: 3, max: 0), 1, accuracy: 0.0001)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class EnergyFlowModelTests: XCTestCase {
    private func makeModel(
        _ update: EnergyFlowUpdate,
        telemetry: EnergyFlowTelemetry = OSLogEnergyFlowTelemetry()
    ) -> (EnergyFlowModel, InMemoryEnergyFlowSource) {
        let source = InMemoryEnergyFlowSource(initial: update)
        let model = EnergyFlowModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private let state = EnergyFlowVehicleState(powerKw: 18.4, isCharging: false, chargerPowerKw: 0, batteryLevel: 72)

    func testLoadingWithoutCachedStateShowsLoading() {
        let (model, _) = makeModel(EnergyFlowUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedStateShowsContent() {
        let (model, _) = makeModel(EnergyFlowUpdate(status: .loading, state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedWithoutStateShowsEmpty() {
        let (model, _) = makeModel(EnergyFlowUpdate(status: .loaded, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithStateShowsContent() {
        let (model, _) = makeModel(EnergyFlowUpdate(status: .loaded, state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasState)
        XCTAssertEqual(model.projection.nodes.count, 2)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(EnergyFlowUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedWithCachedStateKeepsContent() {
        let (model, _) = makeModel(EnergyFlowUpdate(status: .failed("net"), state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyEnergyFlowTelemetry()
        let (model, source) = makeModel(EnergyFlowUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [EnergyFlowWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(EnergyFlowUpdate(status: .loaded, state: state))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(EnergyFlowUpdate(status: .loading))
        model.start()
        let charging = EnergyFlowVehicleState(powerKw: 0, isCharging: true, chargerPowerKw: 11, batteryLevel: 55)
        source.push(EnergyFlowUpdate(status: .loaded, connection: .offline, state: charging, updatedAt: Date()))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.nodes.count, 3)
        XCTAssertEqual(model.projection.arrows.count, 3)
    }

    func testCompactThreshold() {
        XCTAssertFalse(EnergyFlowModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 4)))
        XCTAssertTrue(EnergyFlowModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
    }
}

// MARK: - Registry parity

@MainActor final class EnergyFlowRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = EnergyFlowWidget.registration
        XCTAssertEqual(registration.id, "energy-flow")
        XCTAssertEqual(registration.category, "battery")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = EnergyFlowWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 4))
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

// MARK: - Formatting + accessibility summary content

@MainActor final class EnergyFlowAccessibilityTests: XCTestCase {
    func testMagnitudeRendersOneDecimal() {
        XCTAssertTrue(EnergyFlowFormat.magnitude(18.4).contains("18"))
        XCTAssertTrue(EnergyFlowFormat.magnitude(11).contains("11"))
    }

    func testAccessibleValuePercent() {
        let value = EnergyFlowFormat.accessibleValue(magnitude: 72, unit: .percent)
        XCTAssertTrue(value.contains("72"))
        XCTAssertTrue(value.contains("%"))
    }

    func testAccessibleValueKilowatts() {
        let value = EnergyFlowFormat.accessibleValue(magnitude: 18.4, unit: .kilowatts)
        XCTAssertTrue(value.contains("18"))
        XCTAssertTrue(value.contains("kW"))
    }

    func testAccessibleValueStandbyIsDash() {
        XCTAssertEqual(EnergyFlowFormat.accessibleValue(magnitude: 0, unit: .standby), "—")
    }

    func testSummaryListsEveryNodeWithValueAndUnit() {
        let state = EnergyFlowVehicleState(powerKw: 18.4, isCharging: true, chargerPowerKw: 11, batteryLevel: 72)
        let summary = EnergyFlowAccessibility.summary(for: EnergyFlowBuilder.buildProjection(state))
        XCTAssertTrue(summary.contains("Battery"))
        XCTAssertTrue(summary.contains("Consuming"))
        XCTAssertTrue(summary.contains("Charger"))
        XCTAssertTrue(summary.contains("%"))
        XCTAssertTrue(summary.contains("kW"))
    }

    func testSummaryFallsBackWhenNoData() {
        let summary = EnergyFlowAccessibility.summary(for: .empty)
        XCTAssertTrue(summary.contains("No energy data available"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyEnergyFlowTelemetry: EnergyFlowTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
