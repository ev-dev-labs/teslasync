//
//  AIProviderSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0200 · AIProviderSection (Apple)
//
//  State-holder coverage for the AIProviderSection surface:
//    • Wiring — the P1/S11 `view.opened` telemetry (emitted once), the one-shot draft
//      hydration that preserves user edits, and the loading → data transition.
//    • Editing — `patch` / field bindings clear the validate banner and commit
//      upstream (web `onChange`); the cost-cap + Azure-flavor derived bindings.
//    • Validate — request construction (cloud vs local), the success/failure banner,
//      the edit-clears-banner behaviour, and the in-flight re-entrancy guard.
//    • Freshness — the stale one-shot auto-refresh, offline (no refresh), manual
//      refresh, and stop/start re-arm — plus the a11y status summary + slug.
//
//  Driven by `InMemoryAiProviderSource` (+ a gated source for the async guard); no
//  network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Wiring: telemetry, hydration, transitions

@MainActor final class AiProviderModelWiringTests: XCTestCase {
    private func makeModel(
        _ input: AiProviderInput,
        validateResult: AiProviderValidateResult = .ok(pinnedIP: nil, probedModel: nil),
        telemetry: AiProviderTelemetry = OSLogAiProviderTelemetry()
    ) -> (AiProviderModel, InMemoryAiProviderSource) {
        let source = InMemoryAiProviderSource(initial: input, validateResult: validateResult)
        let model = AiProviderModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyAiProviderTelemetry()
        let (model, source) = makeModel(AiProviderInput(savedDraft: .empty, isCloud: true), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(spy.surfaces, [AIProviderSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testHydratesDraftFromSavedWithoutEchoingCommit() {
        let saved = AiProviderDraft(provider: "openai", model: "gpt-4o-mini")
        let (model, source) = makeModel(AiProviderInput(savedDraft: saved, isCloud: true))
        model.start()
        XCTAssertEqual(model.draft, saved)
        XCTAssertEqual(source.commitCount, 0)
    }

    func testHydrationIsOneShotAndPreservesUserDraft() {
        let (model, source) = makeModel(AiProviderInput(savedDraft: AiProviderDraft(provider: "openai"), isCloud: true))
        model.start()
        model.patch { $0.model = "edited" }
        source.push(AiProviderInput(savedDraft: AiProviderDraft(provider: "anthropic"), isCloud: true))
        XCTAssertEqual(model.draft.model, "edited")
        XCTAssertEqual(model.draft.provider, "openai")
    }

    func testLoadingThenDataHydrates() {
        let (model, source) = makeModel(AiProviderInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AiProviderInput(savedDraft: AiProviderDraft(provider: "ollama"), isCloud: false))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.draft.provider, "ollama")
    }

    func testIsCloudAndProviderOptionsTrackInput() {
        let (model, source) = makeModel(AiProviderInput(savedDraft: .empty, isCloud: false))
        model.start()
        XCTAssertFalse(model.isCloud)
        XCTAssertEqual(model.providerOptions.map(\.value), ["ollama", "lmstudio", "llama-cpp"])
        source.push(AiProviderInput(savedDraft: .empty, isCloud: true))
        XCTAssertTrue(model.isCloud)
        XCTAssertEqual(model.providerOptions.first?.value, "openai")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AIProviderSection.surfaceSlug, "AIProviderSection")
    }
}

// MARK: - Editing: patch, commit, derived bindings, field visibility

@MainActor final class AiProviderModelEditingTests: XCTestCase {
    private func started(
        _ input: AiProviderInput,
        validateResult: AiProviderValidateResult = .ok(pinnedIP: nil, probedModel: nil)
    ) -> (AiProviderModel, InMemoryAiProviderSource) {
        let source = InMemoryAiProviderSource(initial: input, validateResult: validateResult)
        let model = AiProviderModel(source: source)
        model.start()
        return (model, source)
    }

    func testPatchCommitsUpstream() {
        let (model, source) = started(AiProviderInput(savedDraft: AiProviderDraft(provider: "openai"), isCloud: true))
        model.patch { $0.model = "gpt-4o" }
        XCTAssertEqual(source.commitCount, 1)
        XCTAssertEqual(source.lastCommittedDraft?.model, "gpt-4o")
    }

    func testCostCapTextRoundTrip() {
        let (model, _) = started(AiProviderInput(savedDraft: .empty, isCloud: true))
        model.costCapText = "5.00"
        XCTAssertEqual(model.draft.costCapCents, 500)
        XCTAssertEqual(model.costCapText, "5.00")
        model.costCapText = ""
        XCTAssertEqual(model.draft.costCapCents, 0)
    }

    func testAzureFlavorDerivedBinding() {
        let (model, _) = started(AiProviderInput(savedDraft: AiProviderDraft(provider: "azure"), isCloud: true))
        XCTAssertEqual(model.azureFlavor, "openai")
        model.azureFlavor = "foundry"
        XCTAssertEqual(model.draft.flavor, "foundry")
        XCTAssertEqual(model.azureFlavor, "foundry")
    }

    func testAzureFieldVisibilityFollowsDraft() {
        let (model, _) = started(AiProviderInput(savedDraft: AiProviderDraft(provider: "azure"), isCloud: true))
        XCTAssertTrue(model.showsAzureBlock)
        XCTAssertTrue(model.showsAzureDeployments)
        XCTAssertTrue(model.modelUsesAzureIdentifier)
        model.azureFlavor = "foundry"
        XCTAssertFalse(model.showsAzureDeployments)
        XCTAssertFalse(model.modelUsesAzureIdentifier)
    }
}

// MARK: - Validate: request, banner, clearing, re-entrancy

@MainActor final class AiProviderModelValidateTests: XCTestCase {
    func testCloudValidateBuildsCloudRequestAndProbedBanner() async {
        let saved = AiProviderDraft(provider: "openai", apiKey: "sk-x")
        let source = InMemoryAiProviderSource(
            initial: AiProviderInput(savedDraft: saved, isCloud: true),
            validateResult: .ok(pinnedIP: nil, probedModel: "gpt-4o")
        )
        let model = AiProviderModel(source: source)
        model.start()
        await model.runValidate()
        XCTAssertEqual(source.validateCount, 1)
        XCTAssertEqual(source.lastValidateRequest?.mode, .cloud)
        XCTAssertEqual(source.lastValidateRequest?.apiKey, "sk-x")
        XCTAssertEqual(model.banner?.kind, .ok)
        XCTAssertEqual(model.banner?.message, "OK — gpt-4o reachable")
        XCTAssertFalse(model.isValidating)
    }

    func testLocalValidateBuildsLocalRequestAndPinnedBanner() async {
        let saved = AiProviderDraft(provider: "ollama", baseURL: "http://localhost:11434")
        let source = InMemoryAiProviderSource(
            initial: AiProviderInput(savedDraft: saved, isCloud: false),
            validateResult: .ok(pinnedIP: "10.0.0.4", probedModel: nil)
        )
        let model = AiProviderModel(source: source)
        model.start()
        await model.runValidate()
        XCTAssertEqual(source.lastValidateRequest?.mode, .local)
        XCTAssertNil(source.lastValidateRequest?.apiKey)
        XCTAssertEqual(model.banner?.message, "OK — pinned to 10.0.0.4")
    }

    func testValidateFailureBanner() async {
        let source = InMemoryAiProviderSource(
            initial: AiProviderInput(savedDraft: .empty, isCloud: true),
            validateResult: .failure(message: "base URL resolved to a public address")
        )
        let model = AiProviderModel(source: source)
        model.start()
        await model.runValidate()
        XCTAssertEqual(model.banner?.kind, .fail)
        XCTAssertEqual(model.banner?.message, "base URL resolved to a public address")
    }

    func testEditingClearsBanner() async {
        let source = InMemoryAiProviderSource(
            initial: AiProviderInput(savedDraft: AiProviderDraft(provider: "ollama"), isCloud: false),
            validateResult: .ok(pinnedIP: "10.0.0.4", probedModel: nil)
        )
        let model = AiProviderModel(source: source)
        model.start()
        await model.runValidate()
        XCTAssertNotNil(model.banner)
        model.patch { $0.baseURL = "http://localhost:1234" }
        XCTAssertNil(model.banner)
    }

    func testValidateReentrancyGuarded() async {
        let source = GatedValidateSource(initial: AiProviderInput(savedDraft: .empty, isCloud: true))
        let model = AiProviderModel(source: source)
        model.start()
        let first = Task { await model.runValidate() }
        await Task.yield()
        XCTAssertTrue(model.isValidating)
        await model.runValidate()
        XCTAssertEqual(source.validateCount, 1)
        source.complete()
        await first.value
        XCTAssertFalse(model.isValidating)
        XCTAssertEqual(source.validateCount, 1)
    }
}

// MARK: - Freshness + a11y

@MainActor final class AiProviderModelFreshnessTests: XCTestCase {
    private func started(_ input: AiProviderInput) -> (AiProviderModel, InMemoryAiProviderSource) {
        let source = InMemoryAiProviderSource(initial: input)
        let model = AiProviderModel(source: source)
        model.start()
        return (model, source)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = started(AiProviderInput(savedDraft: .empty, isCloud: true))
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)
        source.push(AiProviderInput(savedDraft: .empty, isCloud: true, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(AiProviderInput(savedDraft: .empty, isCloud: true, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = started(AiProviderInput(savedDraft: .empty, isCloud: true))
        source.push(AiProviderInput(savedDraft: .empty, isCloud: true, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshAndStopRearm() {
        let (model, source) = started(AiProviderInput(savedDraft: .empty, isCloud: false))
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testValidateStatusAccessibility() {
        let actual = AiProviderAccessibility.validateStatus(
            format: "Validation status: %@",
            message: "OK — provider reachable"
        )
        XCTAssertEqual(actual, "Validation status: OK — provider reachable")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAiProviderTelemetry: AiProviderTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// A source whose `validate` suspends until `complete()` so the in-flight re-entrancy
/// guard can be exercised deterministically.
@MainActor
private final class GatedValidateSource: AiProviderSource {
    var onUpdate: (@MainActor (AiProviderInput) -> Void)?
    private(set) var validateCount = 0

    private let initial: AiProviderInput?
    private let result: AiProviderValidateResult
    private var continuation: CheckedContinuation<AiProviderValidateResult, Never>?

    init(initial: AiProviderInput?, result: AiProviderValidateResult = .ok(pinnedIP: nil, probedModel: nil)) {
        self.initial = initial
        self.result = result
    }

    func start() {
        if let initial { onUpdate?(initial) }
    }

    func stop() {}
    func refresh() {}
    func commitDraft(_: AiProviderDraft) {}

    func validate(_: AiProviderValidateRequest) async -> AiProviderValidateResult {
        validateCount += 1
        return await withCheckedContinuation { continuation = $0 }
    }

    func complete() {
        continuation?.resume(returning: result)
        continuation = nil
    }
}
