//
//  SourceLayerBadge.Previews.swift
//  TeslaSync — P4 shared surface · 0105 · SourceLayerBadge (Apple)
//
//  Xcode previews for each surface state (loading / unavailable / l1 / l2 / log / stale / empty /
//  offline) plus the showLabel variant. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: SourceLayerBadgeInput,
        config: SourceLayerBadgeConfig = .default
    ) -> SourceLayerBadgeModel {
        let source = InMemorySourceLayerBadgeSource(initial: input)
        let model = SourceLayerBadgeModel(source: source, config: config)
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: SourceLayerBadgeModel) -> some View {
        SourceLayerBadge(model: model)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        staged(previewModel(SourceLayerBadgeInput(status: .loading)))
    }

    #Preview("Unavailable") {
        staged(previewModel(SourceLayerBadgeInput(status: .failed)))
    }

    #Preview("L1 (in-process)") {
        staged(previewModel(SourceLayerBadgeInput(status: .resolved, source: "l1", ageMs: 350)))
    }

    #Preview("L2 (Redis), labelled") {
        staged(previewModel(
            SourceLayerBadgeInput(status: .resolved, source: "l2", ageMs: 4200),
            config: SourceLayerBadgeConfig(showLabel: true)
        ))
    }

    #Preview("LOG (replay)") {
        staged(previewModel(SourceLayerBadgeInput(status: .resolved, source: "log", ageMs: 7_200_000)))
    }

    #Preview("STALE") {
        staged(previewModel(SourceLayerBadgeInput(status: .resolved, source: "stale", ageMs: 185_000)))
    }

    #Preview("Empty (unknown)") {
        staged(previewModel(SourceLayerBadgeInput(status: .resolved, source: nil)))
    }

    #Preview("Offline (cached L1)") {
        staged(previewModel(SourceLayerBadgeInput(status: .resolved, source: "l1", ageMs: 950, offline: true)))
    }
#endif
