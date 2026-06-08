//
//  AIRestorePanel.Tests.swift
//  TeslaSync — P4 feature view · 0201 · AIRestorePanel (Apple)
//
//  Unit coverage for the AIRestorePanel surface:
//    • Adapter — the frozen feature catalog (known/unknown + names), the preview-label
//      walk (order, disabled filtering, known label keys, unknown verbatim fallback),
//      and the spoken summary.
//    • State holder — `AIRestoreProjection` across loading / empty / error / data, plus
//      the `AIRestoreModel` wiring, the P1/S11 `view.opened` telemetry, the confirm /
//      decline forwarding, and the stale auto-refresh transition.
//    • i18n facade — the label resolution (known key fallback vs unknown verbatim).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryAIRestoreSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Feature catalog (native port of `@/ai/features`)

final class AIFeatureCatalogTests: XCTestCase {
    func testKnownFeatureResolvesName() {
        XCTAssertTrue(AIFeatureCatalog.isKnown("chatbot-llm"))
        XCTAssertEqual(AIFeatureCatalog.name(for: "chatbot-llm"), "LLM Chatbot")
        XCTAssertEqual(AIFeatureCatalog.name(for: "nl-search"), "Natural-language search")
    }

    func testUnknownFeatureIsNotInCatalog() {
        XCTAssertFalse(AIFeatureCatalog.isKnown("legacy-removed-feature"))
        XCTAssertNil(AIFeatureCatalog.name(for: "legacy-removed-feature"))
    }

    func testLabelKeyMatchesWebPattern() {
        XCTAssertEqual(AIFeatureCatalog.labelKey(for: "chatbot-llm"), "ai.settings.feature.chatbot-llm.label")
    }

    func testCatalogPortsAllFeatures() {
        // Parity with the frozen web `AI_FEATURES` table (57 entries).
        XCTAssertEqual(AIFeatureCatalog.names.count, 57)
        XCTAssertTrue(AIFeatureCatalog.isKnown("__usage__"))
        XCTAssertEqual(AIFeatureCatalog.name(for: "yir-narration"), "Year-in-review narration")
    }
}

// MARK: - Preview labels (native port of `previewLabels`)

final class AIRestorePreviewTests: XCTestCase {
    func testDropsDisabledEntriesAndPreservesOrder() {
        let archived = [
            AIArchivedEntry(id: "chatbot-llm", enabled: true),
            AIArchivedEntry(id: "drive-coaching", enabled: false),
            AIArchivedEntry(id: "nl-search", enabled: true)
        ]
        let labels = AIRestorePreview.labels(for: archived)
        XCTAssertEqual(labels.map(\.id), ["chatbot-llm", "nl-search"])
    }

    func testKnownFeatureCarriesKeyAndCatalogFallback() {
        let labels = AIRestorePreview.labels(for: [AIArchivedEntry(id: "chatbot-llm", enabled: true)])
        XCTAssertEqual(labels.count, 1)
        XCTAssertEqual(labels.first?.labelKey, "ai.settings.feature.chatbot-llm.label")
        XCTAssertEqual(labels.first?.fallback, "LLM Chatbot")
        XCTAssertEqual(labels.first?.isKnown, true)
    }

    func testUnknownFeatureFallsBackToRawId() {
        let labels = AIRestorePreview.labels(for: [AIArchivedEntry(id: "legacy-removed-feature", enabled: true)])
        XCTAssertEqual(labels.count, 1)
        XCTAssertNil(labels[0].labelKey)
        XCTAssertEqual(labels[0].fallback, "legacy-removed-feature")
        XCTAssertFalse(labels[0].isKnown)
    }

    func testEmptyWhenNothingEnabled() {
        let archived = [
            AIArchivedEntry(id: "chatbot-llm", enabled: false),
            AIArchivedEntry(id: "nl-search", enabled: false)
        ]
        XCTAssertTrue(AIRestorePreview.labels(for: archived).isEmpty)
        XCTAssertFalse(AIRestorePreview.hasRestorableEntries(archived))
    }

    func testHasRestorableEntriesWhenAnyEnabled() {
        let archived = [
            AIArchivedEntry(id: "chatbot-llm", enabled: false),
            AIArchivedEntry(id: "nl-search", enabled: true)
        ]
        XCTAssertTrue(AIRestorePreview.hasRestorableEntries(archived))
    }
}

// MARK: - Accessibility summary

final class AIRestoreAccessibilityTests: XCTestCase {
    func testSummaryJoinsTitleDescriptionAndFeatures() {
        let summary = AIRestoreAccessibility.summary(
            title: "Restore previous Helix selection?",
            description: "Re-enable them now?",
            features: ["LLM Chatbot", "Natural-language search"]
        )
        XCTAssertEqual(
            summary,
            "Restore previous Helix selection? Re-enable them now? LLM Chatbot, Natural-language search"
        )
    }

    func testSummaryWithoutFeaturesOmitsList() {
        let summary = AIRestoreAccessibility.summary(
            title: "Restore previous Helix selection?",
            description: "Re-enable them now?",
            features: []
        )
        XCTAssertEqual(summary, "Restore previous Helix selection? Re-enable them now?")
    }
}

// MARK: - i18n facade label resolution

final class AIRestoreStringsTests: XCTestCase {
    /// The "AIRestorePanel" table is folded in at integration time, so the test bundle
    /// resolves each key to its `value:` fallback — deterministic for these assertions.
    func testKnownLabelResolvesToCatalogFallback() {
        let label = AIRestoreLabel(
            id: "chatbot-llm",
            labelKey: "ai.settings.feature.chatbot-llm.label",
            fallback: "LLM Chatbot",
            isKnown: true
        )
        XCTAssertEqual(AIRestoreStrings.label(label), "LLM Chatbot")
    }

    func testUnknownLabelResolvesToRawId() {
        let label = AIRestoreLabel(id: "legacy", labelKey: nil, fallback: "legacy", isKnown: false)
        XCTAssertEqual(AIRestoreStrings.label(label), "legacy")
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class AIRestoreProjectionTests: XCTestCase {
    private let dataArchive = [AIArchivedEntry(id: "chatbot-llm", enabled: true)]

    func testErrorTakesPrecedence() {
        let resolved = AIRestoreProjection.resolve(
            AIRestoreInput(archived: dataArchive, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.labels.isEmpty)
    }

    func testLoadingWhenFlaggedOrNoSnapshot() {
        XCTAssertEqual(AIRestoreProjection.resolve(AIRestoreInput(isLoading: true)).phase, .loading)
        XCTAssertEqual(AIRestoreProjection.resolve(AIRestoreInput(archived: nil)).phase, .loading)
    }

    func testEmptyWhenNothingEnabled() {
        let archived = [AIArchivedEntry(id: "chatbot-llm", enabled: false)]
        XCTAssertEqual(AIRestoreProjection.resolve(AIRestoreInput(archived: archived)).phase, .empty)
    }

    func testDataResolvesLabels() {
        let archived = [
            AIArchivedEntry(id: "chatbot-llm", enabled: true),
            AIArchivedEntry(id: "legacy-removed-feature", enabled: true)
        ]
        let resolved = AIRestoreProjection.resolve(AIRestoreInput(archived: archived))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.labels.map(\.id), ["chatbot-llm", "legacy-removed-feature"])
    }
}

// MARK: - State holder: wiring, telemetry, actions, freshness

@MainActor
final class AIRestoreModelTests: XCTestCase {
    private func makeModel(
        _ input: AIRestoreInput,
        telemetry: AIRestoreTelemetry = OSLogAIRestoreTelemetry()
    ) -> (AIRestoreModel, InMemoryAIRestoreSource) {
        let source = InMemoryAIRestoreSource(initial: input)
        let model = AIRestoreModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: AIRestoreInput {
        AIRestoreInput(archived: [AIArchivedEntry(id: "chatbot-llm", enabled: true)])
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAIRestoreTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.labels.count, 1)
        XCTAssertEqual(spy.surfaces, [AIRestorePanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(AIRestoreInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.resolved.labels.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(AIRestoreInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testConfirmAndDeclineDelegateToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.confirm()
        model.decline()
        XCTAssertEqual(source.confirmCount, 1)
        XCTAssertEqual(source.declineCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AIRestoreInput(archived: dataInput.archived, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(AIRestoreInput(archived: dataInput.archived, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(AIRestoreInput(archived: dataInput.archived, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AIRestorePanel.surfaceSlug, "AIRestorePanel")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAIRestoreTelemetry: AIRestoreTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
