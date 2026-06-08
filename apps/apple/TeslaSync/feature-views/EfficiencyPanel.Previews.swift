//
//  EfficiencyPanel.Previews.swift
//  TeslaSync — P4 feature view · 0102 · EfficiencyPanel (Apple)
//
//  Xcode previews for each surface state (loading / content / empty / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: EfficiencyPanelUpdate) -> EfficiencyPanelModel {
        let source = InMemoryEfficiencyPanelSource(initial: update)
        let model = EfficiencyPanelModel(source: source)
        model.start()
        return model
    }

    private let sampleStats = EfficiencyPanelInput(
        count: 7,
        avgEfficiency: 85.432,
        bestEfficiency: 92.5,
        bestDate: Date(timeIntervalSince1970: 1_777_000_000),
        worstEfficiency: 70.0,
        worstDate: Date(timeIntervalSince1970: 1_776_000_000),
        wallLoss: 3.2,
        totalUsed: 1234.5,
        totalAdded: 1234.5
    )

    #Preview("Loading") {
        EfficiencyPanel(model: previewModel(EfficiencyPanelUpdate(status: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content") {
        EfficiencyPanel(model: previewModel(
            EfficiencyPanelUpdate(status: .loaded, input: sampleStats, connection: .live)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        EfficiencyPanel(model: previewModel(EfficiencyPanelUpdate(status: .empty, input: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        EfficiencyPanel(model: previewModel(
            EfficiencyPanelUpdate(status: .failed("Tesla API returned 503 Service Unavailable"), input: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        EfficiencyPanel(model: previewModel(
            EfficiencyPanelUpdate(status: .loaded, input: sampleStats, connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        EfficiencyPanel(model: previewModel(
            EfficiencyPanelUpdate(status: .loaded, input: sampleStats, connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
