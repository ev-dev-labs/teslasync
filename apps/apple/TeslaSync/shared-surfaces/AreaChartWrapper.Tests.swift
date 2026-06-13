//
//  AreaChartWrapper.Tests.swift
//  TeslaSync — P4 shared surface · 0064 · AreaChartWrapper (Apple)
//
//  Coverage for the AreaChartWrapper surface composition:
//    • Projection — every render branch (loading / error / empty-state / withdrawn / populated), the
//      per-series mapping (a populated series with data + a series with no finite points → its "no
//      data" summary), the multi-series finite filter, the y-formatter flowing into the spoken
//      summary, the carried freshness axis (live / stale / offline), the height pass-through, and the
//      `presentsContent` predicate.
//    • Model — start idempotence, the lazy once-only `view.opened` telemetry (never while loading /
//      withdrawn), the phase transitions, the one-shot stale auto-refresh (re-armed on return to
//      live), offline never auto-refreshing, and stop / refresh.
//    • Views — the per-state subview signature contract lives in the sibling
//      `AreaChartWrapper.ViewTests.swift`.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure projection / model directly.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Test doubles + fixtures

/// Records each `view.opened` emission. Accessed only on the main actor in these tests.
private final class RecordingAreaChartTelemetry: AreaChartTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []

    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

/// The identity (fallback) resolver — the projection's strings become their English defaults so the
/// assertions are deterministic without a bundle.
private let resolver: AreaChartResolve = { _, fallback in fallback }

private func sampleData() -> AreaChartData {
    let rows: [AreaChartRow] = [
        AreaChartRow(x: "0", values: ["battery": 60, "energy": 10]),
        AreaChartRow(x: "1", values: ["battery": 80, "energy": 14]),
        AreaChartRow(x: "2", values: ["battery": 92])
    ]
    let series: [AreaChartSeries] = [
        AreaChartSeries(id: "battery", label: "Battery %", colorHex: "#10b981", colorIndex: 2),
        AreaChartSeries(id: "energy", label: "kWh", colorHex: "#f59e0b", colorIndex: 1),
        // A series absent from every row → its summary is the "no data" copy.
        AreaChartSeries(id: "regen", label: "Regen", colorHex: "#06b6d4", colorIndex: 3)
    ]
    return AreaChartData(rows: rows, series: series)
}

// MARK: - Projection (render branches + P4 leaf contract)

final class AreaChartProjectionTests: XCTestCase {
    func testLoading() {
        let resolved = AreaChartProjection.resolve(
            AreaChartInput(availability: .loading, height: 220),
            strings: resolver
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertEqual(resolved.chartAccessibilityLabel, "Area chart")
        XCTAssertEqual(resolved.height, 220)
        XCTAssertNil(resolved.freshness)
        XCTAssertFalse(resolved.presentsContent)
    }

    func testErrorCarriesMessage() {
        let resolved = AreaChartProjection.resolve(
            AreaChartInput(availability: .failed("Network timed out")),
            strings: resolver
        )
        guard case let .error(content) = resolved.phase else { return XCTFail("expected error") }
        XCTAssertEqual(content.message, "Network timed out")
        XCTAssertEqual(content.accessibilityLabel, "Couldn't load the chart: Network timed out")
        XCTAssertFalse(resolved.presentsContent)
    }

    func testErrorFallsBackOnEmptyMessage() {
        let resolved = AreaChartProjection.resolve(
            AreaChartInput(availability: .failed("")),
            strings: resolver
        )
        guard case let .error(content) = resolved.phase else { return XCTFail("expected error") }
        XCTAssertEqual(content.message, "Couldn't load the chart.")
    }

    func testEmptyStateForNoSeries() {
        let resolved = AreaChartProjection.resolve(
            AreaChartInput(availability: .resolved(AreaChartData()), emptyBehavior: .emptyState),
            strings: resolver
        )
        guard case let .empty(empty) = resolved.phase else { return XCTFail("expected empty") }
        XCTAssertEqual(empty.title, "No data")
        XCTAssertFalse(empty.message.isEmpty)
        XCTAssertTrue(resolved.presentsContent)
    }

    func testEmptyStateForSeriesWithoutFinitePoints() {
        let data = AreaChartData(
            rows: [AreaChartRow(x: "0", values: ["a": .nan])],
            series: [AreaChartSeries(id: "a", label: "A", colorHex: "#10b981")]
        )
        let resolved = AreaChartProjection.resolve(
            AreaChartInput(availability: .resolved(data), emptyBehavior: .emptyState),
            strings: resolver
        )
        guard case .empty = resolved.phase else { return XCTFail("expected empty") }
    }

    func testEmptyWithdraw() {
        let resolved = AreaChartProjection.resolve(
            AreaChartInput(availability: .resolved(AreaChartData()), emptyBehavior: .withdraw),
            strings: resolver
        )
        XCTAssertEqual(resolved.phase, .withdrawn)
        XCTAssertFalse(resolved.presentsContent)
    }

    func testPopulatedMapsSeriesAndProjectsData() {
        let input = AreaChartInput(
            availability: .resolved(sampleData()),
            connection: .live,
            valueFormat: AreaValueFormat(suffix: "%")
        )
        let resolved = AreaChartProjection.resolve(input, strings: resolver)
        guard case let .populated(plot) = resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(plot.series.count, 3)
        XCTAssertEqual(plot.labels, ["0", "1", "2"])
        XCTAssertEqual(plot.valueFormat, AreaValueFormat(suffix: "%"))

        let battery = plot.series[0]
        XCTAssertEqual(battery.id, "battery")
        XCTAssertEqual(battery.label, "Battery %")
        XCTAssertEqual(battery.colorHex, "#10b981")
        XCTAssertEqual(battery.points.map(\.value), [60, 80, 92])
        XCTAssertEqual(battery.accessibilitySummary, "Battery %: latest 92%, low 60%, high 92%")

        let energy = plot.series[1]
        XCTAssertEqual(energy.points.map(\.value), [10, 14], "the row missing energy is dropped")
        XCTAssertEqual(energy.points.map(\.index), [0, 1])

        let regen = plot.series[2]
        XCTAssertTrue(regen.points.isEmpty)
        XCTAssertEqual(regen.accessibilitySummary, "Regen: no data")

        XCTAssertNil(resolved.freshness)
        XCTAssertTrue(resolved.presentsContent)
    }

    func testPopulatedChartSummaryJoinsSeries() {
        let resolved = AreaChartProjection.resolve(
            AreaChartInput(availability: .resolved(sampleData())),
            strings: resolver
        )
        guard case let .populated(plot) = resolved.phase else { return XCTFail("expected populated") }
        XCTAssertTrue(plot.accessibilitySummary.contains("Battery %: latest 92"))
        XCTAssertTrue(plot.accessibilitySummary.contains("Regen: no data"))
    }

    func testPopulatedStaleFreshness() {
        let resolved = AreaChartProjection.resolve(
            AreaChartInput(availability: .resolved(sampleData()), connection: .stale),
            strings: resolver
        )
        XCTAssertEqual(resolved.freshness?.label, "Stale")
        XCTAssertEqual(resolved.freshness?.isOffline, false)
    }

    func testPopulatedOfflineFreshness() {
        let resolved = AreaChartProjection.resolve(
            AreaChartInput(availability: .resolved(sampleData()), connection: .offline),
            strings: resolver
        )
        XCTAssertEqual(resolved.freshness?.label, "Offline")
        XCTAssertEqual(resolved.freshness?.isOffline, true)
    }

    func testHeightIsCarried() {
        let resolved = AreaChartProjection.resolve(
            AreaChartInput(availability: .resolved(sampleData()), height: 180),
            strings: resolver
        )
        XCTAssertEqual(resolved.height, 180)
    }
}

// MARK: - Model (state-holder + telemetry + freshness)

@MainActor
final class AreaChartWrapperModelTests: XCTestCase {
    /// The model under test plus its in-memory source and recording telemetry (a named bag rather than
    /// a wide tuple, per the `large_tuple` lint rule).
    private struct Harness {
        let model: AreaChartWrapperModel
        let source: InMemoryAreaChartSource
        let telemetry: RecordingAreaChartTelemetry
    }

    private func makeHarness(initial: AreaChartInput? = nil) -> Harness {
        let source = InMemoryAreaChartSource(initial: initial)
        let telemetry = RecordingAreaChartTelemetry()
        let model = AreaChartWrapperModel(source: source, telemetry: telemetry)
        return Harness(model: model, source: source, telemetry: telemetry)
    }

    private func populated(_ connection: AreaChartConnection = .live) -> AreaChartInput {
        AreaChartInput(availability: .resolved(sampleData()), connection: connection)
    }

    func testStartIsIdempotent() {
        let harness = makeHarness(initial: AreaChartInput(availability: .loading))
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 1)
    }

    func testResolvesPopulatedThroughSource() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(populated())
        guard case let .populated(plot) = harness.model.resolved.phase else {
            return XCTFail("expected populated")
        }
        XCTAssertEqual(plot.series.count, 3)
    }

    func testViewOpenedFiresOnceOnFirstContent() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(AreaChartInput(availability: .loading))
        XCTAssertTrue(harness.telemetry.opened.isEmpty, "loading is pre-content")
        harness.source.push(populated())
        harness.source.push(populated(.stale))
        XCTAssertEqual(harness.telemetry.opened, ["AreaChartWrapper"], "view.opened fires exactly once")
    }

    func testViewOpenedFiresForEmptyState() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(AreaChartInput(
            availability: .resolved(AreaChartData()),
            emptyBehavior: .emptyState
        ))
        XCTAssertEqual(harness.telemetry.opened, ["AreaChartWrapper"])
    }

    func testViewOpenedNeverFiresWhileWithdrawn() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(AreaChartInput(
            availability: .resolved(AreaChartData()),
            emptyBehavior: .withdraw
        ))
        XCTAssertTrue(harness.telemetry.opened.isEmpty, "empty payload is never opened")
    }

    func testStaleTriggersOneShotAutoRefresh() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(populated(.live))
        XCTAssertEqual(harness.source.refreshCount, 0)
        harness.source.push(populated(.stale))
        XCTAssertEqual(harness.source.refreshCount, 1, "stale arms one auto-refresh")
        harness.source.push(populated(.stale))
        XCTAssertEqual(harness.source.refreshCount, 1, "no re-fire while still stale")
    }

    func testReturnToLiveRearmsStaleRefresh() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(populated(.stale))
        harness.source.push(populated(.live))
        harness.source.push(populated(.stale))
        XCTAssertEqual(harness.source.refreshCount, 2)
    }

    func testOfflineNeverAutoRefreshes() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(populated(.offline))
        XCTAssertEqual(harness.source.refreshCount, 0)
    }

    func testRefreshAndStopWiring() {
        let harness = makeHarness(initial: AreaChartInput(availability: .loading))
        harness.model.start()
        harness.model.refresh()
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.model.stop()
        XCTAssertEqual(harness.source.stopCount, 1)
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 2, "stop allows a fresh start")
    }
}
