//
//  AIPiiRedactionSharedExports.Previews.swift
//  TeslaSync — P4 shared surface · 0038 · AIPiiRedactionSharedExports (Apple)
//
//  Xcode previews for each surface state (idle invite / export-type chosen / streaming /
//  streamed narrative / stream-error / gate-loading / gate-error / stale / offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope. The gated-off
//  state renders nothing (web `withAiFeature` null) and is asserted in the tests instead.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: PiiRedactionExportsInputSnapshot,
        selectedType: PiiRedactionExportType? = nil,
        configure: ((PiiRedactionExportsModel, InMemoryPiiRedactionExportsSource) -> Void)? = nil
    ) -> PiiRedactionExportsModel {
        let source = InMemoryPiiRedactionExportsSource(initial: input)
        let model = PiiRedactionExportsModel(source: source)
        model.selectedType = selectedType
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = PiiRedactionExportsInputSnapshot(gate: .on)
    private let sampleNarrative = [
        "Recommended PII redactions for a drives export:\n",
        "• Highly recommended: precise GPS coordinates, home/work geofence labels\n",
        "• Optional (needs consent): vehicle VIN, raw odometer readings\n",
        "Toggle the matching options in your export request to apply."
    ]

    #Preview("Idle / invite") {
        AIPiiRedactionSharedExports(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / export type chosen") {
        AIPiiRedactionSharedExports(model: previewModel(readyInput, selectedType: .drives))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty / no export type") {
        AIPiiRedactionSharedExports(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AIPiiRedactionSharedExports(model: previewModel(readyInput, selectedType: .charging) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Streamed narrative") {
        AIPiiRedactionSharedExports(model: previewModel(readyInput, selectedType: .analytics) { _, source in
            source.pushNarrative(sampleNarrative)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AIPiiRedactionSharedExports(model: previewModel(readyInput, selectedType: .trips) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AIPiiRedactionSharedExports(model: previewModel(
            PiiRedactionExportsInputSnapshot(gate: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIPiiRedactionSharedExports(model: previewModel(
            PiiRedactionExportsInputSnapshot(gate: .loading, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIPiiRedactionSharedExports(model: previewModel(
            PiiRedactionExportsInputSnapshot(gate: .on, connection: .stale),
            selectedType: .backup
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIPiiRedactionSharedExports(model: previewModel(
            PiiRedactionExportsInputSnapshot(gate: .on, connection: .offline),
            selectedType: .account
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
