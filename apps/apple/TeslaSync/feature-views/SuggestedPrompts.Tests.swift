//
//  SuggestedPrompts.Tests.swift
//  TeslaSync — P4 feature view · 0223 · SuggestedPrompts (Apple)
//
//  Unit coverage for the SuggestedPrompts surface:
//    • Adapter — the static suggestion catalog (the verbatim port of the web
//      `getChatSuggestions()` array) and the cached → projection mapping, including
//      the blank-key null-safety drop and the empty feed.
//    • State holder — `SuggestedPromptsModel.resolvePhase` across loading / empty /
//      error / content (incl. the cached-behind-error/refresh branches), plus the
//      `SuggestedPromptsModel` wiring, the P1/S11 `view.opened` telemetry, and the
//      stale auto-refresh transition.
//    • Accessibility — the VoiceOver container label, chip label, and chip hint.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySuggestedPromptsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Catalog (verbatim port of web `getChatSuggestions()`)

@MainActor final class SuggestedPromptsCatalogTests: XCTestCase {
    func testCatalogMatchesWebSourceKeysAndOrder() {
        let keys = SuggestedPromptsCatalog.defaults.map(\.i18nKey)
        XCTAssertEqual(keys, [
            "chatbot.suggestion.fleetYesterday",
            "chatbot.suggestion.chargingCost30d",
            "chatbot.suggestion.socDropping",
            "chatbot.suggestion.efficientDrive"
        ])
    }

    func testCatalogMatchesWebSourceDefaults() {
        let defaults = SuggestedPromptsCatalog.defaults.map(\.defaultValue)
        XCTAssertEqual(defaults, [
            "What did my fleet do yesterday?",
            "Charging cost last 30 days",
            "Why is my SoC dropping faster this week?",
            "Show me the most efficient drive this month"
        ])
    }
}

// MARK: - Adapter (web `suggestions.map(...)`)

@MainActor final class SuggestedPromptsAdapterTests: XCTestCase {
    func testProjectMapsEachSuggestionPreservingKeyAndFallback() {
        let projection = SuggestedPromptsAdapter.project(SuggestedPromptsCatalog.defaults)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.items.count, 4)
        XCTAssertEqual(projection.items.map(\.id), SuggestedPromptsCatalog.defaults.map(\.i18nKey))
        XCTAssertEqual(projection.items.map(\.fallback), SuggestedPromptsCatalog.defaults.map(\.defaultValue))
    }

    func testProjectUsesI18nKeyAsStableIdentity() {
        let projection = SuggestedPromptsAdapter.project([
            ChatSuggestion(i18nKey: "k.one", defaultValue: "One")
        ])
        XCTAssertEqual(projection.items.first?.id, "k.one")
        XCTAssertEqual(projection.items.first?.i18nKey, "k.one")
    }

    func testProjectDropsBlankKeyedSuggestions() {
        let projection = SuggestedPromptsAdapter.project([
            ChatSuggestion(i18nKey: "", defaultValue: "Untranslatable"),
            ChatSuggestion(i18nKey: "k.keep", defaultValue: "Keep")
        ])
        XCTAssertEqual(projection.items.map(\.id), ["k.keep"])
    }

    func testProjectEmptyFeedHasNoData() {
        let projection = SuggestedPromptsAdapter.project([])
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.items.isEmpty)
        XCTAssertEqual(projection, .empty)
    }
}

// MARK: - Phase resolution (web shell loading / empty + P4 leaf contract)

@MainActor final class SuggestedPromptsPhaseTests: XCTestCase {
    func testLoadingWithoutDataIsLoading() {
        XCTAssertEqual(SuggestedPromptsModel.resolvePhase(status: .loading, hasData: false), .loading)
    }

    func testLoadingWithCachedDataStaysContent() {
        XCTAssertEqual(SuggestedPromptsModel.resolvePhase(status: .loading, hasData: true), .content)
    }

    func testEmptyStatusIsEmpty() {
        XCTAssertEqual(SuggestedPromptsModel.resolvePhase(status: .empty, hasData: false), .empty)
    }

    func testLoadedWithoutDataIsEmpty() {
        XCTAssertEqual(SuggestedPromptsModel.resolvePhase(status: .loaded, hasData: false), .empty)
    }

    func testLoadedWithDataIsContent() {
        XCTAssertEqual(SuggestedPromptsModel.resolvePhase(status: .loaded, hasData: true), .content)
    }

    func testFailedWithoutDataIsError() {
        XCTAssertEqual(SuggestedPromptsModel.resolvePhase(status: .failed("boom"), hasData: false), .error("boom"))
    }

    func testFailedWithCachedDataStaysContent() {
        XCTAssertEqual(SuggestedPromptsModel.resolvePhase(status: .failed("boom"), hasData: true), .content)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class SuggestedPromptsModelTests: XCTestCase {
    private func makeModel(
        _ update: SuggestedPromptsUpdate,
        telemetry: SuggestedPromptsTelemetry = OSLogSuggestedPromptsTelemetry()
    ) -> (SuggestedPromptsModel, InMemorySuggestedPromptsSource) {
        let source = InMemorySuggestedPromptsSource(initial: update)
        let model = SuggestedPromptsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var contentUpdate: SuggestedPromptsUpdate {
        SuggestedPromptsUpdate(status: .loaded, suggestions: SuggestedPromptsCatalog.defaults)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySuggestedPromptsTelemetry()
        let (model, source) = makeModel(contentUpdate, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.items.count, 4)
        XCTAssertEqual(spy.surfaces, [SuggestedPrompts.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(SuggestedPromptsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.projection.items.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(SuggestedPromptsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(contentUpdate)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.items.count, 4)
    }

    func testEmptyFeedProjectsEmptyPhase() {
        let (model, _) = makeModel(SuggestedPromptsUpdate(status: .empty, suggestions: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(contentUpdate)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(SuggestedPromptsUpdate(
            status: .loaded,
            connection: .stale,
            suggestions: SuggestedPromptsCatalog.defaults
        ))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(SuggestedPromptsUpdate(
            status: .loaded,
            connection: .stale,
            suggestions: SuggestedPromptsCatalog.defaults
        ))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(contentUpdate)
        model.start()
        source.push(SuggestedPromptsUpdate(
            status: .loaded,
            connection: .offline,
            suggestions: SuggestedPromptsCatalog.defaults
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(contentUpdate)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(contentUpdate)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SuggestedPrompts.surfaceSlug, "SuggestedPrompts")
    }
}

// MARK: - Accessibility content

@MainActor final class SuggestedPromptsAccessibilityTests: XCTestCase {
    func testContainerLabelResolvesWebAriaLabel() {
        XCTAssertEqual(SuggestedPromptsAccessibility.containerLabel(), "Suggested prompts")
    }

    func testChipLabelIsTheResolvedText() {
        XCTAssertEqual(
            SuggestedPromptsAccessibility.chipLabel(for: "Charging cost last 30 days"),
            "Charging cost last 30 days"
        )
    }

    func testChipHintIsNonEmpty() {
        XCTAssertFalse(SuggestedPromptsAccessibility.chipHint().isEmpty)
    }
}

// MARK: - Localization facade

@MainActor final class SuggestedPromptsStringsTests: XCTestCase {
    func testStringFallsBackToProvidedValue() {
        XCTAssertEqual(
            SuggestedPromptsStrings.string("chatbot.suggestion.__absent__", "Fallback copy"),
            "Fallback copy"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySuggestedPromptsTelemetry: SuggestedPromptsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
