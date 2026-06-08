//
//  AdvancedSettings.Tests.swift
//  TeslaSync — P4 feature view · 0198 · AdvancedSettings (Apple)
//
//  Unit coverage for the AdvancedSettings surface:
//    • Adapter (persisted ids → projection) — `AdvancedSettingsProjector` value parity with the web
//      source's pipeline (the `useSilenceKeyLabel` switch incl. the raw-key fallback, the
//      `listSilenced()` de-dupe + sort, blank-id drop, the row label + a11y label), plus the body-
//      phase precedence (loading / error / empty / content).
//    • State holder — `AdvancedSettingsModel` start/`view.opened` telemetry, snapshot → phase, the
//      web `handleRestore` / `handleRestoreAll` mutations (which re-read the store), refresh
//      delegation, and the stale auto-refresh / offline wiring.
//    • Accessibility — the per-phase list summary + the per-row restore label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no persistence I/O: the model is
//  driven by `InMemoryConfirmSilenceStore`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: persisted ids → projection (port parity with the web source)

@MainActor
final class AdvancedSettingsAdapterTests: XCTestCase {
    func testLabelMapsKnownKeysAndFallsBackToRawKey() {
        XCTAssertEqual(AdvancedSettingsProjector.label(for: "discard-draft"), "Discard unsaved draft")
        XCTAssertEqual(
            AdvancedSettingsProjector.label(for: "unsaved-navigation"),
            "Leave page with unsaved changes"
        )
        // Web `default: return key` — forward-compat for ids without a shipped label.
        XCTAssertEqual(AdvancedSettingsProjector.label(for: "remove-widget"), "remove-widget")
    }

    func testProjectSortsByKeyAndMapsRows() {
        let projection = AdvancedSettingsProjector.project(
            keys: ["unsaved-navigation", "discard-draft", "remove-widget"]
        )
        XCTAssertEqual(projection.rows.map(\.id), ["discard-draft", "remove-widget", "unsaved-navigation"])
        XCTAssertEqual(
            projection.rows.map(\.label),
            ["Discard unsaved draft", "remove-widget", "Leave page with unsaved changes"]
        )
        XCTAssertEqual(projection.rows[0].accessibilityLabel, "Silenced prompt: Discard unsaved draft")
    }

    func testProjectDeduplicatesKeys() {
        let projection = AdvancedSettingsProjector.project(
            keys: ["discard-draft", "discard-draft", "unsaved-navigation"]
        )
        XCTAssertEqual(projection.rows.count, 2)
        XCTAssertEqual(projection.rows.count(where: { $0.id == "discard-draft" }), 1)
    }

    func testProjectDropsBlankKeys() {
        let projection = AdvancedSettingsProjector.project(keys: ["   ", "", "discard-draft"])
        XCTAssertEqual(projection.rows.count, 1)
        XCTAssertEqual(projection.rows.first?.id, "discard-draft")
    }

    func testProjectEmptyYieldsNoRows() {
        let projection = AdvancedSettingsProjector.project(keys: [])
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasRows)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(AdvancedSettingsProjector.resolvePhase(.loading, hasRows: true), .loading)
        XCTAssertEqual(AdvancedSettingsProjector.resolvePhase(.failed("x"), hasRows: true), .error("x"))
        XCTAssertEqual(AdvancedSettingsProjector.resolvePhase(.loaded, hasRows: true), .content)
        XCTAssertEqual(AdvancedSettingsProjector.resolvePhase(.loaded, hasRows: false), .empty)
    }
}

// MARK: - State holder: snapshot → phase, mutations, telemetry

@MainActor
final class AdvancedSettingsModelTests: XCTestCase {
    private func makeModel(
        keys: [String],
        status: AdvancedSettingsLoadStatus = .loaded,
        connection: AdvancedSettingsConnection = .live,
        telemetry: AdvancedSettingsTelemetry = OSLogAdvancedSettingsTelemetry()
    ) -> (AdvancedSettingsModel, InMemoryConfirmSilenceStore) {
        let store = InMemoryConfirmSilenceStore(keys: keys, status: status, connection: connection)
        let model = AdvancedSettingsModel(store: store, telemetry: telemetry, copy: .fallback)
        return (model, store)
    }

    func testStartEmitsViewOpenedOnceAndStartsStore() {
        let spy = SpyAdvancedSettingsTelemetry()
        let (model, store) = makeModel(keys: [], telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [AdvancedSettings.surfaceSlug])
        XCTAssertEqual(store.startCount, 1)
    }

    func testLoadedWithKeysShowsContentSorted() {
        let (model, _) = makeModel(keys: ["unsaved-navigation", "discard-draft"])
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.hasSilencedPrompts)
        XCTAssertEqual(model.projection.rows.map(\.id), ["discard-draft", "unsaved-navigation"])
    }

    func testLoadedEmptyShowsEmpty() {
        let (model, _) = makeModel(keys: [])
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.hasSilencedPrompts)
    }

    func testFailedShowsError() {
        let (model, _) = makeModel(keys: ["discard-draft"], status: .failed("boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testRestoreRemovesKeyAndReprojects() {
        let (model, store) = makeModel(keys: ["discard-draft", "unsaved-navigation"])
        model.start()
        let target = model.projection.rows[0] // discard-draft
        model.restore(target)
        XCTAssertEqual(store.restoredKeys, ["discard-draft"])
        XCTAssertEqual(model.projection.rows.map(\.id), ["unsaved-navigation"])
    }

    func testRestoreAllClearsAndShowsEmpty() {
        let (model, store) = makeModel(keys: ["discard-draft", "unsaved-navigation"])
        model.start()
        model.restoreAll()
        XCTAssertEqual(store.restoreAllCount, 1)
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.projection.rows.isEmpty)
    }

    func testRefreshDelegatesToStore() {
        let (model, store) = makeModel(keys: [])
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(store.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLive() {
        let (model, store) = makeModel(keys: ["discard-draft"], connection: .live)
        model.start()
        XCTAssertEqual(store.refreshCount, 0)

        store.push(AdvancedSettingsUpdate(status: .loaded, keys: ["discard-draft"], connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(store.refreshCount, 1)

        store.push(AdvancedSettingsUpdate(status: .loaded, keys: ["discard-draft"], connection: .stale))
        XCTAssertEqual(store.refreshCount, 1)

        store.push(AdvancedSettingsUpdate(status: .loaded, keys: ["discard-draft"], connection: .live))
        store.push(AdvancedSettingsUpdate(status: .loaded, keys: ["discard-draft"], connection: .stale))
        XCTAssertEqual(store.refreshCount, 2)
    }

    func testOfflineKeepsContentWithoutRefresh() {
        let (model, store) = makeModel(keys: ["discard-draft"])
        model.start()
        store.push(AdvancedSettingsUpdate(status: .loaded, keys: ["discard-draft"], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(store.refreshCount, 0)
    }
}

// MARK: - Accessibility summaries

@MainActor
final class AdvancedSettingsAccessibilityTests: XCTestCase {
    private let fallback: (String, String) -> String = { _, value in value }

    func testSummaryForEachPhase() {
        XCTAssertEqual(summary(.loading), "Loading silenced prompts")
        XCTAssertEqual(summary(.content, count: 2), "2 silenced prompts")
        XCTAssertEqual(summary(.empty), "No silenced prompts")
        XCTAssertEqual(summary(.error("x")), "Couldn't load silenced prompts")
    }

    func testRestoreLabelNamesThePrompt() {
        let label = AdvancedSettingsAccessibility.restoreLabel(for: "Discard unsaved draft", localize: fallback)
        XCTAssertEqual(label, "Restore “Discard unsaved draft”")
    }

    @MainActor
    func testModelRestoreAccessibilityLabel() {
        let store = InMemoryConfirmSilenceStore(keys: ["discard-draft"])
        let model = AdvancedSettingsModel(store: store, copy: .fallback)
        model.start()
        let row = model.projection.rows[0]
        XCTAssertEqual(model.restoreAccessibilityLabel(for: row), "Restore “Discard unsaved draft”")
        XCTAssertEqual(model.listAccessibilitySummary, "1 silenced prompts")
    }

    private func summary(_ phase: AdvancedSettingsPhase, count: Int = 0) -> String {
        AdvancedSettingsAccessibility.summary(for: phase, count: count, localize: fallback)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAdvancedSettingsTelemetry: AdvancedSettingsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
