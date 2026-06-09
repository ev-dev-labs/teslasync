//
//  ChargingTelemetryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0025 · ChargingTelemetryWidget (Apple)
//
//  Unit coverage for the ChargingTelemetryWidget surface:
//    • Adapter (cached → projection) — `ChargingTelemetryBuilder` parity with the
//      web `chargerType` / `efficiency` memos + the rolling power accumulation.
//    • Projection — stat-kind selection + locale-aware formatting.
//    • State holder — `ChargingTelemetryModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry, refresh
//      delegation and power-history tracking.
//    • Registry — canonical `charging-telemetry` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryChargingTelemetrySource`.
//

import XCTest

private let enUS = Locale(identifier: "en_US")

private func chargingSnapshot(
    timestamp: String? = "t0",
    state: String? = "Charging",
    voltage: Double? = 232,
    current: Double? = 31,
    power: Double? = 7.2,
    phases: Double? = 3,
    pilot: Double? = 32
) -> ChargingTelemetrySnapshot {
    ChargingTelemetrySnapshot(
        timestamp: timestamp,
        chargingState: state,
        chargerVoltage: voltage,
        chargerActualCurrent: current,
        chargerPowerW: power,
        chargerPhases: phases,
        chargerPilotCurrent: pilot
    )
}

// MARK: - Adapter: cached DTO → projection (parity with the web memos)

final class ChargingTelemetryBuilderTests: XCTestCase {
    func testNilSnapshotYieldsEmptyProjection() {
        let projection = ChargingTelemetryBuilder.buildProjection(nil)
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.isCharging)
        XCTAssertNil(projection.chargerType)
        XCTAssertNil(projection.efficiencyPercent)
    }

    func testNumericFallbacksTreatNilAsZero() {
        let snapshot = ChargingTelemetrySnapshot(timestamp: "t0", chargingState: "Charging")
        let projection = ChargingTelemetryBuilder.buildProjection(snapshot)
        XCTAssertTrue(projection.isCharging)
        XCTAssertEqual(projection.voltage, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.current, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.power, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.phases, 0, accuracy: 0.0001)
    }

    func testChargerTypeIsAcBelowThresholdAndDcAbove() {
        XCTAssertEqual(ChargingTelemetryBuilder.chargerType(isCharging: true, voltage: 232), .ac)
        XCTAssertEqual(ChargingTelemetryBuilder.chargerType(isCharging: true, voltage: 300), .ac)
        XCTAssertEqual(ChargingTelemetryBuilder.chargerType(isCharging: true, voltage: 400), .dc)
    }

    func testChargerTypeIsNilWhenNotCharging() {
        XCTAssertNil(ChargingTelemetryBuilder.chargerType(isCharging: false, voltage: 400))
    }

    func testEfficiencyMatchesWebFormula() {
        // theoretical = (32 * 232 * 3) / 1000 = 22.272 kW; 7.2 / 22.272 * 100.
        let efficiency = ChargingTelemetryBuilder.efficiency(
            isCharging: true, pilot: 32, voltage: 232, phases: 3, power: 7.2
        )
        XCTAssertEqual(efficiency ?? 0, 32.3276, accuracy: 0.001)
    }

    func testEfficiencyUsesSinglePhaseWhenPhasesZero() {
        // theoretical = (16 * 240 * 1) / 1000 = 3.84 kW; 3.84 / 3.84 * 100 = 100.
        let efficiency = ChargingTelemetryBuilder.efficiency(
            isCharging: true, pilot: 16, voltage: 240, phases: 0, power: 3.84
        )
        XCTAssertEqual(efficiency ?? 0, 100, accuracy: 0.0001)
    }

    func testEfficiencyIsCappedAtOneHundred() {
        let efficiency = ChargingTelemetryBuilder.efficiency(
            isCharging: true, pilot: 16, voltage: 240, phases: 1, power: 99
        )
        XCTAssertEqual(efficiency ?? 0, 100, accuracy: 0.0001)
    }

    func testEfficiencyIsNilOnGuards() {
        XCTAssertNil(ChargingTelemetryBuilder.efficiency(
            isCharging: false,
            pilot: 32,
            voltage: 232,
            phases: 3,
            power: 7
        ))
        XCTAssertNil(ChargingTelemetryBuilder.efficiency(isCharging: true, pilot: 0, voltage: 232, phases: 3, power: 7))
        XCTAssertNil(ChargingTelemetryBuilder.efficiency(isCharging: true, pilot: 32, voltage: 0, phases: 3, power: 7))
    }

    func testAccumulatePowerAppendsOnlyWhenTimestampAdvances() {
        var (history, ts) = ChargingTelemetryBuilder.accumulatePower(
            history: [], snapshot: chargingSnapshot(timestamp: "a", power: 5), lastTimestamp: nil, maxSamples: 30
        )
        XCTAssertEqual(history, [5])
        XCTAssertEqual(ts, "a")

        // Same timestamp → no change.
        (history, ts) = ChargingTelemetryBuilder.accumulatePower(
            history: history, snapshot: chargingSnapshot(timestamp: "a", power: 9), lastTimestamp: ts, maxSamples: 30
        )
        XCTAssertEqual(history, [5])

        // New timestamp → append.
        (history, ts) = ChargingTelemetryBuilder.accumulatePower(
            history: history, snapshot: chargingSnapshot(timestamp: "b", power: 9), lastTimestamp: ts, maxSamples: 30
        )
        XCTAssertEqual(history, [5, 9])
    }

    func testAccumulatePowerCapsAtMaxSamples() {
        var history: [Double] = []
        var last: String?
        for index in 0 ..< 35 {
            (history, last) = ChargingTelemetryBuilder.accumulatePower(
                history: history,
                snapshot: chargingSnapshot(timestamp: "t\(index)", power: Double(index)),
                lastTimestamp: last,
                maxSamples: 30
            )
        }
        XCTAssertEqual(history.count, 30)
        XCTAssertEqual(history.first, 5) // 0...34, last 30 → starts at 5
        XCTAssertEqual(history.last, 34)
    }

    func testAccumulatePowerIgnoresMissingSnapshotOrTimestamp() {
        let (history, last) = ChargingTelemetryBuilder.accumulatePower(
            history: [1, 2], snapshot: nil, lastTimestamp: "x", maxSamples: 30
        )
        XCTAssertEqual(history, [1, 2])
        XCTAssertEqual(last, "x")

        let (history2, _) = ChargingTelemetryBuilder.accumulatePower(
            history: [1, 2], snapshot: chargingSnapshot(timestamp: nil), lastTimestamp: "x", maxSamples: 30
        )
        XCTAssertEqual(history2, [1, 2])
    }
}

// MARK: - Projection: stat selection + formatting

final class ChargingTelemetryProjectionTests: XCTestCase {
    func testStatKindsAreEmptyWhenNotCharging() {
        let projection = ChargingTelemetryBuilder.buildProjection(chargingSnapshot(state: "Disconnected"))
        XCTAssertTrue(projection.statKinds(wide: false).isEmpty)
        XCTAssertTrue(projection.statKinds(wide: true).isEmpty)
    }

    func testStatKindsCoreFourWhenCharging() {
        let projection = ChargingTelemetryBuilder.buildProjection(chargingSnapshot())
        XCTAssertEqual(projection.statKinds(wide: false), [.voltage, .current, .power, .phases])
    }

    func testEfficiencyStatOnlyWhenWideAndResolvable() {
        let withEfficiency = ChargingTelemetryBuilder.buildProjection(chargingSnapshot())
        XCTAssertEqual(
            withEfficiency.statKinds(wide: true),
            [.voltage, .current, .power, .phases, .efficiency]
        )

        // Pilot 0 → efficiency nil → no efficiency stat even when wide.
        let noEfficiency = ChargingTelemetryBuilder.buildProjection(chargingSnapshot(pilot: 0))
        XCTAssertEqual(noEfficiency.statKinds(wide: true), [.voltage, .current, .power, .phases])
    }

    func testFormattedValuesUseWebPrecision() {
        let projection = ChargingTelemetryBuilder.buildProjection(chargingSnapshot(voltage: 232.6, power: 7.24))
        XCTAssertEqual(projection.formattedValue(for: .voltage, locale: enUS), "233") // 0 dp, rounded
        XCTAssertEqual(projection.formattedValue(for: .power, locale: enUS), "7.2") // 1 dp
    }

    func testPhasesFallBackToEmDashWhenZero() {
        let projection = ChargingTelemetryBuilder.buildProjection(chargingSnapshot(phases: 0))
        XCTAssertEqual(projection.formattedValue(for: .phases, locale: enUS), "—")

        let withPhases = ChargingTelemetryBuilder.buildProjection(chargingSnapshot(phases: 3))
        XCTAssertEqual(withPhases.formattedValue(for: .phases, locale: enUS), "3")
    }

    func testFormatterHandlesNonFiniteAsZero() {
        XCTAssertEqual(ChargingTelemetryFormat.number(.nan, fractionDigits: 1, locale: enUS), "0.0")
        XCTAssertEqual(ChargingTelemetryFormat.number(.infinity, fractionDigits: 0, locale: enUS), "0")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ChargingTelemetryModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargingTelemetryUpdate,
        telemetry: ChargingTelemetryTelemetry = OSLogChargingTelemetryTelemetry()
    ) -> (ChargingTelemetryModel, InMemoryChargingTelemetrySource) {
        let source = InMemoryChargingTelemetrySource(initial: update)
        let model = ChargingTelemetryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutChargingShowsLoading() {
        let (model, _) = makeModel(ChargingTelemetryUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedChargingShowsContent() {
        let (model, _) = makeModel(ChargingTelemetryUpdate(status: .loading, snapshot: chargingSnapshot()))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedNotChargingShowsEmpty() {
        let (model, _) = makeModel(
            ChargingTelemetryUpdate(status: .loaded, snapshot: chargingSnapshot(state: "Stopped"))
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedChargingShowsContent() {
        let (model, _) = makeModel(ChargingTelemetryUpdate(status: .loaded, snapshot: chargingSnapshot()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.isCharging)
        XCTAssertEqual(model.projection.chargerType, .ac)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(ChargingTelemetryUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedWithCachedChargingKeepsContent() {
        let (model, _) = makeModel(ChargingTelemetryUpdate(status: .failed("net"), snapshot: chargingSnapshot()))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyChargingTelemetryTelemetry()
        let (model, source) = makeModel(ChargingTelemetryUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargingTelemetryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargingTelemetryUpdate(status: .loaded, snapshot: chargingSnapshot()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndPowerHistoryTrackUpdates() {
        let (model, source) = makeModel(ChargingTelemetryUpdate(status: .loading))
        model.start()
        source.push(
            ChargingTelemetryUpdate(
                status: .loaded,
                connection: .offline,
                snapshot: chargingSnapshot(timestamp: "p1", power: 6),
                updatedAt: Date()
            )
        )
        source.push(
            ChargingTelemetryUpdate(
                status: .loaded,
                connection: .stale,
                snapshot: chargingSnapshot(timestamp: "p2", power: 8),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.powerHistory, [6, 8])
    }

    func testCompactAndWideThresholds() {
        XCTAssertTrue(ChargingTelemetryModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(ChargingTelemetryModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertTrue(ChargingTelemetryModel.isWide(for: DashboardWidgetSize(cols: 4, rows: 3)))
        XCTAssertFalse(ChargingTelemetryModel.isWide(for: DashboardWidgetSize(cols: 2, rows: 2)))
    }
}

// MARK: - Registry parity

@MainActor final class ChargingTelemetryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ChargingTelemetryWidget.registration
        XCTAssertEqual(registration.id, "charging-telemetry")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = ChargingTelemetryWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 6)),
            DashboardWidgetSize(cols: 3, rows: 6)
        )
    }
}

// MARK: - Accessibility summary content

final class ChargingTelemetryAccessibilityTests: XCTestCase {
    func testSummaryListsMetricsWhileCharging() {
        let projection = ChargingTelemetryBuilder.buildProjection(chargingSnapshot())
        let summary = ChargingTelemetryAccessibility.summary(for: projection, locale: enUS)
        XCTAssertTrue(summary.contains("Voltage"))
        XCTAssertTrue(summary.contains("Current"))
        XCTAssertTrue(summary.contains("Power"))
        XCTAssertTrue(summary.contains("Phases"))
        XCTAssertTrue(summary.contains("kW"))
    }

    func testSummaryFallsBackWhenNotCharging() {
        let projection = ChargingTelemetryBuilder.buildProjection(chargingSnapshot(state: "Disconnected"))
        let summary = ChargingTelemetryAccessibility.summary(for: projection, locale: enUS)
        XCTAssertEqual(summary, "Not currently charging")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyChargingTelemetryTelemetry: ChargingTelemetryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
