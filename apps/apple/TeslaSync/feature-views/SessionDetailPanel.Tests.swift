//
//  SessionDetailPanel.Tests.swift
//  TeslaSync — P4 feature view · 0091 · SessionDetailPanel (Apple)
//
//  Unit coverage for the SessionDetailPanel surface:
//    • Adapter — `getChargerLabel` parity across every wire variant, `durationMinutes`
//      across the no-end / inverted / valid spans, the SOC range string, the value
//      formatting (kWh / kW / min / currency), and the ordered rows with their conditional
//      inclusion (Avg Power / Cost / Location) + the render-phase resolution.
//    • State holder — the `SessionDetailModel` wiring, the P1/S11 `view.opened` telemetry,
//      and the stale→auto-refresh / offline / live-reset behavior.
//    • Accessibility — the VoiceOver row summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemorySessionDetailSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: getChargerLabel (port of web getChargerLabel)

@MainActor final class SessionDetailChargerKindTests: XCTestCase {
    private func session(chargerType: String?, peakPowerW: Double?) -> ChargingSessionSnapshot {
        ChargingSessionSnapshot(
            startedAt: Date(timeIntervalSince1970: 0),
            startSocPct: 10,
            totalEnergyAddedWh: 1000,
            peakPowerW: peakPowerW,
            chargerType: chargerType
        )
    }

    func testTeslaTypesAreSupercharger() {
        XCTAssertEqual(
            SessionDetailProjection.chargerKind(for: session(chargerType: "Tesla", peakPowerW: nil)),
            .supercharger
        )
        XCTAssertEqual(
            SessionDetailProjection.chargerKind(for: session(chargerType: "Tesla Supercharger V3", peakPowerW: nil)),
            .supercharger
        )
        XCTAssertEqual(
            SessionDetailProjection.chargerKind(for: session(chargerType: "tesla", peakPowerW: nil)),
            .supercharger
        )
    }

    func testNonEmptyNonTeslaTypeIsDcFast() {
        XCTAssertEqual(SessionDetailProjection.chargerKind(for: session(chargerType: "CCS", peakPowerW: nil)), .dcFast)
    }

    func testAbsentTypeUsesPowerThreshold() {
        XCTAssertEqual(SessionDetailProjection.chargerKind(for: session(chargerType: nil, peakPowerW: 50000)), .dcFast)
        XCTAssertEqual(SessionDetailProjection.chargerKind(for: session(chargerType: nil, peakPowerW: 10000)), .homeAc)
        XCTAssertEqual(SessionDetailProjection.chargerKind(for: session(chargerType: nil, peakPowerW: nil)), .homeAc)
    }

    func testEmptyStringTypeFallsThroughToPower() {
        // The web `if (s.charger_type)` is falsy for "", so it falls through to the power check.
        XCTAssertEqual(SessionDetailProjection.chargerKind(for: session(chargerType: "", peakPowerW: 30000)), .dcFast)
        XCTAssertEqual(SessionDetailProjection.chargerKind(for: session(chargerType: "", peakPowerW: 10000)), .homeAc)
    }

    func testChargerLabelResolvesEnglishFallback() {
        let label = SessionDetailProjection.chargerLabel(for: session(chargerType: "Tesla", peakPowerW: nil))
        XCTAssertEqual(label, "Supercharger")
    }
}

// MARK: - Adapter: durationMinutes (port of web durationMinutes)

@MainActor final class SessionDetailDurationTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_000_000)

    func testNoEndIsZero() {
        XCTAssertEqual(SessionDetailProjection.durationMinutes(startedAt: start, endedAt: nil), 0)
    }

    func testEndBeforeStartIsZero() {
        let end = start.addingTimeInterval(-600)
        XCTAssertEqual(SessionDetailProjection.durationMinutes(startedAt: start, endedAt: end), 0)
    }

    func testValidSpanRoundsToMinutes() {
        XCTAssertEqual(
            SessionDetailProjection.durationMinutes(startedAt: start, endedAt: start.addingTimeInterval(2700)),
            45
        )
        // 90 seconds rounds to 2 minutes (web Math.round).
        XCTAssertEqual(
            SessionDetailProjection.durationMinutes(startedAt: start, endedAt: start.addingTimeInterval(90)),
            2
        )
    }
}

// MARK: - Adapter: SOC range string

@MainActor final class SessionDetailSocRangeTests: XCTestCase {
    func testStartAndEnd() {
        XCTAssertEqual(SessionDetailProjection.socString(start: 20, end: 80), "20% → 80%")
    }

    func testMissingEndUsesMarker() {
        XCTAssertEqual(SessionDetailProjection.socString(start: 20, end: nil), "20% → ?%")
    }

    func testFractionalSocKeepsDecimals() {
        XCTAssertEqual(SessionDetailProjection.socString(start: 20.5, end: 79.5), "20.5% → 79.5%")
    }
}

// MARK: - Adapter: rows + value formatting + phase

@MainActor final class SessionDetailRowsTests: XCTestCase {
    private let formatting = SessionFormatting(
        currencySymbol: "$",
        precision: 2,
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    private func fullSession() -> ChargingSessionSnapshot {
        ChargingSessionSnapshot(
            startedAt: Date(timeIntervalSince1970: 1_736_089_445),
            endedAt: Date(timeIntervalSince1970: 1_736_092_145),
            startSocPct: 20,
            endSocPct: 80,
            totalEnergyAddedWh: 42570,
            peakPowerW: 150_000,
            avgPowerW: 11000,
            costDecimal: 12.5,
            startPlace: "Home",
            chargerType: "Tesla"
        )
    }

    func testFullSessionRowsInOrder() {
        let rows = SessionDetailProjection.rows(for: fullSession(), formatting: formatting)
        XCTAssertEqual(rows.map(\.labelKey), [
            "charging.curve.date",
            "charging.curve.chargerType",
            "charging.curve.socRange",
            "charging.curve.energyAdded",
            "charging.curve.peakPower",
            "charging.curve.avgPower",
            "charging.curve.duration",
            "charging.curve.cost_decimal",
            "charging.curve.location"
        ])
    }

    func testFullSessionFormattedValues() {
        let rows = SessionDetailProjection.rows(for: fullSession(), formatting: formatting)
        let byKey = Dictionary(uniqueKeysWithValues: rows.map { ($0.labelKey, $0.value) })
        XCTAssertEqual(byKey["charging.curve.chargerType"], "Supercharger")
        XCTAssertEqual(byKey["charging.curve.socRange"], "20% → 80%")
        XCTAssertEqual(byKey["charging.curve.energyAdded"], "42.57 kWh")
        XCTAssertEqual(byKey["charging.curve.peakPower"], "150.00 kW")
        XCTAssertEqual(byKey["charging.curve.avgPower"], "11.00 kW")
        XCTAssertEqual(byKey["charging.curve.duration"], "45.00 min")
        XCTAssertEqual(byKey["charging.curve.cost_decimal"], "$12.50")
        XCTAssertEqual(byKey["charging.curve.location"], "Home")
        XCTAssertFalse(byKey["charging.curve.date"]?.isEmpty ?? true)
    }

    func testMinimalSessionOmitsConditionalRows() {
        let session = ChargingSessionSnapshot(
            startedAt: Date(timeIntervalSince1970: 1_736_089_445),
            endedAt: Date(timeIntervalSince1970: 1_736_091_245),
            startSocPct: 54,
            endSocPct: nil,
            totalEnergyAddedWh: 7400,
            peakPowerW: nil,
            avgPowerW: nil,
            costDecimal: nil,
            startPlace: nil,
            chargerType: nil
        )
        let rows = SessionDetailProjection.rows(for: session, formatting: formatting)
        XCTAssertEqual(rows.map(\.labelKey), [
            "charging.curve.date",
            "charging.curve.chargerType",
            "charging.curve.socRange",
            "charging.curve.energyAdded",
            "charging.curve.peakPower",
            "charging.curve.duration"
        ])
        let byKey = Dictionary(uniqueKeysWithValues: rows.map { ($0.labelKey, $0.value) })
        // peak_power_w null renders 0 (web `(peak ?? 0) / 1000`); charger falls to Home / AC.
        XCTAssertEqual(byKey["charging.curve.peakPower"], "0.00 kW")
        XCTAssertEqual(byKey["charging.curve.chargerType"], "Home / AC")
        XCTAssertEqual(byKey["charging.curve.socRange"], "54% → ?%")
    }

    func testEmptyPlaceOmitsLocationRow() {
        let session = ChargingSessionSnapshot(
            startedAt: Date(timeIntervalSince1970: 1_736_089_445),
            endedAt: Date(timeIntervalSince1970: 1_736_091_245),
            startSocPct: 10,
            endSocPct: 40,
            totalEnergyAddedWh: 5000,
            startPlace: "",
            chargerType: "CCS"
        )
        let rows = SessionDetailProjection.rows(for: session, formatting: formatting)
        XCTAssertFalse(rows.contains { $0.labelKey == "charging.curve.location" })
    }

    func testResolvePhaseAcrossStatuses() {
        XCTAssertEqual(SessionDetailProjection.resolvePhase(.loading, hasSession: false), .loading)
        XCTAssertEqual(SessionDetailProjection.resolvePhase(.failed("boom"), hasSession: true), .error("boom"))
        XCTAssertEqual(SessionDetailProjection.resolvePhase(.empty, hasSession: false), .empty)
        XCTAssertEqual(SessionDetailProjection.resolvePhase(.loaded, hasSession: false), .empty)
        XCTAssertEqual(SessionDetailProjection.resolvePhase(.loaded, hasSession: true), .data)
    }

    func testLocaleAffectsGrouping() {
        let session = ChargingSessionSnapshot(
            startedAt: Date(timeIntervalSince1970: 1_736_089_445),
            endedAt: Date(timeIntervalSince1970: 1_736_092_145),
            startSocPct: 10,
            endSocPct: 90,
            totalEnergyAddedWh: 1_234_560,
            peakPowerW: nil,
            chargerType: "CCS"
        )
        let grouped = SessionDetailProjection.rows(for: session, formatting: formatting)
        let byKey = Dictionary(uniqueKeysWithValues: grouped.map { ($0.labelKey, $0.value) })
        // 1,234,560 Wh / 1000 = 1,234.56 kWh — grouped per the en_US locale.
        XCTAssertEqual(byKey["charging.curve.energyAdded"], "1,234.56 kWh")
    }
}

// MARK: - State holder: wiring + telemetry + freshness

@MainActor final class SessionDetailModelTests: XCTestCase {
    private func makeModel(
        _ input: SessionDetailInput,
        telemetry: SessionDetailTelemetry = OSLogSessionDetailTelemetry()
    ) -> (SessionDetailModel, InMemorySessionDetailSource) {
        let source = InMemorySessionDetailSource(initial: input)
        let model = SessionDetailModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func session() -> ChargingSessionSnapshot {
        ChargingSessionSnapshot(
            startedAt: Date(timeIntervalSince1970: 1_736_089_445),
            endedAt: Date(timeIntervalSince1970: 1_736_092_145),
            startSocPct: 20,
            endSocPct: 80,
            totalEnergyAddedWh: 42570,
            peakPowerW: 150_000,
            avgPowerW: 11000,
            costDecimal: 12.5,
            startPlace: "Home",
            chargerType: "Tesla"
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySessionDetailTelemetry()
        let (model, source) = makeModel(
            SessionDetailInput(status: .loaded, session: session(), connection: .live),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertTrue(model.hasSession)
        XCTAssertEqual(model.rows.count, 9)
        XCTAssertEqual(spy.surfaces, [SessionDetailPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testEmptyWhenLoadedWithoutSession() {
        let (model, _) = makeModel(SessionDetailInput(status: .loaded, session: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertFalse(model.hasSession)
    }

    func testErrorStatusSurfacesMessage() {
        let (model, _) = makeModel(SessionDetailInput(status: .failed("503")))
        model.start()
        XCTAssertEqual(model.phase, .error("503"))
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SessionDetailInput(status: .loaded, session: session()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleTriggersOneGuardedAutoRefreshAndLiveResets() {
        let (model, source) = makeModel(
            SessionDetailInput(status: .loaded, session: session(), connection: .live)
        )
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(SessionDetailInput(status: .loaded, session: session(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale snapshot must not re-trigger the guarded auto-refresh.
        source.push(SessionDetailInput(status: .loaded, session: session(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // Returning live resets the guard so a later stale episode refreshes once more.
        source.push(SessionDetailInput(status: .loaded, session: session(), connection: .live))
        source.push(SessionDetailInput(status: .loaded, session: session(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(
            SessionDetailInput(status: .loaded, session: session(), connection: .live)
        )
        model.start()
        source.push(SessionDetailInput(status: .loaded, session: session(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Accessibility summary content

@MainActor final class SessionDetailAccessibilityTests: XCTestCase {
    func testRowSummaryCombinesLabelAndValue() {
        let summary = SessionDetailAccessibility.rowSummary(label: "Energy Added", value: "42.57 kWh")
        XCTAssertEqual(summary, "Energy Added, 42.57 kWh")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySessionDetailTelemetry: SessionDetailTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
