//
//  AIProviderSection.Previews.swift
//  TeslaSync — P4 feature view · 0200 · AIProviderSection (Apple)
//
//  Xcode previews for each surface state (data: local / cloud OpenAI / cloud Azure
//  OpenAI Service / cloud Azure Foundry / validated ok / validated fail, plus loading
//  / empty / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AiProviderPreviewData {
        static func local(provider: String = "ollama") -> AiProviderInput {
            AiProviderInput(
                savedDraft: AiProviderDraft(
                    provider: provider,
                    baseURL: "http://localhost:11434",
                    model: "llama3.1:8b"
                ),
                isCloud: false
            )
        }

        static func cloud(provider: String = "openai", flavor: String = "") -> AiProviderInput {
            AiProviderInput(
                savedDraft: AiProviderDraft(
                    provider: provider,
                    baseURL: provider == "azure" ? "https://my-resource.openai.azure.com" : "",
                    model: "gpt-4o-mini",
                    costCapCents: 500,
                    apiVersion: "2024-10-21",
                    flavor: flavor,
                    deployment: "gpt-4o-mini-prod"
                ),
                isCloud: true
            )
        }
    }

    @MainActor
    private func previewModel(
        _ input: AiProviderInput,
        validateResult: AiProviderValidateResult = .ok(pinnedIP: nil, probedModel: nil)
    ) -> AiProviderModel {
        let source = InMemoryAiProviderSource(initial: input, validateResult: validateResult)
        let model = AiProviderModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func validatedModel(_ result: AiProviderValidateResult) -> AiProviderModel {
        let model = previewModel(AiProviderPreviewData.local(), validateResult: result)
        Task { await model.runValidate() }
        return model
    }

    #Preview("Data · Local") {
        AIProviderSection(model: previewModel(AiProviderPreviewData.local()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data · Cloud OpenAI") {
        AIProviderSection(model: previewModel(AiProviderPreviewData.cloud()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data · Azure OpenAI Service") {
        AIProviderSection(model: previewModel(AiProviderPreviewData.cloud(provider: "azure", flavor: "openai")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data · Azure Foundry") {
        AIProviderSection(model: previewModel(AiProviderPreviewData.cloud(provider: "azure", flavor: "foundry")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Validated · OK pinned") {
        AIProviderSection(model: validatedModel(.ok(pinnedIP: "10.0.0.4", probedModel: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Validated · Fail") {
        AIProviderSection(model: validatedModel(.failure(message: "base URL resolved to a public address")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIProviderSection(model: previewModel(AiProviderInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        AIProviderSection(model: previewModel(AiProviderInput(savedDraft: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AIProviderSection(model: previewModel(AiProviderInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIProviderSection(model: previewModel(AiProviderPreviewData.cloud().with(connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIProviderSection(model: previewModel(AiProviderPreviewData.local().with(connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }

    private extension AiProviderInput {
        func with(connection: AiProviderConnection) -> AiProviderInput {
            var copy = self
            copy.connection = connection
            return copy
        }
    }
#endif
