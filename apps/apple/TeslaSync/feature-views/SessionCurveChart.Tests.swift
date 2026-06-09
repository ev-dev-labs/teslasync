//
//  SessionCurveChart.Tests.swift
//  TeslaSync — P4 feature view · 0090 · SessionCurveChart (Apple)
//
//  Unit coverage for the SessionCurveChart surface:
//    • Adapter (`SessionCurveBuilder`) — the `isDcSession` classification, the
//      `generateChargingCurve` simulation (AC flat / DC plateau → taper → roll-off,
//      the SOC step + defaults + empty span), the one-decimal data-table rounding,
//      and the projection (points / rounded chartData / hasData / peak / span / DC).
//    • State holder (`SessionCurveChartModel`) — phase across loading / loaded /
//      empty / failed, the P1/S11 `view.opened` telemetry (once), the stale
//      auto-refresh (exactly once + re-arm on live), and offline keeping the curve.
//    • Accessibility — the chart summary + per-point VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: generateChargingCurve / isDcSession parity

@MainActor final class SessionCurveBuilderTests: XCTestCase {
    private let accuracy = 1e-9

    // MARK: isDcSession

    func testIsDcMirrorsWebTruthiness() {
        // Tesla / any non-empty charger_type → DC.
        XCTAssertTrue(SessionCurveBuilder.isDc(chargerType: "Tesla", peakPowerW: nil))
        XCTAssertTrue(SessionCurveBuilder.isDc(chargerType: "CCS", peakPowerW: 1000))
        // JS treats any non-empty string (including whitespace) as truthy.
        XCTAssertTrue(SessionCurveBuilder.isDc(chargerType: " ", peakPowerW: nil))
        // Empty / nil charger_type + a peak above 20 kW → DC.
        XCTAssertTrue(SessionCurveBuilder.isDc(chargerType: "", peakPowerW: 50000))
        XCTAssertTrue(SessionCurveBuilder.isDc(chargerType: nil, peakPowerW: 20001))
        // Empty / nil charger_type + a peak at or below 20 kW → AC.
        XCTAssertFalse(SessionCurveBuilder.isDc(chargerType: "", peakPowerW: 20000))
        XCTAssertFalse(SessionCurveBuilder.isDc(chargerType: nil, peakPowerW: 11000))
        XCTAssertFalse(SessionCurveBuilder.isDc(chargerType: nil, peakPowerW: nil))
    }

    // MARK: power(atSoc:)

    func testAcPowerIsFlatPeak() {
        for soc in stride(from: 0.0, through: 100.0, by: 10) {
            XCTAssertEqual(SessionCurveBuilder.power(atSoc: soc, peakKw: 11, isDc: false), 11, accuracy: accuracy)
        }
    }

    func testDcPowerPlateauTaperRollOff() {
        let peak = 150.0
        // Plateau: full peak up to and including 50%.
        XCTAssertEqual(SessionCurveBuilder.power(atSoc: 0, peakKw: peak, isDc: true), 150, accuracy: accuracy)
        XCTAssertEqual(SessionCurveBuilder.power(atSoc: 50, peakKw: peak, isDc: true), 150, accuracy: accuracy)
        // Linear taper 50→80% down to half peak (web `1 - ((soc-50)/30)*0.5`).
        XCTAssertEqual(SessionCurveBuilder.power(atSoc: 65, peakKw: peak, isDc: true), 112.5, accuracy: accuracy)
        XCTAssertEqual(SessionCurveBuilder.power(atSoc: 80, peakKw: peak, isDc: true), 75, accuracy: accuracy)
        // Steeper roll-off 80→100% (web `peak*0.5*(1 - ((soc-80)/20)*0.7)`).
        XCTAssertEqual(SessionCurveBuilder.power(atSoc: 90, peakKw: peak, isDc: true), 48.75, accuracy: accuracy)
        XCTAssertEqual(SessionCurveBuilder.power(atSoc: 100, peakKw: peak, isDc: true), 22.5, accuracy: accuracy)
    }

    func testDcPowerNeverNegative() {
        XCTAssertGreaterThanOrEqual(SessionCurveBuilder.power(atSoc: 100, peakKw: 1, isDc: true), 0)
    }

    // MARK: generateChargingCurve

    func testGenerateCurveCountAndDefaults() {
        // Defaults: nil start → 0, nil end → 100, step 1 → 101 points (0…100).
        let curve = SessionCurveBuilder.generateCurve(SessionCurveInput())
        XCTAssertEqual(curve.count, 101)
        XCTAssertEqual(curve.first?.soc, 0)
        XCTAssertEqual(curve.last?.soc, 100)
        // nil peak → 11 kW default, AC (no charger, low power) → flat 11 kW.
        XCTAssertEqual(curve.first?.power ?? -1, 11, accuracy: accuracy)
        XCTAssertEqual(curve.last?.power ?? -1, 11, accuracy: accuracy)
    }

    func testGenerateCurveRangeAndKwConversion() {
        let input = SessionCurveInput(startSocPct: 10, endSocPct: 90, peakPowerW: 150_000, chargerType: "Tesla")
        let curve = SessionCurveBuilder.generateCurve(input)
        XCTAssertEqual(curve.count, 81) // 90 - 10 + 1
        XCTAssertEqual(curve.first?.soc, 10)
        XCTAssertEqual(curve.last?.soc, 90)
        // peak_power_w 150_000 → 150 kW plateau at the low-SOC start.
        XCTAssertEqual(curve.first?.power ?? -1, 150, accuracy: accuracy)
        // DC roll-off at 90% → 48.75 kW.
        XCTAssertEqual(curve.last?.power ?? -1, 48.75, accuracy: accuracy)
    }

    func testGenerateCurveEmptyWhenSpanNonPositive() {
        XCTAssertTrue(SessionCurveBuilder.generateCurve(SessionCurveInput(startSocPct: 80, endSocPct: 80)).count == 1)
        XCTAssertTrue(SessionCurveBuilder.generateCurve(SessionCurveInput(startSocPct: 90, endSocPct: 80)).isEmpty)
    }

    // MARK: roundedPower

    func testRoundedPowerOneDecimal() {
        XCTAssertEqual(SessionCurveBuilder.roundedPower(48.75), 48.8, accuracy: accuracy)
        XCTAssertEqual(SessionCurveBuilder.roundedPower(112.34), 112.3, accuracy: accuracy)
        XCTAssertEqual(SessionCurveBuilder.roundedPower(150), 150, accuracy: accuracy)
    }

    // MARK: project

    func testProjectNilSessionIsEmpty() {
        let projection = SessionCurveBuilder.project(nil)
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.points.isEmpty)
        XCTAssertTrue(projection.chartData.isEmpty)
        XCTAssertNil(projection.startSoc)
        XCTAssertNil(projection.endSoc)
        XCTAssertEqual(projection.peakPowerKw, 0)
    }

    func testProjectEmptySpanIsEmpty() {
        let projection = SessionCurveBuilder.project(SessionCurveInput(startSocPct: 90, endSocPct: 80))
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.points.isEmpty)
    }

    func testProjectDerivesPointsRoundingPeakSpanAndDc() {
        let input = SessionCurveInput(startSocPct: 10, endSocPct: 90, peakPowerW: 150_000, chargerType: "Tesla")
        let projection = SessionCurveBuilder.project(input)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.points.count, 81)
        XCTAssertEqual(projection.chartData.count, 81)
        XCTAssertEqual(projection.startSoc, 10)
        XCTAssertEqual(projection.endSoc, 90)
        XCTAssertTrue(projection.isDc)
        XCTAssertEqual(projection.peakPowerKw, 150, accuracy: accuracy)
        // chartData rounds power to one decimal (web data-table parity).
        XCTAssertEqual(projection.chartData.last?.power ?? -1, 48.8, accuracy: accuracy)
        // points keep the raw value the chart plots.
        XCTAssertEqual(projection.points.last?.power ?? -1, 48.75, accuracy: accuracy)
    }

    func testProjectAcSessionIsFlatNotDc() {
        let input = SessionCurveInput(startSocPct: 40, endSocPct: 80, peakPowerW: 11000, chargerType: nil)
        let projection = SessionCurveBuilder.project(input)
        XCTAssertTrue(projection.hasData)
        XCTAssertFalse(projection.isDc)
        XCTAssertEqual(projection.peakPowerKw, 11, accuracy: accuracy)
        XCTAssertEqual(projection.points.first?.power ?? -1, 11, accuracy: accuracy)
        XCTAssertEqual(projection.points.last?.power ?? -1, 11, accuracy: accuracy)
    }

    // MARK: phase + slug

    func testResolvePhase() {
        XCTAssertEqual(SessionCurveBuilder.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(SessionCurveBuilder.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(SessionCurveBuilder.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(SessionCurveBuilder.resolvePhase(.failed("boom"), hasData: true), .error("boom"))
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SessionCurveSurface.slug, "SessionCurveChart")
    }
}

// MARK: - State holder: SessionCurveChartModel

@MainActor final class SessionCurveChartModelTests: XCTestCase {
    private let dcSession = SessionCurveInput(
        startSocPct: 10,
        endSocPct: 90,
        peakPowerW: 150_000,
        chargerType: "Tesla"
    )

    private func makeModel(
        initial: SessionCurveChartUpdate?,
        telemetry: SessionCurveChartTelemetry = SpySessionCurveTelemetry()
    ) -> (SessionCurveChartModel, InMemorySessionCurveSource) {
        let source = InMemorySessionCurveSource(initial: initial)
        let model = SessionCurveChartModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadedContentProjectsCurve() {
        let (model, source) = makeModel(initial: SessionCurveChartUpdate(status: .loaded, session: dcSession))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 81)
        XCTAssertTrue(model.projection.hasData)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedNilSessionResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: SessionCurveChartUpdate(status: .loaded, session: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.projection.hasData)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: SessionCurveChartUpdate(status: .loading, session: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: SessionCurveChartUpdate(status: .failed("timeout"), session: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpySessionCurveTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SessionCurveSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SessionCurveChartUpdate(status: .loaded, session: dcSession, connection: .stale))
        source.push(SessionCurveChartUpdate(status: .loaded, session: dcSession, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SessionCurveChartUpdate(status: .loaded, session: dcSession, connection: .stale))
        source.push(SessionCurveChartUpdate(status: .loaded, session: dcSession, connection: .live))
        source.push(SessionCurveChartUpdate(status: .loaded, session: dcSession, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedCurveWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(SessionCurveChartUpdate(status: .loaded, session: dcSession, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.points.count, 81)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: SessionCurveChartUpdate(status: .failed("x"), session: nil))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testSurfaceSlugExposedOnView() {
        XCTAssertEqual(SessionCurveChart.surfaceSlug, "SessionCurveChart")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class SessionCurveAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Locale-independent number formatter for the tests.
    private let number: (Double, Int) -> String = { value, decimals in
        String(format: "%.\(decimals)f", value)
    }

    func testChartSummaryIncludesPeakAndSpan() {
        let projection = SessionCurveBuilder.project(
            SessionCurveInput(startSocPct: 10, endSocPct: 90, peakPowerW: 150_000, chargerType: "Tesla")
        )
        let summary = SessionCurveAccessibility.chartSummary(projection: projection, localize: echo, number: number)
        XCTAssertTrue(summary.contains("Power vs SOC"))
        XCTAssertTrue(summary.contains("peak 150.0 kW"))
        XCTAssertTrue(summary.contains("from 10%"))
        XCTAssertTrue(summary.contains("to 90%"))
    }

    func testChartSummaryEmpty() {
        let summary = SessionCurveAccessibility.chartSummary(
            projection: .empty,
            localize: echo,
            number: number
        )
        XCTAssertTrue(summary.contains("Power vs SOC"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testPointValue() {
        let point = SessionCurvePoint(soc: 65, power: 112.5)
        let value = SessionCurveAccessibility.pointValue(point, localize: echo, number: number)
        XCTAssertEqual(value, "65% SOC %: 112.5 kW")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpySessionCurveTelemetry: SessionCurveChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
