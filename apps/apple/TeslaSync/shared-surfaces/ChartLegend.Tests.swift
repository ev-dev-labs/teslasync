//
//  ChartLegend.Tests.swift
//  TeslaSync — P4 shared surface · 0068 · ChartLegend (Apple)
//
//  Coverage for the ChartLegend surface composition:
//    • Projection — every render branch (loading / error / empty-state / withdrawn / populated), the
//      interactive vs passive entry mapping (dim only when interactive + hidden; passive blank value),
//      the carried freshness axis (live / stale / offline), the alignment pass-through, and the
//      `presentsContent` predicate.
//    • Model — start idempotence, the lazy once-only `view.opened` telemetry (never while loading /
//      withdrawn), the phase transitions, toggle (mutates the owned hidden set, forwards to the host,
//      no-op when passive), reset (clears, no-op when passive / empty), the one-shot stale auto-refresh
//      (re-armed on return to live), offline never auto-refreshing, and stop / refresh.
//    • Views — every state's subview composes (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure projection / model directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Test doubles

/// Records each `view.opened` emission. Accessed only on the main actor in these tests.
private final class RecordingChartLegendTelemetry: ChartLegendTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []

    func viewOpened(surface: String) {
        opened.append(surface)
    }
}

/// The identity (fallback) resolver — the projection's strings become their English defaults so the
/// assertions are deterministic without a bundle.
private let resolver: ChartLegendResolve = { _, fallback in fallback }

private func sampleSeries() -> [ChartLegendItem] {
    [
        ChartLegendItem(id: "speed", label: "Speed", colorHex: "#3b82f6", paletteIndex: 0),
        ChartLegendItem(id: "power", label: "Power", colorHex: "#a855f7", paletteIndex: 1)
    ]
}

// MARK: - Projection (render branches + P4 leaf contract)

final class ChartLegendProjectionTests: XCTestCase {
    func testLoading() {
        let resolved = ChartLegendProjection.resolve(ChartLegendInput(availability: .loading), strings: resolver)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertEqual(resolved.legendAccessibilityLabel, "Chart legend")
        XCTAssertNil(resolved.freshness)
        XCTAssertFalse(resolved.presentsContent)
    }

    func testErrorCarriesMessage() {
        let resolved = ChartLegendProjection.resolve(
            ChartLegendInput(availability: .failed("Network timed out")),
            strings: resolver
        )
        guard case let .error(content) = resolved.phase else { return XCTFail("expected error") }
        XCTAssertEqual(content.message, "Network timed out")
        XCTAssertEqual(content.accessibilityLabel, "Couldn't load the chart legend: Network timed out")
        XCTAssertFalse(resolved.presentsContent)
    }

    func testErrorFallsBackOnEmptyMessage() {
        let resolved = ChartLegendProjection.resolve(
            ChartLegendInput(availability: .failed("")),
            strings: resolver
        )
        guard case let .error(content) = resolved.phase else { return XCTFail("expected error") }
        XCTAssertEqual(content.message, "Couldn't load the chart legend.")
    }

    func testEmptyStatePolicy() {
        let resolved = ChartLegendProjection.resolve(
            ChartLegendInput(availability: .resolved([]), emptyBehavior: .emptyState),
            strings: resolver
        )
        guard case let .empty(empty) = resolved.phase else { return XCTFail("expected empty") }
        XCTAssertEqual(empty.title, "No series")
        XCTAssertFalse(empty.message.isEmpty)
        XCTAssertTrue(resolved.presentsContent)
    }

    func testEmptyWithdraw() {
        let resolved = ChartLegendProjection.resolve(
            ChartLegendInput(availability: .resolved([]), emptyBehavior: .withdraw),
            strings: resolver
        )
        XCTAssertEqual(resolved.phase, .withdrawn)
        XCTAssertFalse(resolved.presentsContent)
    }

    func testPopulatedInteractiveMapsRowsAndDimsHidden() {
        let input = ChartLegendInput(
            availability: .resolved(sampleSeries()),
            connection: .live,
            interactivity: .interactive,
            hidden: ["power"]
        )
        let resolved = ChartLegendProjection.resolve(input, strings: resolver)
        guard case let .populated(rows) = resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows.count, 2)

        let speed = rows[0]
        XCTAssertEqual(speed.id, "speed")
        XCTAssertEqual(speed.label, "Speed")
        XCTAssertEqual(speed.colorHex, "#3b82f6")
        XCTAssertFalse(speed.isHidden)
        XCTAssertTrue(speed.isInteractive)
        XCTAssertEqual(speed.accessibilityLabel, "Speed")
        XCTAssertEqual(speed.accessibilityValue, "Shown")
        XCTAssertEqual(speed.accessibilityHint, "Double tap to toggle this series")

        let power = rows[1]
        XCTAssertTrue(power.isHidden, "the key in the hidden set is dimmed")
        XCTAssertEqual(power.accessibilityValue, "Hidden")
        XCTAssertNil(resolved.freshness)
        XCTAssertTrue(resolved.presentsContent)
    }

    func testPassiveNeverDimsAndHasBlankValue() {
        let input = ChartLegendInput(
            availability: .resolved(sampleSeries()),
            connection: .live,
            interactivity: .passive,
            hidden: ["power"]
        )
        let resolved = ChartLegendProjection.resolve(input, strings: resolver)
        guard case let .populated(rows) = resolved.phase else { return XCTFail("expected populated") }
        for row in rows {
            XCTAssertFalse(row.isHidden, "a passive legend never dims (web resolved == null)")
            XCTAssertFalse(row.isInteractive)
            XCTAssertEqual(row.accessibilityValue, "")
            XCTAssertNil(row.accessibilityHint)
        }
    }

    func testAlignmentIsCarried() {
        let input = ChartLegendInput(availability: .resolved(sampleSeries()), alignment: .trailing)
        let resolved = ChartLegendProjection.resolve(input, strings: resolver)
        XCTAssertEqual(resolved.alignment, .trailing)
    }

    func testPopulatedStaleFreshness() {
        let resolved = ChartLegendProjection.resolve(
            ChartLegendInput(availability: .resolved(sampleSeries()), connection: .stale),
            strings: resolver
        )
        XCTAssertEqual(resolved.freshness?.label, "Stale")
        XCTAssertEqual(resolved.freshness?.isOffline, false)
    }

    func testPopulatedOfflineFreshness() {
        let resolved = ChartLegendProjection.resolve(
            ChartLegendInput(availability: .resolved(sampleSeries()), connection: .offline),
            strings: resolver
        )
        XCTAssertEqual(resolved.freshness?.label, "Offline")
        XCTAssertEqual(resolved.freshness?.isOffline, true)
    }
}

// MARK: - Model (state-holder + telemetry + toggle + freshness)

@MainActor
final class ChartLegendModelTests: XCTestCase {
    /// The model under test plus its in-memory source and recording telemetry (a named bag rather
    /// than a wide tuple, per the `large_tuple` lint rule).
    private struct Harness {
        let model: ChartLegendModel
        let source: InMemoryChartLegendSource
        let telemetry: RecordingChartLegendTelemetry
    }

    private func makeHarness(
        initial: ChartLegendInput? = nil,
        initialHidden: Set<String> = [],
        onToggle: (@MainActor (String) -> Void)? = nil
    ) -> Harness {
        let source = InMemoryChartLegendSource(initial: initial)
        let telemetry = RecordingChartLegendTelemetry()
        let model = ChartLegendModel(
            source: source,
            onToggle: onToggle,
            initialHidden: initialHidden,
            telemetry: telemetry
        )
        return Harness(model: model, source: source, telemetry: telemetry)
    }

    private func populated(
        _ connection: ChartLegendConnection = .live,
        interactivity: ChartLegendInteractivity = .interactive
    ) -> ChartLegendInput {
        ChartLegendInput(
            availability: .resolved(sampleSeries()),
            connection: connection,
            interactivity: interactivity
        )
    }

    func testStartIsIdempotent() {
        let harness = makeHarness(initial: ChartLegendInput(availability: .loading))
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 1)
    }

    func testResolvesPopulatedThroughSource() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(populated())
        guard case let .populated(rows) = harness.model.resolved.phase else { return XCTFail("expected populated") }
        XCTAssertEqual(rows.count, 2)
    }

    func testViewOpenedFiresOnceOnFirstContent() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(ChartLegendInput(availability: .loading))
        XCTAssertTrue(harness.telemetry.opened.isEmpty, "loading is pre-content")
        harness.source.push(populated())
        harness.source.push(populated(.stale))
        XCTAssertEqual(harness.telemetry.opened, ["ChartLegend"], "view.opened fires exactly once")
    }

    func testViewOpenedFiresForEmptyState() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(ChartLegendInput(availability: .resolved([]), emptyBehavior: .emptyState))
        XCTAssertEqual(harness.telemetry.opened, ["ChartLegend"])
    }

    func testViewOpenedNeverFiresWhileWithdrawn() {
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(ChartLegendInput(availability: .resolved([]), emptyBehavior: .withdraw))
        XCTAssertTrue(harness.telemetry.opened.isEmpty, "empty payload is never opened")
    }

    func testToggleUpdatesHiddenAndForwardsToHost() {
        var toggled: [String] = []
        let harness = makeHarness(onToggle: { toggled.append($0) })
        harness.model.start()
        harness.source.push(populated())
        harness.model.toggle("power")
        XCTAssertEqual(harness.model.hidden, ["power"])
        XCTAssertEqual(toggled, ["power"])
        guard case let .populated(rows) = harness.model.resolved.phase else { return XCTFail("expected populated") }
        XCTAssertTrue(rows.first { $0.id == "power" }?.isHidden ?? false, "toggled series renders hidden")
        harness.model.toggle("power")
        XCTAssertTrue(harness.model.hidden.isEmpty, "second toggle re-shows the series")
        XCTAssertEqual(toggled, ["power", "power"])
    }

    func testToggleIsNoOpWhenPassive() {
        var toggled: [String] = []
        let harness = makeHarness(onToggle: { toggled.append($0) })
        harness.model.start()
        harness.source.push(populated(interactivity: .passive))
        harness.model.toggle("power")
        XCTAssertTrue(harness.model.hidden.isEmpty, "passive legend has no toggle (web resolved == null)")
        XCTAssertTrue(toggled.isEmpty)
    }

    func testResetClearsHidden() {
        let harness = makeHarness(initialHidden: ["speed", "power"])
        harness.model.start()
        harness.source.push(populated())
        XCTAssertEqual(harness.model.hidden, ["speed", "power"])
        harness.model.reset()
        XCTAssertTrue(harness.model.hidden.isEmpty)
    }

    func testResetIsNoOpWhenPassive() {
        let harness = makeHarness(initialHidden: ["power"])
        harness.model.start()
        harness.source.push(populated(interactivity: .passive))
        harness.model.reset()
        XCTAssertEqual(harness.model.hidden, ["power"], "passive legend does not reset")
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
        let harness = makeHarness(initial: ChartLegendInput(availability: .loading))
        harness.model.start()
        harness.model.refresh()
        XCTAssertEqual(harness.source.refreshCount, 1)
        harness.model.stop()
        XCTAssertEqual(harness.source.stopCount, 1)
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 2, "stop allows a fresh start")
    }
}

// MARK: - Views (signature contract — every state composes)

@MainActor
final class ChartLegendViewsTests: XCTestCase {
    func testSurfaceInitializers() {
        let source = InMemoryChartLegendSource(initial: ChartLegendInput(availability: .loading))
        _ = ChartLegend(model: ChartLegendModel(source: source))
        _ = ChartLegend(
            input: ChartLegendInput(availability: .resolved(sampleSeries())),
            initialHidden: ["power"]
        ) { _ in }
    }

    func testStateSubviewsCompose() {
        _ = ChartLegendLoadingView()
        _ = ChartLegendEmptyView(content: ChartLegendEmpty(title: "t", message: "m"))
        _ = ChartLegendErrorView(content: ChartLegendErrorContent(message: "m", accessibilityLabel: "a")) {}
        _ = ChartLegendPopulatedView(
            legendAccessibilityLabel: "Chart legend",
            alignment: .center,
            freshness: ChartLegendFreshness(label: "Stale", accessibilityLabel: "a", isOffline: false),
            rows: [],
            onRefresh: {},
            onToggle: { _ in }
        )
    }

    func testEntryAndSwatchCompose() {
        let row = ChartLegendRow(
            id: "speed",
            label: "Speed",
            colorHex: "#3b82f6",
            paletteIndex: 0,
            isHidden: false,
            isInteractive: true,
            accessibilityLabel: "Speed",
            accessibilityValue: "Shown",
            accessibilityHint: "Double tap to toggle this series"
        )
        _ = ChartLegendEntryView(row: row) {}
        _ = ChartLegendSwatch(colorHex: row.colorHex, paletteIndex: row.paletteIndex)
        XCTAssertEqual(chartLegendColor(hex: "#zzzzzz", paletteIndex: 0), TSChartPalette.color(at: 0))
    }
}
