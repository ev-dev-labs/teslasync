//
//  AIFeatureToggleList.Tests.swift
//  TeslaSync — P4 feature view · 0199 · AIFeatureToggleList (Apple)
//
//  Unit coverage for the AI feature-toggle settings surface:
//    • Registry — count / web-order parity (vs AI_FEATURE_IDS) / unique ids / non-empty names.
//    • Adapter  — the projection (one row per registry entry, in order), `Boolean(values[id])` state
//      read (absent ⇒ off), the label fallback (web meta.name), the label/description key shape, and
//      the on/off VoiceOver words + combined summary.
//    • State holder — `AIFeatureToggleListModel.resolvePhase` across loading / empty / loaded / failed,
//      the model wiring, the P1/S11 `view.opened` telemetry, the optimistic flip + persist seam, and
//      the stale auto-refresh transition.
//    • Catalogue — the shipped `.strings` carries a non-empty label (== registry name) + description
//      for every feature id, plus the legend (proves the long descriptions ship even though they are
//      not Swift literals).
//    • View — an `ImageRenderer` render smoke for every state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryAIFeatureToggleSource`. The host harness does not bundle the per-surface
//  `.strings`, so `string(key, fallback)` returns the fallback — which is exactly the web meta.name for
//  labels, letting the label assertions pin real names; the catalogue test reads the table file
//  directly to pin the descriptions.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Projector: one row per feature, value read, fallbacks, keys, a11y

final class AIFeatureToggleProjectorTests: XCTestCase {
    func testProjectionRowPerRegistryEntryInOrder() {
        let rows = AIFeatureToggleProjector.project(values: [:]).rows
        XCTAssertEqual(rows.map(\.id), expectedFeatureIDs)
    }

    func testRowEnabledReflectsValuesMap() {
        let values = ["nl-search": true, "drive-coaching": true, "rag-help": false]
        let rows = AIFeatureToggleProjector.project(values: values).rows
        let byID = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0.isEnabled) })
        XCTAssertEqual(byID["nl-search"], true)
        XCTAssertEqual(byID["drive-coaching"], true)
        XCTAssertEqual(byID["rag-help"], false)
    }

    func testAbsentIdReadsOff() {
        // Web `Boolean(values[id])`: an id missing from the map is off.
        let rows = AIFeatureToggleProjector.project(values: [:]).rows
        XCTAssertTrue(rows.allSatisfy { !$0.isEnabled })
    }

    func testRowLabelResolvesRegistryNameFallback() {
        // The harness does not bundle the table, so the facade returns the fallback — the web meta.name.
        let rows = AIFeatureToggleProjector.project(values: [:]).rows
        let namesByID = Dictionary(uniqueKeysWithValues: AIFeatureRegistry.all.map { ($0.id, $0.name) })
        for row in rows {
            XCTAssertEqual(row.label, namesByID[row.id])
            XCTAssertEqual(row.accessibilityLabel, namesByID[row.id])
        }
    }

    func testLabelAndDescriptionKeyShape() {
        XCTAssertEqual(AIFeatureToggleProjector.labelKey("nl-search"), "ai.settings.feature.nl-search.label")
        XCTAssertEqual(
            AIFeatureToggleProjector.descriptionKey("nl-search"),
            "ai.settings.feature.nl-search.description"
        )
    }

    func testStateTextOnOff() {
        XCTAssertEqual(AIFeatureToggleProjector.stateText(true), "On")
        XCTAssertEqual(AIFeatureToggleProjector.stateText(false), "Off")
    }

    func testRowAccessibilityValueTracksState() {
        let rows = AIFeatureToggleProjector.project(values: ["nl-search": true]).rows
        let byID = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0.accessibilityValue) })
        XCTAssertEqual(byID["nl-search"], "On")
        XCTAssertEqual(byID["voice-mode"], "Off")
    }

    func testAccessibilitySummaryListsEveryRow() {
        let summary = AIFeatureToggleProjector.project(values: ["nl-search": true]).accessibilitySummary
        XCTAssertTrue(summary.contains("Natural-language search, On"))
        XCTAssertTrue(summary.contains("LLM Chatbot, Off"))
    }
}

// MARK: - Accessibility helpers

final class AIFeatureToggleAccessibilityTests: XCTestCase {
    func testJoinFiltersEmptyAndTileJoinsLabelValue() {
        XCTAssertEqual(AIFeatureToggleAccessibility.join(["LLM Chatbot", "", "On"]), "LLM Chatbot, On")
        XCTAssertEqual(AIFeatureToggleAccessibility.tile("Voice mode", "Off"), "Voice mode, Off")
    }
}

// MARK: - State holder: phase, wiring, telemetry, toggle, freshness

@MainActor
final class AIFeatureToggleListModelTests: XCTestCase {
    private func makeModel(
        _ update: AIFeatureToggleUpdate,
        telemetry: AIFeatureToggleTelemetry = OSLogAIFeatureToggleTelemetry()
    ) -> (AIFeatureToggleListModel, InMemoryAIFeatureToggleSource) {
        let source = InMemoryAIFeatureToggleSource(initial: update)
        let model = AIFeatureToggleListModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataUpdate: AIFeatureToggleUpdate {
        AIFeatureToggleUpdate(status: .loaded, values: ["nl-search": true])
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(AIFeatureToggleListModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(AIFeatureToggleListModel.resolvePhase(status: .loading, hasData: true), .data)
        XCTAssertEqual(AIFeatureToggleListModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(AIFeatureToggleListModel.resolvePhase(status: .loaded, hasData: true), .data)
        XCTAssertEqual(AIFeatureToggleListModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(AIFeatureToggleListModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(AIFeatureToggleListModel.resolvePhase(status: .failed("x"), hasData: true), .data)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAIFeatureToggleTelemetry()
        let (model, source) = makeModel(dataUpdate, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.projection?.rows.count, 57)
        XCTAssertEqual(spy.surfaces, [AIFeatureToggleListSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoading() {
        let (model, _) = makeModel(AIFeatureToggleUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testLoadedEmptyMapIsDataAllOff() {
        // A resolved record with no opt-ins is data (all switches off), NOT the empty state.
        let (model, _) = makeModel(AIFeatureToggleUpdate(status: .loaded, values: [:]))
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.projection?.rows.count, 57)
        XCTAssertTrue(model.projection?.rows.allSatisfy { !$0.isEnabled } ?? false)
    }

    func testEmptyStatusProjectsEmpty() {
        let (model, source) = makeModel(AIFeatureToggleUpdate(status: .loading))
        model.start()
        source.push(AIFeatureToggleUpdate(status: .empty))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testFailedWithCachedValuesStaysData() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        source.push(AIFeatureToggleUpdate(status: .failed("boom")))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.projection?.rows.count, 57)
    }

    func testToggleOptimisticallyUpdatesAndPersists() {
        let (model, source) = makeModel(AIFeatureToggleUpdate(status: .loaded, values: [:]))
        model.start()
        model.toggle(id: "nl-search", true)
        XCTAssertEqual(model.phase, .data)
        let row = model.projection?.rows.first { $0.id == "nl-search" }
        XCTAssertEqual(row?.isEnabled, true)
        XCTAssertEqual(source.persisted.count, 1)
        XCTAssertEqual(source.persisted.first?.id, "nl-search")
        XCTAssertEqual(source.persisted.first?.enabled, true)
    }

    func testToggleIsNoOpWhenUnchanged() {
        let (model, source) = makeModel(AIFeatureToggleUpdate(status: .loaded, values: ["nl-search": true]))
        model.start()
        model.toggle(id: "nl-search", true)
        XCTAssertTrue(source.persisted.isEmpty)
    }

    func testToggleOffPersistsFalse() {
        let (model, source) = makeModel(AIFeatureToggleUpdate(status: .loaded, values: ["nl-search": true]))
        model.start()
        model.toggle(id: "nl-search", false)
        let row = model.projection?.rows.first { $0.id == "nl-search" }
        XCTAssertEqual(row?.isEnabled, false)
        XCTAssertEqual(source.persisted.first?.enabled, false)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)
        source.push(AIFeatureToggleUpdate(status: .loaded, connection: .stale, values: ["nl-search": true]))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(AIFeatureToggleUpdate(status: .loaded, connection: .stale, values: ["nl-search": true]))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testLiveThenStaleReArmsAutoRefresh() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        source.push(AIFeatureToggleUpdate(status: .loaded, connection: .stale, values: ["nl-search": true]))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(AIFeatureToggleUpdate(status: .loaded, connection: .live, values: ["nl-search": true]))
        XCTAssertEqual(model.connection, .live)
        source.push(AIFeatureToggleUpdate(status: .loaded, connection: .stale, values: ["nl-search": true]))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedWithoutAutoRefresh() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        source.push(AIFeatureToggleUpdate(status: .loaded, connection: .offline, values: ["nl-search": true]))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshAndStopReArm() {
        let (model, source) = makeModel(dataUpdate)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AIFeatureToggleList.surfaceSlug, "AIFeatureToggleList")
    }
}

// MARK: - View render smoke (every state builds + renders)

@MainActor
final class AIFeatureToggleListViewStateTests: XCTestCase {
    private func renderSmoke(_ update: AIFeatureToggleUpdate, file: StaticString = #filePath, line: UInt = #line) {
        let source = InMemoryAIFeatureToggleSource(initial: update)
        let model = AIFeatureToggleListModel(source: source)
        model.start()
        let renderer = ImageRenderer(content: AIFeatureToggleList(model: model).frame(width: 360, height: 900))
        XCTAssertNotNil(renderer.cgImage, file: file, line: line)
    }

    func testContentRenders() {
        renderSmoke(AIFeatureToggleUpdate(status: .loaded, values: ["nl-search": true, "voice-mode": true]))
    }

    func testAllOffRenders() {
        renderSmoke(AIFeatureToggleUpdate(status: .loaded, values: [:]))
    }

    func testEmptyRenders() {
        renderSmoke(AIFeatureToggleUpdate(status: .empty))
    }

    func testLoadingRenders() {
        renderSmoke(AIFeatureToggleUpdate(status: .loading))
    }

    func testErrorRenders() {
        renderSmoke(AIFeatureToggleUpdate(status: .failed("Network request timed out")))
    }

    func testStaleRenders() {
        renderSmoke(AIFeatureToggleUpdate(status: .loaded, connection: .stale, values: ["nl-search": true]))
    }

    func testOfflineRenders() {
        renderSmoke(AIFeatureToggleUpdate(status: .loaded, connection: .offline, values: ["nl-search": true]))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAIFeatureToggleTelemetry: AIFeatureToggleTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
