//
//  AIProviderSection.Tests.swift
//  TeslaSync — P4 feature view · 0200 · AIProviderSection (Apple)
//
//  Pure-core coverage for the AIProviderSection surface:
//    • Adapter — provider catalogue, Azure-flavor catalogue + default, the field-
//      visibility layout decisions, the validate-button gating, and the cost-cap
//      cents↔dollars round-trip ported from the web controlled form.
//    • Validate — the request builder (cloud full / local minimal; api_key omission),
//      the wire payload key set per mode, and the banner-text mapping.
//    • Projection — loading / empty / error / data across the P4 leaf contract.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US_POSIX")

// MARK: - Provider catalogue

@MainActor final class AiProviderCatalogTests: XCTestCase {
    func testCloudOptionsOrderAndValues() {
        XCTAssertEqual(
            AiProviderCatalog.options(isCloud: true).map(\.value),
            ["openai", "anthropic", "azure", "google"]
        )
    }

    func testLocalOptionsOrderAndValues() {
        XCTAssertEqual(AiProviderCatalog.options(isCloud: false).map(\.value), ["ollama", "lmstudio", "llama-cpp"])
    }

    func testBrandTitlesAreVerbatimProperNouns() {
        XCTAssertEqual(AiProviderCatalog.cloud.first?.title, "OpenAI")
        XCTAssertEqual(AiProviderCatalog.local.last?.title, "llama.cpp")
    }
}

// MARK: - Azure flavor catalogue

@MainActor final class AiAzureFlavorTests: XCTestCase {
    func testEffectiveDefaultsToOpenAI() {
        XCTAssertEqual(AiAzureFlavor.effective(""), "openai")
        XCTAssertEqual(AiAzureFlavor.effective("foundry"), "foundry")
        XCTAssertEqual(AiAzureFlavor.effective("openai"), "openai")
    }

    func testOptionsOrderKeysAndFallbacks() {
        XCTAssertEqual(AiAzureFlavor.options.map(\.value), ["openai", "foundry"])
        XCTAssertEqual(AiAzureFlavor.options.first?.labelKey, "ai.settings.provider.azureFlavor.openai")
        XCTAssertEqual(AiAzureFlavor.options.first?.labelFallback, "Azure OpenAI Service (gpt-4o, gpt-4-turbo, …)")
        XCTAssertEqual(AiAzureFlavor.options.last?.labelFallback, "Azure AI Foundry / Inference (multi-vendor)")
    }
}

// MARK: - Field-visibility layout (web conditional-render guards)

@MainActor final class AiProviderLayoutTests: XCTestCase {
    func testModelUsesAzureIdentifierOnlyForAzureNonFoundry() {
        XCTAssertTrue(AiProviderLayout.modelUsesAzureIdentifier(provider: "azure", flavor: "openai"))
        XCTAssertTrue(AiProviderLayout.modelUsesAzureIdentifier(provider: "azure", flavor: ""))
        XCTAssertFalse(AiProviderLayout.modelUsesAzureIdentifier(provider: "azure", flavor: "foundry"))
        XCTAssertFalse(AiProviderLayout.modelUsesAzureIdentifier(provider: "openai", flavor: "openai"))
    }

    func testAzureBlockGating() {
        XCTAssertTrue(AiProviderLayout.showsAzureBlock(isCloud: true, provider: "azure"))
        XCTAssertFalse(AiProviderLayout.showsAzureBlock(isCloud: false, provider: "azure"))
        XCTAssertFalse(AiProviderLayout.showsAzureBlock(isCloud: true, provider: "openai"))
    }

    func testAzureDeploymentsHiddenForFoundry() {
        XCTAssertTrue(AiProviderLayout.showsAzureDeployments(flavor: "openai"))
        XCTAssertTrue(AiProviderLayout.showsAzureDeployments(flavor: ""))
        XCTAssertFalse(AiProviderLayout.showsAzureDeployments(flavor: "foundry"))
    }

    func testBaseURLAndCloudFieldGating() {
        XCTAssertTrue(AiProviderLayout.showsLocalBaseURL(isCloud: false))
        XCTAssertFalse(AiProviderLayout.showsLocalBaseURL(isCloud: true))
        XCTAssertTrue(AiProviderLayout.showsAzureBaseURL(isCloud: true, provider: "azure"))
        XCTAssertFalse(AiProviderLayout.showsAzureBaseURL(isCloud: true, provider: "openai"))
        XCTAssertTrue(AiProviderLayout.showsCloudFields(isCloud: true))
        XCTAssertTrue(AiProviderLayout.showsLocalExplainer(isCloud: false))
    }

    func testFieldPrompts() {
        XCTAssertEqual(AiProviderLayout.modelPrompt(isCloud: true), "gpt-4o-mini")
        XCTAssertEqual(AiProviderLayout.modelPrompt(isCloud: false), "llama3.1:8b")
        XCTAssertEqual(AiProviderLayout.azureDeploymentPrompt(model: ""), "gpt-4o-mini")
        XCTAssertEqual(AiProviderLayout.azureDeploymentPrompt(model: "gpt-4o"), "gpt-4o")
        XCTAssertEqual(AiProviderLayout.azureEmbeddingPrompt(embeddingModel: ""), "text-embedding-3-small")
    }
}

// MARK: - Validate-button gating

@MainActor final class AiProviderValidateGateTests: XCTestCase {
    func testLocalDisabledWhileValidatingOrBlankURL() {
        XCTAssertTrue(AiProviderValidateGate.localDisabled(isValidating: true, baseURL: "http://x"))
        XCTAssertTrue(AiProviderValidateGate.localDisabled(isValidating: false, baseURL: ""))
        XCTAssertTrue(AiProviderValidateGate.localDisabled(isValidating: false, baseURL: "   "))
        XCTAssertFalse(AiProviderValidateGate.localDisabled(isValidating: false, baseURL: "http://localhost:11434"))
    }

    func testCloudDisabledOnlyWhileValidating() {
        XCTAssertTrue(AiProviderValidateGate.cloudDisabled(isValidating: true))
        XCTAssertFalse(AiProviderValidateGate.cloudDisabled(isValidating: false))
    }
}

// MARK: - Cost-cap field conversion

@MainActor final class AiCostCapFieldTests: XCTestCase {
    func testDisplayBlankWhenZeroElseDollars() {
        XCTAssertEqual(AiCostCapField.display(cents: 0, locale: enUS), "")
        XCTAssertEqual(AiCostCapField.display(cents: 500, locale: enUS), "5.00")
        XCTAssertEqual(AiCostCapField.display(cents: 1234, locale: enUS), "12.34")
    }

    func testCentsFromDollarsRoundsAndClamps() {
        XCTAssertEqual(AiCostCapField.cents(fromDollars: "5.00"), 500)
        XCTAssertEqual(AiCostCapField.cents(fromDollars: "12.349"), 1235)
        XCTAssertEqual(AiCostCapField.cents(fromDollars: "-3"), 0)
    }

    func testCentsFromDollarsHandlesEmptyAndJunk() {
        XCTAssertEqual(AiCostCapField.cents(fromDollars: ""), 0)
        XCTAssertEqual(AiCostCapField.cents(fromDollars: "abc"), 0)
        XCTAssertEqual(AiCostCapField.cents(fromDollars: "5.00 USD"), 500)
    }
}

// MARK: - Validate request builder + payload

@MainActor final class AiProviderValidateRequestTests: XCTestCase {
    private func cloudDraft(apiKey: String) -> AiProviderDraft {
        AiProviderDraft(
            provider: "azure",
            baseURL: "https://r.openai.azure.com",
            model: "gpt-4o-mini",
            apiKey: apiKey,
            apiVersion: "2024-10-21",
            flavor: "openai",
            deployment: "prod",
            embeddingModel: "text-embedding-3-small",
            embeddingDeployment: "emb"
        )
    }

    func testLocalBuildSendsOnlyModeProviderBaseURL() {
        let draft = AiProviderDraft(provider: "ollama", baseURL: "http://localhost:11434", apiKey: "ignored")
        let request = AiProviderValidateRequest.build(isCloud: false, draft: draft)
        XCTAssertEqual(request.mode, .local)
        XCTAssertNil(request.apiKey)
        XCTAssertEqual(request.payload().map(\.key), ["mode", "provider", "base_url"])
    }

    func testCloudBuildOmitsBlankAPIKey() {
        let request = AiProviderValidateRequest.build(isCloud: true, draft: cloudDraft(apiKey: "   "))
        XCTAssertEqual(request.mode, .cloud)
        XCTAssertNil(request.apiKey)
        XCTAssertFalse(request.payload().map(\.key).contains("api_key"))
    }

    func testCloudBuildIncludesProvidedAPIKeyAndFullPayload() {
        let request = AiProviderValidateRequest.build(isCloud: true, draft: cloudDraft(apiKey: "sk-live"))
        XCTAssertEqual(request.apiKey, "sk-live")
        XCTAssertEqual(request.payload().map(\.key), [
            "mode", "provider", "base_url", "api_key", "model",
            "api_version", "flavor", "deployment", "embedding_model", "embedding_deployment"
        ])
    }
}

// MARK: - Validate banner factory

@MainActor final class AiProviderValidateBannerTests: XCTestCase {
    private let passthrough: AiProviderValidateBannerFactory.Localizer = { _, fallback in fallback }

    func testPinnedTakesPrecedenceOverProbed() {
        let banner = AiProviderValidateBannerFactory.make(
            from: .ok(pinnedIP: "10.0.0.4", probedModel: "gpt-4o"),
            localize: passthrough
        )
        XCTAssertEqual(banner.kind, .ok)
        XCTAssertEqual(banner.message, "OK — pinned to 10.0.0.4")
    }

    func testProbedWhenNoPinnedIP() {
        let banner = AiProviderValidateBannerFactory.make(
            from: .ok(pinnedIP: nil, probedModel: "gpt-4o"),
            localize: passthrough
        )
        XCTAssertEqual(banner.message, "OK — gpt-4o reachable")
    }

    func testGenericWhenNeitherPresent() {
        let empty = AiProviderValidateBannerFactory.make(
            from: .ok(pinnedIP: "", probedModel: ""),
            localize: passthrough
        )
        XCTAssertEqual(empty.message, "OK — provider reachable")
    }

    func testFailurePassesMessageThrough() {
        let banner = AiProviderValidateBannerFactory.make(from: .failure(message: "bad url"), localize: passthrough)
        XCTAssertEqual(banner.kind, .fail)
        XCTAssertEqual(banner.message, "bad url")
    }
}

// MARK: - Projection (P4 leaf contract)

@MainActor final class AiProviderProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = AiProviderProjection.resolve(
            AiProviderInput(savedDraft: .empty, isLoading: true, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        XCTAssertEqual(AiProviderProjection.resolve(AiProviderInput(isLoading: true)).phase, .loading)
    }

    func testEmptyWhenResolvedWithoutPayload() {
        XCTAssertEqual(AiProviderProjection.resolve(AiProviderInput(savedDraft: nil)).phase, .empty)
    }

    func testDataCarriesDraftAndCloudFlag() {
        let draft = AiProviderDraft(provider: "openai", model: "gpt-4o-mini")
        let resolved = AiProviderProjection.resolve(AiProviderInput(savedDraft: draft, isCloud: true))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.draft, draft)
        XCTAssertTrue(resolved.isCloud)
    }
}
