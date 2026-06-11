//
//  BatteryComparison.Tests.swift
//  TeslaSync — P4 feature view · 0275 · BatteryComparison (Apple)
//
//  Unit coverage for the BatteryComparison surface:
//    • Adapter (`BatteryComparisonBuilder` / `BatteryComparisonFormat` / `BatteryComparisonTintRules`)
//      — the battery tint thresholds (web `batteryColor`), the canonical SI distance factors +
//      `formatDistance` parity (km / mi / non-finite dash / grouping), the percent + fill fraction,
//      the `display_name || vin` label fallback, and the projection that drops null states (web
//      `q.state !== null`) and sets the content/empty split.
//    • State holder (`BatteryComparisonModel`) — phase across loading / loaded / empty / failed, the
//      P1/S11 `view.opened` telemetry (once), the stale auto-refresh (exactly once + re-arm), offline
//      keeping cached bars, and unit preferences flowing into the range text.
//    • Accessibility — the panel summary + per-row VoiceOver value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no bundle: the
//  adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: tint, format, projection (web parity)

@MainActor final class BatteryComparisonAdapterTests: XCTestCase {
    private let enUS = Locale(identifier: "en_US")

    func testBatteryTintMirrorsBatteryColorThresholds() {
        // Web `batteryColor`: > 60 → green, > 25 → amber, else red.
        XCTAssertEqual(BatteryComparisonTintRules.battery(level: 61), .success)
        XCTAssertEqual(BatteryComparisonTintRules.battery(level: 60), .warning)
        XCTAssertEqual(BatteryComparisonTintRules.battery(level: 26), .warning)
        XCTAssertEqual(BatteryComparisonTintRules.battery(level: 25), .danger)
        XCTAssertEqual(BatteryComparisonTintRules.battery(level: 0), .danger)
    }

    func testConvertDistancePinsCanonicalFactors() {
        XCTAssertEqual(BatteryComparisonFormat.convertDistance(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(BatteryComparisonFormat.convertDistance(1609.344, to: .miles), 1, accuracy: 1e-9)
    }

    func testFormatDistanceKilometers() {
        XCTAssertEqual(
            BatteryComparisonFormat.formatDistance(380_000, unit: .kilometers, locale: enUS),
            "380.0 km"
        )
    }

    func testFormatDistanceMiles() {
        // 380000 / 1609.344 = 236.12… → precision 1.
        XCTAssertEqual(
            BatteryComparisonFormat.formatDistance(380_000, unit: .miles, locale: enUS),
            "236.1 mi"
        )
    }

    func testFormatDistanceGroupsThousands() {
        XCTAssertEqual(
            BatteryComparisonFormat.formatDistance(1_500_000, unit: .kilometers, locale: enUS),
            "1,500.0 km"
        )
    }

    func testFormatDistanceNonFiniteIsDash() {
        XCTAssertEqual(BatteryComparisonFormat.formatDistance(.infinity, unit: .kilometers, locale: enUS), "—")
        XCTAssertEqual(BatteryComparisonFormat.formatDistance(.nan, unit: .miles, locale: enUS), "—")
    }

    func testPercentRoundsToInteger() {
        XCTAssertEqual(BatteryComparisonFormat.percent(82), 82)
        XCTAssertEqual(BatteryComparisonFormat.percent(47.6), 48)
        XCTAssertEqual(BatteryComparisonFormat.percent(.nan), 0)
    }

    func testFractionClampsToUnitInterval() {
        XCTAssertEqual(BatteryComparisonFormat.fraction(82), 0.82, accuracy: 1e-9)
        XCTAssertEqual(BatteryComparisonFormat.fraction(0), 0, accuracy: 1e-9)
        XCTAssertEqual(BatteryComparisonFormat.fraction(150), 1, accuracy: 1e-9)
        XCTAssertEqual(BatteryComparisonFormat.fraction(-5), 0, accuracy: 1e-9)
        XCTAssertEqual(BatteryComparisonFormat.fraction(.nan), 0, accuracy: 1e-9)
    }

    func testVehicleLabelFallsBackToVin() {
        XCTAssertEqual(BatteryComparisonVehicle(id: 1, displayName: "Model 3", vin: "VIN1").label, "Model 3")
        XCTAssertEqual(BatteryComparisonVehicle(id: 2, displayName: "", vin: "VIN2").label, "VIN2")
        XCTAssertEqual(BatteryComparisonVehicle(id: 3, displayName: "   ", vin: "VIN3").label, "VIN3")
    }

    func testProjectDropsNilStatesAndKeepsOrder() {
        let entries = [
            entry(id: 1, name: "A", level: 82, range: 380_000),
            BatteryComparisonEntry(vehicle: BatteryComparisonVehicle(id: 2, displayName: "B", vin: "V2"), state: nil),
            entry(id: 3, name: "C", level: 18, range: 96000)
        ]
        let projection = BatteryComparisonBuilder.project(entries, units: .metric)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.bars.map(\.id), [1, 3])
        XCTAssertEqual(projection.bars.map(\.label), ["A", "C"])
    }

    func testProjectEmptyWhenAllStatesNil() {
        let entries = [
            BatteryComparisonEntry(vehicle: BatteryComparisonVehicle(id: 1, displayName: "A", vin: "V1"), state: nil)
        ]
        let projection = BatteryComparisonBuilder.project(entries, units: .metric)
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.bars.isEmpty)
    }

    func testProjectBuildsBarValues() {
        let projection = BatteryComparisonBuilder.project(
            [entry(id: 7, name: "Test", level: 82, range: 380_000)],
            units: .metric
        )
        let bar = try? XCTUnwrap(projection.bars.first)
        XCTAssertEqual(bar?.label, "Test")
        XCTAssertEqual(bar?.level, 82)
        XCTAssertEqual(bar?.percentText, "82%")
        XCTAssertEqual(bar?.rangeText, "380.0 km")
        XCTAssertEqual(bar?.fraction ?? 0, 0.82, accuracy: 1e-9)
        XCTAssertEqual(bar?.tint, .success)
    }

    func testProjectAppliesImperialUnits() {
        let projection = BatteryComparisonBuilder.project(
            [entry(id: 1, name: "A", level: 50, range: 380_000)],
            units: .imperial
        )
        XCTAssertEqual(projection.bars.first?.rangeText, "236.1 mi")
    }

    func testResolvePhase() {
        XCTAssertEqual(BatteryComparisonBuilder.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(BatteryComparisonBuilder.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(BatteryComparisonBuilder.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(BatteryComparisonBuilder.resolvePhase(.failed("boom"), hasData: true), .error("boom"))
    }

    func testSurfaceSlug() {
        XCTAssertEqual(BatteryComparisonSurface.slug, "BatteryComparison")
    }

    private func entry(id: Int, name: String, level: Double, range: Double) -> BatteryComparisonEntry {
        BatteryComparisonEntry(
            vehicle: BatteryComparisonVehicle(id: id, displayName: name, vin: "VIN\(id)"),
            state: BatteryComparisonVehicleState(batteryLevel: level, ratedRange: range)
        )
    }
}

// MARK: - State holder: BatteryComparisonModel

@MainActor final class BatteryComparisonModelTests: XCTestCase {
    private func makeModel(
        initial: BatteryComparisonUpdate?,
        telemetry: BatteryComparisonTelemetry = SpyBatteryComparisonTelemetry()
    ) -> (BatteryComparisonModel, InMemoryBatteryComparisonSource) {
        let source = InMemoryBatteryComparisonSource(initial: initial)
        let model = BatteryComparisonModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var sampleEntries: [BatteryComparisonEntry] {
        [
            BatteryComparisonEntry(
                vehicle: BatteryComparisonVehicle(id: 1, displayName: "Model 3", vin: "V1"),
                state: BatteryComparisonVehicleState(batteryLevel: 82, ratedRange: 380_000)
            ),
            BatteryComparisonEntry(
                vehicle: BatteryComparisonVehicle(id: 2, displayName: "Model Y", vin: "V2"),
                state: BatteryComparisonVehicleState(batteryLevel: 47, ratedRange: 214_000)
            )
        ]
    }

    func testLoadedContentProjectsBars() {
        let (model, source) = makeModel(initial: BatteryComparisonUpdate(status: .loaded, entries: sampleEntries))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.bars.count, 2)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: BatteryComparisonUpdate(status: .loaded, entries: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.projection.hasData)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: BatteryComparisonUpdate(status: .loading, entries: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: BatteryComparisonUpdate(status: .failed("timeout"), entries: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyBatteryComparisonTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BatteryComparisonSurface.slug])
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BatteryComparisonUpdate(status: .loaded, entries: sampleEntries, connection: .stale))
        source.push(BatteryComparisonUpdate(status: .loaded, entries: sampleEntries, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BatteryComparisonUpdate(status: .loaded, entries: sampleEntries, connection: .stale))
        source.push(BatteryComparisonUpdate(status: .loaded, entries: sampleEntries, connection: .live))
        source.push(BatteryComparisonUpdate(status: .loaded, entries: sampleEntries, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedBarsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BatteryComparisonUpdate(status: .loaded, entries: sampleEntries, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.bars.count, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testUnitPreferencesFlowIntoRangeText() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BatteryComparisonUpdate(status: .loaded, entries: sampleEntries, units: .imperial))
        XCTAssertEqual(model.bars.first?.rangeText, "236.1 mi")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: BatteryComparisonUpdate(status: .failed("x"), entries: []))
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
        XCTAssertEqual(BatteryComparison.surfaceSlug, "BatteryComparison")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class BatteryComparisonAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testPanelSummaryIncludesTitleAndCount() {
        let summary = BatteryComparisonAccessibility.panelSummary(barCount: 3, localize: echo)
        XCTAssertTrue(summary.contains("Fleet Battery Status"))
        XCTAssertTrue(summary.contains("3 vehicles"))
    }

    func testPanelSummaryEmpty() {
        let summary = BatteryComparisonAccessibility.panelSummary(barCount: 0, localize: echo)
        XCTAssertTrue(summary.contains("Fleet Battery Status"))
        XCTAssertTrue(summary.contains("No data available"))
    }

    func testRowValue() {
        let bar = BatteryComparisonBar(
            id: 1,
            label: "Model 3",
            level: 82,
            percentText: "82%",
            rangeText: "380.0 km",
            fraction: 0.82,
            tint: .success
        )
        XCTAssertEqual(BatteryComparisonAccessibility.rowValue(bar), "Model 3: 82%, 380.0 km")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyBatteryComparisonTelemetry: BatteryComparisonTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
