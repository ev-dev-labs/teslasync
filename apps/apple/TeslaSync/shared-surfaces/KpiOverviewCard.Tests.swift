//
//  KpiOverviewCard.Tests.swift
//  TeslaSync — P4 shared surface · 0093 · KpiOverviewCard (Apple)
//
//  Coverage for the KpiOverviewCard surface:
//    • Projection (the data adapter: snapshot → resolved view-state) — the deterministic per-state
//      "snapshot": the leaf-contract precedence (error > loading > empty > content), the header
//      composition (period strip with / without the comparison label; the headline delta gated to the
//      content phase), the secondary blank-trim, and the secondary / footer pass-through.
//    • Meta — the diagnostics slug + the period separator.
//    • Accessibility — the KPI tile phrase, the delta direction wording (up / down / none), and the
//      footer severity prefix; each resolves the i18n key with its fallback.
//    • Model — the resolved projection, the source push adoption, the once-only `view.opened`
//      telemetry, the safe stop, the refresh delegation, and the stale one-shot auto-refresh
//      (offline never auto-refreshes).
//    • Source — the in-memory seam's start / stop / refresh counters + the initial / pushed snapshots.
//    • Views — the public surface + every subview compose in each state (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure projection / model / source directly with an identity string resolver so
//  the copy reads as the web/native English fallback.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// Identity resolver — returns each key's English fallback so the assertions read the shipped copy.
private let resolve: KpiOverviewResolve = { _, fallback in fallback }

private func sampleHeader(comparison: Bool = true, delta: KpiOverviewDelta? = nil) -> KpiOverviewHeader {
    KpiOverviewHeader(
        title: "Overview",
        currentLabel: "Last 30 days",
        comparisonLabel: comparison ? "vs prior 30 days" : nil,
        delta: delta
    )
}

private func sampleItems() -> [KpiOverviewItem] {
    [
        KpiOverviewItem(id: "drives", label: "Drives", value: "4"),
        KpiOverviewItem(
            id: "distance",
            label: "Distance",
            value: "46.1 mi",
            delta: KpiOverviewDelta(value: -3, formatted: "3%", lowerIsBetter: true)
        )
    ]
}

private func contentInput(connection: KpiOverviewConnection = .live) -> KpiOverviewInput {
    KpiOverviewInput(
        header: sampleHeader(delta: KpiOverviewDelta(value: 12, formatted: "12%")),
        items: sampleItems(),
        secondary: "Top speed 152 mph · Longest 29.1 mi",
        footer: KpiOverviewCallout(tone: .warning, message: "1 anomaly", actionLabel: "Review"),
        connection: connection
    )
}

// MARK: - Projection (deterministic per-state snapshot)

final class KpiOverviewProjectionTests: XCTestCase {
    func testErrorTakesPrecedenceOverLoadingAndContent() {
        let input = KpiOverviewInput(
            header: sampleHeader(),
            items: sampleItems(),
            isLoading: true,
            errorMessage: "boom"
        )
        XCTAssertEqual(KpiOverviewProjection.resolve(input, strings: resolve).phase, .error("boom"))
    }

    func testBlankErrorMessageDoesNotTriggerErrorPhase() {
        let input = KpiOverviewInput(header: sampleHeader(), items: sampleItems(), errorMessage: "")
        XCTAssertEqual(KpiOverviewProjection.resolve(input, strings: resolve).phase, .content)
    }

    func testLoadingWhenFlaggedAndNoError() {
        let input = KpiOverviewInput(header: sampleHeader(), items: sampleItems(), isLoading: true)
        XCTAssertEqual(KpiOverviewProjection.resolve(input, strings: resolve).phase, .loading)
    }

    func testEmptyWhenNoItems() {
        let input = KpiOverviewInput(header: sampleHeader(), items: [])
        let resolved = KpiOverviewProjection.resolve(input, strings: resolve)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.items.isEmpty)
        XCTAssertNil(resolved.secondary)
        XCTAssertNil(resolved.footer)
    }

    func testContentCarriesItemsSecondaryAndFooter() {
        let resolved = KpiOverviewProjection.resolve(contentInput(), strings: resolve)
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertTrue(resolved.isContent)
        XCTAssertEqual(resolved.items.count, 2)
        XCTAssertEqual(resolved.secondary, "Top speed 152 mph · Longest 29.1 mi")
        XCTAssertEqual(resolved.footer?.message, "1 anomaly")
    }

    func testHeaderAlwaysResolvesAcrossPhases() {
        let loading = KpiOverviewProjection.resolve(
            KpiOverviewInput(header: sampleHeader(), isLoading: true), strings: resolve
        )
        XCTAssertEqual(loading.header.title, "Overview")
        XCTAssertEqual(loading.header.periodText, "Last 30 days · vs prior 30 days")
    }

    func testPeriodStripWithComparison() {
        XCTAssertEqual(
            KpiOverviewProjection.periodStrip(current: "Last 30 days", comparison: "vs prior 30 days"),
            "Last 30 days · vs prior 30 days"
        )
    }

    func testPeriodStripWithoutComparison() {
        XCTAssertEqual(KpiOverviewProjection.periodStrip(current: "Last 30 days", comparison: nil), "Last 30 days")
        XCTAssertEqual(KpiOverviewProjection.periodStrip(current: "Last 30 days", comparison: ""), "Last 30 days")
    }

    func testHeadlineDeltaSurfacedOnlyInContent() {
        let delta = KpiOverviewDelta(value: 12, formatted: "12%")
        let content = KpiOverviewProjection.resolve(
            KpiOverviewInput(header: sampleHeader(delta: delta), items: sampleItems()), strings: resolve
        )
        XCTAssertEqual(content.header.delta, delta)
        XCTAssertEqual(content.header.deltaAccessibilityLabel, "Up 12%")

        let loading = KpiOverviewProjection.resolve(
            KpiOverviewInput(header: sampleHeader(delta: delta), items: sampleItems(), isLoading: true),
            strings: resolve
        )
        XCTAssertNil(loading.header.delta)
        XCTAssertNil(loading.header.deltaAccessibilityLabel)
    }

    func testBlankSecondaryTrimsToNil() {
        let input = KpiOverviewInput(header: sampleHeader(), items: sampleItems(), secondary: "   ")
        XCTAssertNil(KpiOverviewProjection.resolve(input, strings: resolve).secondary)
    }

    func testConnectionPassesThroughEveryPhase() {
        let stale = KpiOverviewProjection.resolve(contentInput(connection: .stale), strings: resolve)
        XCTAssertEqual(stale.connection, .stale)
        let offlineEmpty = KpiOverviewProjection.resolve(
            KpiOverviewInput(header: sampleHeader(), items: [], connection: .offline), strings: resolve
        )
        XCTAssertEqual(offlineEmpty.connection, .offline)
    }
}

// MARK: - Meta

final class KpiOverviewMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(KpiOverviewMeta.surfaceSlug, "KpiOverviewCard")
        XCTAssertEqual(KpiOverviewCard.surfaceSlug, "KpiOverviewCard")
    }

    func testPeriodSeparator() {
        XCTAssertEqual(KpiOverviewMeta.periodSeparator, "·")
    }
}

// MARK: - Accessibility (labels)

final class KpiOverviewAccessibilityTests: XCTestCase {
    func testItemLabelCombinesLabelAndValue() {
        XCTAssertEqual(KpiOverviewAccessibility.itemLabel(label: "Drives", value: "4"), "Drives, 4")
    }

    func testDeltaLabelUp() {
        let label = KpiOverviewAccessibility.deltaLabel(
            KpiOverviewDelta(value: 5, formatted: "5%"), strings: resolve
        )
        XCTAssertEqual(label, "Up 5%")
    }

    func testDeltaLabelDown() {
        let label = KpiOverviewAccessibility.deltaLabel(
            KpiOverviewDelta(value: -5, formatted: "5%"), strings: resolve
        )
        XCTAssertEqual(label, "Down 5%")
    }

    func testDeltaLabelNoChange() {
        let label = KpiOverviewAccessibility.deltaLabel(
            KpiOverviewDelta(value: 0, formatted: "0%"), strings: resolve
        )
        XCTAssertEqual(label, "No change")
    }

    func testCalloutLabelPrefixesSeverity() {
        let label = KpiOverviewAccessibility.calloutLabel(
            KpiOverviewCallout(tone: .warning, message: "1 anomaly"), strings: resolve
        )
        XCTAssertEqual(label, "Warning: 1 anomaly")
    }
}

// MARK: - Model (state-holder)

@MainActor
final class KpiOverviewCardModelTests: XCTestCase {
    private func makeModel(
        initial: KpiOverviewInput?,
        telemetry: KpiOverviewTelemetry = SpyKpiOverviewTelemetry()
    ) -> (KpiOverviewCardModel, InMemoryKpiOverviewSource) {
        let source = InMemoryKpiOverviewSource(initial: initial)
        let model = KpiOverviewCardModel(source: source, telemetry: telemetry, strings: resolve)
        return (model, source)
    }

    func testStartProjectsInitialSnapshot() {
        let (model, _) = makeModel(initial: contentInput())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.resolved.items.count, 2)
    }

    func testPushAdoptsNewSnapshot() {
        let (model, source) = makeModel(initial: KpiOverviewInput(header: sampleHeader(), isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(contentInput())
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyKpiOverviewTelemetry()
        let (model, _) = makeModel(initial: contentInput(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["KpiOverviewCard"])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyKpiOverviewTelemetry()
        let (model, source) = makeModel(initial: contentInput(), telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, ["KpiOverviewCard"])
        XCTAssertEqual(source.stopCount, 2)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(initial: contentInput())
        model.start()
        let before = source.refreshCount
        model.refresh()
        XCTAssertEqual(source.refreshCount, before + 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(initial: contentInput())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(contentInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(contentInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(contentInput(connection: .live))
        source.push(contentInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineNeverAutoRefreshes() {
        let (model, source) = makeModel(initial: contentInput())
        model.start()
        source.push(contentInput(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertEqual(model.connection, .offline)
    }
}

// MARK: - Source (P1/S8 seam)

@MainActor
final class KpiOverviewSourceTests: XCTestCase {
    func testStartEmitsInitialAndCounts() {
        let source = InMemoryKpiOverviewSource(initial: contentInput())
        var received: KpiOverviewInput?
        source.onUpdate = { received = $0 }
        source.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(received?.items.count, 2)
    }

    func testStopAndRefreshCounters() {
        let source = InMemoryKpiOverviewSource()
        source.stop()
        source.refresh()
        source.refresh()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushForwardsSnapshot() {
        let source = InMemoryKpiOverviewSource()
        var received: KpiOverviewInput?
        source.onUpdate = { received = $0 }
        source.push(contentInput(connection: .offline))
        XCTAssertEqual(received?.connection, .offline)
    }

    func testLiveSourceUpdateReemits() {
        let source = LiveKpiOverviewSource(snapshot: KpiOverviewInput(header: sampleHeader(), isLoading: true))
        var received: KpiOverviewInput?
        source.onUpdate = { received = $0 }
        source.start()
        XCTAssertEqual(received?.isLoading, true)
        source.update(contentInput())
        XCTAssertEqual(received?.items.count, 2)
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class KpiOverviewViewTests: XCTestCase {
    func testPublicSurfaceComposes() {
        _ = KpiOverviewCard(input: contentInput())
        _ = KpiOverviewCard(input: contentInput()) {}
        _ = KpiOverviewCard(
            model: KpiOverviewCardModel(source: InMemoryKpiOverviewSource(initial: contentInput()))
        )
    }

    func testStateSubviewsCompose() {
        _ = KpiOverviewLoadingView()
        _ = KpiOverviewEmptyView()
        _ = KpiOverviewErrorView(message: "boom") {}
    }

    func testContentSubviewsCompose() {
        let resolved = KpiOverviewProjection.resolve(contentInput(), strings: resolve)
        _ = KpiOverviewHeaderView(header: resolved.header, connection: .live) {}
        _ = KpiOverviewGridView(items: resolved.items)
        _ = KpiOverviewTileView(item: sampleItems()[0])
        _ = KpiOverviewSecondaryView(text: resolved.secondary ?? "")
        if let footer = resolved.footer {
            _ = KpiOverviewFooterView(callout: footer, onAction: {})
            _ = KpiOverviewFooterView(callout: footer, onAction: nil)
        }
    }

    func testFreshnessChipComposesEachConnection() {
        for connection in KpiOverviewConnection.allCases {
            _ = KpiOverviewFreshnessChip(connection: connection) {}
        }
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyKpiOverviewTelemetry: KpiOverviewTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
