//
//  SmallMultiplesChart.Tests.swift
//  TeslaSync — P4 shared surface · 0073 · SmallMultiplesChart (Apple)
//
//  Coverage for the SmallMultiplesChart surface composition:
//    • Projection — every render branch (loading / error / empty-state / withdrawn / populated), the
//      per-cell mapping (a populated cell with data + a cell with no finite points → its 'No data'
//      label), the interactive vs passive drill-in (hint only when interactive), the carried freshness
//      axis (live / stale / offline), the layout pass-through, and the `presentsContent` predicate.
//    • Layout — the auto-fill column-count packing + the grid-items builder.
//    • Model — start idempotence, the lazy once-only `view.opened` telemetry (never while loading /
//      withdrawn), the phase transitions, cell drill-in forwarding (no-op when passive), the one-shot
//      stale auto-refresh (re-armed on return to live), offline never auto-refreshing, and stop /
//      refresh.
//    • Views — the per-state subview signature contract lives in the sibling
//      `SmallMultiplesChart.ViewTests.swift`.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure projection / model directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Test doubles + fixtures

/// Records each `view.opened` emission. Accessed only on the main actor in these tests.
private final class RecordingSmallMultiplesTelemetry: SmallMultiplesTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []

    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

/// The identity (fallback) resolver — the projection's strings become their English defaults so the
/// assertions are deterministic without a bundle.
private let resolver: SmallMultiplesResolve = { _, fallback in fallback }

private func sampleData() -> SmallMultiplesData {
    let base = Date(timeIntervalSince1970: 1_700_000_000)
    let samples: [SmallMultiplesSample] = [
        SmallMultiplesSample(date: base, values: ["speed": 10, "power": 100]),
        SmallMultiplesSample(date: base.addingTimeInterval(60), values: ["speed": 20, "power": 110]),
        SmallMultiplesSample(date: base.addingTimeInterval(120), values: ["speed": 30, "power": 120])
    ]
    let series: [SmallMultiplesSeries] = [
        SmallMultiplesSeries(id: "speed", label: "Speed", colorHex: "#3b82f6", colorIndex: 0),
        SmallMultiplesSeries(id: "power", label: "Power", colorHex: "#a855f7", colorIndex: 1),
        // A series with no rows → its cell renders the per-cell 'No data' fallback.
        SmallMultiplesSeries(id: "regen", label: "Regen", colorIndex: 2)
    ]
    return SmallMultiplesData(samples: samples, series: series)
}

// MARK: - Projection (render branches + P4 leaf contract)

final class SmallMultiplesProjectionTests: XCTestCase {
    func testLoading() {
        let resolved = SmallMultiplesProjection.resolve(
            SmallMultiplesInput(availability: .loading),
            strings: resolver
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertEqual(resolved.gridAccessibilityLabel, "Small multiples chart")
        XCTAssertNil(resolved.freshness)
        XCTAssertFalse(resolved.presentsContent)
    }

    func testErrorCarriesMessage() {
        let resolved = SmallMultiplesProjection.resolve(
            SmallMultiplesInput(availability: .failed("Network timed out")),
            strings: resolver
        )
        guard case let .error(content) = resolved.phase else { return XCTFail("expected error") }
        XCTAssertEqual(content.message, "Network timed out")
        XCTAssertEqual(content.accessibilityLabel, "Couldn't load the chart: Network timed out")
        XCTAssertFalse(resolved.presentsContent)
    }

    func testErrorFallsBackOnEmptyMessage() {
        let resolved = SmallMultiplesProjection.resolve(
            SmallMultiplesInput(availability: .failed("")),
            strings: resolver
        )
        guard case let .error(content) = resolved.phase else { return XCTFail("expected error") }
        XCTAssertEqual(content.message, "Couldn't load the chart.")
    }

    func testEmptyStatePolicy() {
        let resolved = SmallMultiplesProjection.resolve(
            SmallMultiplesInput(availability: .resolved(SmallMultiplesData()), emptyBehavior: .emptyState),
            strings: resolver
        )
        guard case let .empty(empty) = resolved.phase else { return XCTFail("expected empty") }
        XCTAssertEqual(empty.title, "No series")
        XCTAssertFalse(empty.message.isEmpty)
        XCTAssertTrue(resolved.presentsContent)
    }

    func testEmptyWithdraw() {
        let resolved = SmallMultiplesProjection.resolve(
            SmallMultiplesInput(availability: .resolved(SmallMultiplesData()), emptyBehavior: .withdraw),
            strings: resolver
        )
        XCTAssertEqual(resolved.phase, .withdrawn)
        XCTAssertFalse(resolved.presentsContent)
    }

    func testPopulatedMapsCellsAndProjectsData() {
        let input = SmallMultiplesInput(
            availability: .resolved(sampleData()),
            connection: .live,
            interactivity: .interactive
        )
        let resolved = SmallMultiplesProjection.resolve(input, strings: resolver)
        guard case let .populated(rows) = resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows.count, 3)

        let speed = rows[0]
        XCTAssertEqual(speed.id, "speed")
        XCTAssertEqual(speed.label, "Speed")
        XCTAssertEqual(speed.colorHex, "#3b82f6")
        XCTAssertEqual(speed.points.map(\.value), [10, 20, 30])
        XCTAssertTrue(speed.hasData)
        XCTAssertTrue(speed.isInteractive)
        XCTAssertEqual(speed.accessibilityLabel, "Speed")
        XCTAssertEqual(speed.accessibilityValue, "Latest 30, low 10, high 30")
        XCTAssertEqual(speed.accessibilityHint, "Double tap to open this series")
        XCTAssertEqual(speed.emptyLabel, "No data")

        let regen = rows[2]
        XCTAssertFalse(regen.hasData, "a series with no finite rows has no data")
        XCTAssertTrue(regen.points.isEmpty)
        XCTAssertEqual(regen.accessibilityValue, "No data", "empty cell speaks the 'No data' copy")

        XCTAssertNil(resolved.freshness)
        XCTAssertTrue(resolved.presentsContent)
    }

    func testPassiveCellsHaveNoHint() {
        let input = SmallMultiplesInput(
            availability: .resolved(sampleData()),
            connection: .live,
            interactivity: .passive
        )
        let resolved = SmallMultiplesProjection.resolve(input, strings: resolver)
        guard case let .populated(rows) = resolved.phase else { return XCTFail("expected populated") }
        for row in rows {
            XCTAssertFalse(row.isInteractive)
            XCTAssertNil(row.accessibilityHint, "a passive cell has no drill-in hint")
        }
    }

    func testLayoutIsCarried() {
        let input = SmallMultiplesInput(
            availability: .resolved(sampleData()),
            maxPointsPerCell: 200,
            cellHeight: 96,
            cellMinWidth: 320,
            columns: 3
        )
        let resolved = SmallMultiplesProjection.resolve(input, strings: resolver)
        XCTAssertEqual(resolved.layout.columns, 3)
        XCTAssertEqual(resolved.layout.cellMinWidth, 320)
        XCTAssertEqual(resolved.layout.cellHeight, 96)
    }

    func testPopulatedStaleFreshness() {
        let resolved = SmallMultiplesProjection.resolve(
            SmallMultiplesInput(availability: .resolved(sampleData()), connection: .stale),
            strings: resolver
        )
        XCTAssertEqual(resolved.freshness?.label, "Stale")
        XCTAssertEqual(resolved.freshness?.isOffline, false)
    }

    func testPopulatedOfflineFreshness() {
        let resolved = SmallMultiplesProjection.resolve(
            SmallMultiplesInput(availability: .resolved(sampleData()), connection: .offline),
            strings: resolver
        )
        XCTAssertEqual(resolved.freshness?.label, "Offline")
        XCTAssertEqual(resolved.freshness?.isOffline, true)
    }
}

// MARK: - Layout (auto-fill packing + grid items)

final class SmallMultiplesLayoutTests: XCTestCase {
    func testForcedColumnsWin() {
        XCTAssertEqual(
            SmallMultiplesLayout.columnCount(availableWidth: 900, cellMinWidth: 280, forced: 4),
            4
        )
    }

    func testAdaptiveFit() {
        // (900 + 12) / (280 + 12) = 3.12 → 3 columns.
        XCTAssertEqual(SmallMultiplesLayout.columnCount(availableWidth: 900, cellMinWidth: 280), 3)
    }

    func testAtLeastOneColumn() {
        XCTAssertEqual(SmallMultiplesLayout.columnCount(availableWidth: 100, cellMinWidth: 280), 1)
        XCTAssertEqual(SmallMultiplesLayout.columnCount(availableWidth: 0, cellMinWidth: 280), 1)
    }

    @MainActor
    func testGridItemsBuilder() {
        let fixed = smallMultiplesGridItems(for: SmallMultiplesLayout(columns: 3, cellMinWidth: 280, cellHeight: 120))
        XCTAssertEqual(fixed.count, 3)
        let adaptive = smallMultiplesGridItems(
            for: SmallMultiplesLayout(columns: nil, cellMinWidth: 280, cellHeight: 120)
        )
        XCTAssertEqual(adaptive.count, 1, "auto-fill is a single adaptive GridItem")
    }
}

// MARK: - Model (state-holder + telemetry + drill-in + freshness)

@MainActor
final class SmallMultiplesChartModelTests: XCTestCase {
    /// The model under test plus its in-memory source and recording telemetry (a named bag rather
    /// than a wide tuple, per the `large_tuple` lint rule).
    private struct Harness {
        let model: SmallMultiplesChartModel
        let source: InMemorySmallMultiplesSource
        let telemetry: RecordingSmallMultiplesTelemetry
    }

    private func makeHarness(
        initial: SmallMultiplesInput? = nil,
        onCellClick: (@MainActor (String) -> Void)? = nil
    ) -> Harness {
        let source = InMemorySmallMultiplesSource(initial: initial)
        let telemetry = RecordingSmallMultiplesTelemetry()
        let model = SmallMultiplesChartModel(source: source, onCellClick: onCellClick, telemetry: telemetry)
        return Harness(model: model, source: source, telemetry: telemetry)
    }

    private func populated(
        _ connection: SmallMultiplesConnection = .live,
        interactivity: SmallMultiplesInteractivity = .interactive
    ) -> SmallMultiplesInput {
        SmallMultiplesInput(
            availability: .resolved(sampleData()),
            connection: connection,
            interactivity: interactivity
        )
    }

    func testStartIsIdempotent() {
        let harness = makeHarness(initial: SmallMultiplesInput(availability: .loading))
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 1)
    }

    func testResolvesPopulatedThroughSource() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(populated())
        guard case let .populated(rows) = harness.model.resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows.count, 3)
    }

    func testViewOpenedFiresOnceOnFirstContent() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(SmallMultiplesInput(availability: .loading))
        XCTAssertTrue(harness.telemetry.opened.isEmpty, "loading is pre-content")
        harness.source.push(populated())
        harness.source.push(populated(.stale))
        XCTAssertEqual(harness.telemetry.opened, ["SmallMultiplesChart"], "view.opened fires exactly once")
    }

    func testViewOpenedFiresForEmptyState() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(SmallMultiplesInput(
            availability: .resolved(SmallMultiplesData()),
            emptyBehavior: .emptyState
        ))
        XCTAssertEqual(harness.telemetry.opened, ["SmallMultiplesChart"])
    }

    func testViewOpenedNeverFiresWhileWithdrawn() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(SmallMultiplesInput(
            availability: .resolved(SmallMultiplesData()),
            emptyBehavior: .withdraw
        ))
        XCTAssertTrue(harness.telemetry.opened.isEmpty, "empty payload is never opened")
    }

    func testSelectCellForwardsWhenInteractive() {
        var selected: [String] = []
        let harness = makeHarness(onCellClick: { selected.append($0) })
        harness.model.start()
        harness.source.push(populated())
        harness.model.selectCell("speed")
        XCTAssertEqual(selected, ["speed"])
    }

    func testSelectCellIsNoOpWhenPassive() {
        var selected: [String] = []
        let harness = makeHarness(onCellClick: { selected.append($0) })
        harness.model.start()
        harness.source.push(populated(interactivity: .passive))
        harness.model.selectCell("speed")
        XCTAssertTrue(selected.isEmpty, "passive grid has no drill-in (web onCellClick undefined)")
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
        let harness = makeHarness(initial: SmallMultiplesInput(availability: .loading))
        harness.model.start()
        harness.model.refresh()
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.model.stop()
        XCTAssertEqual(harness.source.stopCount, 1)
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 2, "stop allows a fresh start")
    }
}
