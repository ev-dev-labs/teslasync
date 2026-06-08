//
//  AISettings.Previews.swift
//  TeslaSync — P4 feature view · 0202 · AISettings (Apple)
//
//  Xcode previews for each surface state (data: off / local / cloud cost-cap ok /
//  warn / critical, plus loading / empty / error / stale / offline / saving).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AiSettingsPreviewData {
        /// $5.00 daily cap (500 cents → 5_000_000 micro-cents).
        static let capCents = 500

        static func cloud(todayMicroCents: Double) -> AiSettingsInput {
            AiSettingsInput(
                savedMode: .cloud,
                costCapCents: capCents,
                todayMicroCents: todayMicroCents,
                connection: .live
            )
        }
    }

    @MainActor
    private func previewModel(
        _ input: AiSettingsInput,
        saveOutcome: AiSaveOutcome? = nil
    ) -> AiSettingsModel {
        let source = InMemoryAiSettingsSource(initial: input, saveOutcome: saveOutcome)
        let model = AiSettingsModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func savingModel() -> AiSettingsModel {
        // No auto-response: the model stays in `.saving` so the button shows the spinner.
        let source = InMemoryAiSettingsSource(initial: AiSettingsInput(savedMode: .local))
        let model = AiSettingsModel(source: source)
        model.start()
        model.selectMode(.cloud)
        model.save()
        return model
    }

    #Preview("Data · Off") {
        AISettings(model: previewModel(AiSettingsInput(savedMode: .off)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data · Local") {
        AISettings(model: previewModel(AiSettingsInput(savedMode: .local)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Cost cap · OK") {
        AISettings(model: previewModel(AiSettingsPreviewData.cloud(todayMicroCents: 2_000_000)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Cost cap · Warn") {
        AISettings(model: previewModel(AiSettingsPreviewData.cloud(todayMicroCents: 4_500_000)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Cost cap · Critical") {
        AISettings(model: previewModel(AiSettingsPreviewData.cloud(todayMicroCents: 5_500_000)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Saving") {
        AISettings(model: savingModel())
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AISettings(model: previewModel(AiSettingsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        AISettings(model: previewModel(AiSettingsInput(savedMode: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AISettings(model: previewModel(AiSettingsInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AISettings(model: previewModel(AiSettingsInput(savedMode: .cloud, costCapCents: 500, connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AISettings(model: previewModel(AiSettingsInput(savedMode: .local, connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }
#endif
