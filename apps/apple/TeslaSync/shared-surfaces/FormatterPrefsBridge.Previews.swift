//
//  FormatterPrefsBridge.Previews.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  Xcode previews for each surface state (loading / unavailable / device-defaults / applied (explicit
//  locale + precision) / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. Previews inject an isolated formatter-globals store (so authoring never
//  mutates the live globals) and the no-op broadcast (so no settings-changed refetch fires).
//

import Foundation
import SwiftUI

#if DEBUG
    private enum FormatterPrefsBridgePreviewData {
        static let explicit = FormatterPrefsBridgeSettings(locale: "de-DE", decimalPrecision: 3)
        static let defaults = FormatterPrefsBridgeSettings(locale: nil, decimalPrecision: nil)
    }

    @MainActor
    private func previewModel(_ input: FormatterPrefsBridgeInput) -> FormatterPrefsBridgeModel {
        let source = InMemoryFormatterPrefsBridgeSource(initial: input)
        let model = FormatterPrefsBridgeModel(
            source: source,
            applier: FormatterPrefsBridgeGlobalsApplier(store: FormatterPrefsBridgeStore()),
            broadcast: NoopFormatterPrefsBridgeBroadcast(),
            telemetry: OSLogFormatterPrefsBridgeTelemetry()
        )
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: FormatterPrefsBridgeModel) -> some View {
        FormatterPrefsBridge(model: model)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        staged(previewModel(FormatterPrefsBridgeInput(status: .loading)))
    }

    #Preview("Unavailable") {
        staged(previewModel(FormatterPrefsBridgeInput(status: .failed)))
    }

    #Preview("Using defaults") {
        staged(previewModel(FormatterPrefsBridgeInput(
            status: .resolved,
            settings: FormatterPrefsBridgePreviewData.defaults
        )))
    }

    #Preview("Applied") {
        staged(previewModel(FormatterPrefsBridgeInput(
            status: .resolved,
            settings: FormatterPrefsBridgePreviewData.explicit
        )))
    }

    #Preview("Stale") {
        staged(previewModel(FormatterPrefsBridgeInput(
            status: .resolved,
            settings: FormatterPrefsBridgePreviewData.explicit,
            connection: .stale
        )))
    }

    #Preview("Offline (cached)") {
        staged(previewModel(FormatterPrefsBridgeInput(
            status: .resolved,
            settings: FormatterPrefsBridgePreviewData.explicit,
            connection: .offline
        )))
    }
#endif
