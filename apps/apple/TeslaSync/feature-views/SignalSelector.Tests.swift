//
//  SignalSelector.Tests.swift
//  TeslaSync — P4 feature view · 0270 · SignalSelector (Apple)
//
//  Unit coverage for the SignalSelector surface:
//    • Adapter (cached available list → option projection / dedup, the ordered
//      capped reconciliation that maps a combobox `Set`-edit back to the web
//      `slice(0, cap)`, the `Signals (N / max)` label, the at-capacity flag) —
//      the parity port of the web `SignalSelector` wrapper, pure + deterministic.
//    • Accessibility — the composed VoiceOver copy for the field.
//    • State holder — `SignalSelectorModel` phase resolution across loading /
//      loaded / empty / failed, the cap-enforcing selection write-back, the
//      candidate-list snapshot application, the stale auto-refresh guard, plus the
//      P1/S11 `view.opened` telemetry + source wiring (start/stop/refresh).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySignalSelectorSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: option projection / cap / label

@MainActor final class SignalSelectorProjectionTests: XCTestCase {
    func testOptionsTrimDropBlanksAndDeduplicatePreservingOrder() {
        let input = ["VehicleSpeed", " VehicleSpeed ", "", "BatteryLevel", "VehicleSpeed", "ChargeState"]
        let options = SignalSelectorProjection.options(from: input)
        XCTAssertEqual(options, ["VehicleSpeed", "BatteryLevel", "ChargeState"])
    }

    func testApplyCapTruncatesAndHonorsUncapped() {
        let items = ["A", "B", "C", "D"]
        XCTAssertEqual(SignalSelectorProjection.applyCap(items, cap: 2), ["A", "B"])
        XCTAssertEqual(SignalSelectorProjection.applyCap(items, cap: nil), items)
        XCTAssertEqual(SignalSelectorProjection.applyCap(items, cap: 0), [])
    }

    func testReconcileKeepsPriorOrderAndAppendsAdditions() {
        let result = SignalSelectorProjection.reconcile(
            previous: ["Bravo", "Alpha"],
            incoming: ["Alpha", "Bravo", "Charlie"],
            cap: nil
        )
        XCTAssertEqual(result, ["Bravo", "Alpha", "Charlie"])
    }

    func testReconcileDropsTheCheckPastTheCapLikeTheWebSlice() {
        let result = SignalSelectorProjection.reconcile(
            previous: ["Alpha", "Bravo", "Charlie"],
            incoming: ["Alpha", "Bravo", "Charlie", "Delta"],
            cap: 3
        )
        XCTAssertEqual(result, ["Alpha", "Bravo", "Charlie"])
    }

    func testReconcileRemovesDeselectedItems() {
        let result = SignalSelectorProjection.reconcile(
            previous: ["Alpha", "Bravo", "Charlie"],
            incoming: ["Alpha", "Charlie"],
            cap: 5
        )
        XCTAssertEqual(result, ["Alpha", "Charlie"])
    }

    func testLabelMatchesTheWebCappedAndUncappedAndOverrideForms() {
        XCTAssertEqual(
            SignalSelectorProjection.label(selectedCount: 2, max: 5, override: nil, signalsWord: "Signals"),
            "Signals (2 / 5)"
        )
        XCTAssertEqual(
            SignalSelectorProjection.label(selectedCount: 2, max: nil, override: nil, signalsWord: "Signals"),
            "Signals (2)"
        )
        XCTAssertEqual(
            SignalSelectorProjection.label(selectedCount: 2, max: 5, override: "Compare", signalsWord: "Signals"),
            "Compare"
        )
    }

    func testIsAtCapacityOnlyWhenCappedAndReached() {
        XCTAssertTrue(SignalSelectorProjection.isAtCapacity(selectedCount: 5, max: 5))
        XCTAssertFalse(SignalSelectorProjection.isAtCapacity(selectedCount: 2, max: 5))
        XCTAssertFalse(SignalSelectorProjection.isAtCapacity(selectedCount: 99, max: nil))
    }
}

// MARK: - Accessibility: composed VoiceOver copy

@MainActor final class SignalSelectorAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCappedSummaryShowsSelectedOverMax() {
        let summary = SignalSelectorAccessibility.selectorSummary(selectedCount: 2, max: 5, localize: echo)
        XCTAssertEqual(summary, "Signals selector, 2 / 5 selected")
    }

    func testUncappedSummaryOmitsTheMax() {
        let summary = SignalSelectorAccessibility.selectorSummary(selectedCount: 3, max: nil, localize: echo)
        XCTAssertEqual(summary, "Signals selector, 3 selected")
    }
}

// MARK: - State holder: phase resolution

@MainActor final class SignalSelectorPhaseTests: XCTestCase {
    func testLoadingResolvesToLoading() {
        XCTAssertEqual(SignalSelectorModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(SignalSelectorModel.resolvePhase(status: .loading, hasData: true), .loading)
    }

    func testLoadedWithSignalsIsContent() {
        XCTAssertEqual(SignalSelectorModel.resolvePhase(status: .loaded, hasData: true), .content)
    }

    func testLoadedWithoutSignalsIsEmpty() {
        XCTAssertEqual(SignalSelectorModel.resolvePhase(status: .loaded, hasData: false), .empty)
    }

    func testExplicitEmptyStatusIsEmpty() {
        XCTAssertEqual(SignalSelectorModel.resolvePhase(status: .empty, hasData: false), .empty)
    }

    func testFailureAlwaysResolvesToError() {
        XCTAssertEqual(
            SignalSelectorModel.resolvePhase(status: .failed("boom"), hasData: true),
            .error("boom")
        )
    }
}

// MARK: - State holder: selection + telemetry + source wiring

@MainActor final class SignalSelectorModelTests: XCTestCase {
    /// Telemetry spy capturing each `view.opened` surface slug.
    private final class SpyTelemetry: SignalSelectorTelemetry, @unchecked Sendable {
        private(set) var surfaces: [String] = []
        func viewOpened(surface: String) {
            surfaces.append(surface)
        }
    }

    private func makeModel(
        source: InMemorySignalSelectorSource,
        telemetry: SignalSelectorTelemetry = OSLogSignalSelectorTelemetry(),
        max: Int? = 5,
        showsLayerHelp: Bool = true,
        labelOverride: String? = nil,
        initialSelection: [String] = []
    ) -> SignalSelectorModel {
        SignalSelectorModel(
            source: source,
            telemetry: telemetry,
            max: max,
            showsLayerHelp: showsLayerHelp,
            labelOverride: labelOverride,
            initialSelection: initialSelection
        )
    }

    func testInitialSelectionIsDedupedAndCapped() {
        let model = makeModel(
            source: InMemorySignalSelectorSource(),
            max: 2,
            initialSelection: ["Alpha", "Alpha", "Bravo", "Charlie"]
        )
        XCTAssertEqual(model.selection, ["Alpha", "Bravo"])
    }

    func testDerivedLabelAndSummaryMatchTheProjection() {
        let model = makeModel(source: InMemorySignalSelectorSource(), initialSelection: ["Alpha", "Bravo"])
        XCTAssertEqual(model.label, "Signals (2 / 5)")
        XCTAssertEqual(model.selectorSummary, "Signals selector, 2 / 5 selected")
        XCTAssertFalse(model.isAtCapacity)
        XCTAssertTrue(model.showsLayerHelp)
    }

    func testStartEmitsViewOpenedOnceAndStartsTheSource() {
        let spy = SpyTelemetry()
        let source = InMemorySignalSelectorSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SignalSelector.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testSetSelectionEnforcesTheCapLikeTheWebSlice() {
        let model = makeModel(source: InMemorySignalSelectorSource(), max: 3)
        model.setSelection(from: ["Alpha", "Bravo", "Charlie", "Delta"])
        XCTAssertEqual(model.selection, ["Alpha", "Bravo", "Charlie"])
        XCTAssertTrue(model.isAtCapacity)
    }

    func testSetSelectionKeepsPriorOrderThenRemoves() {
        let model = makeModel(source: InMemorySignalSelectorSource(), max: nil, initialSelection: ["Bravo", "Alpha"])
        model.setSelection(from: ["Alpha", "Bravo", "Charlie"])
        XCTAssertEqual(model.selection, ["Bravo", "Alpha", "Charlie"])
        model.setSelection(from: ["Bravo", "Charlie"])
        XCTAssertEqual(model.selection, ["Bravo", "Charlie"])
    }

    func testPushedSnapshotUpdatesOptionsPhaseAndConnection() {
        let source = InMemorySignalSelectorSource()
        let model = makeModel(source: source)
        model.start()
        source.push(SignalSelectorUpdate(
            status: .loaded,
            connection: .offline,
            availableSignals: ["Alpha", "Bravo"]
        ))
        XCTAssertEqual(model.options, ["Alpha", "Bravo"])
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.hasData)
    }

    func testStaleConnectionAutoRefreshesExactlyOncePerEpisode() {
        let source = InMemorySignalSelectorSource()
        let model = makeModel(source: source)
        model.start()
        source.push(SignalSelectorUpdate(status: .loaded, connection: .stale, availableSignals: ["Alpha"]))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SignalSelectorUpdate(status: .loaded, connection: .stale, availableSignals: ["Alpha"]))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SignalSelectorUpdate(status: .loaded, connection: .live, availableSignals: ["Alpha"]))
        source.push(SignalSelectorUpdate(status: .loaded, connection: .stale, availableSignals: ["Alpha"]))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineConnectionDoesNotAutoRefresh() {
        let source = InMemorySignalSelectorSource()
        let model = makeModel(source: source)
        model.start()
        source.push(SignalSelectorUpdate(status: .loaded, connection: .offline, availableSignals: ["Alpha"]))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshAndStopDelegateToTheSource() {
        let spy = SpyTelemetry()
        let source = InMemorySignalSelectorSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        model.start()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testStartReplaysTheInitialSnapshot() {
        let source = InMemorySignalSelectorSource(
            initial: SignalSelectorUpdate(status: .loaded, connection: .stale, availableSignals: [])
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertFalse(model.hasData)
    }
}
