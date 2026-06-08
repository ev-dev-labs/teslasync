//
//  ChargerTypeBreakdown.Previews.swift
//  TeslaSync — P4 feature view · 0108 · ChargerTypeBreakdown (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. The sample data here is shaped like the web
//  `ChargerTypeData[]` prop + a representative `totalCost`.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative breakdown data for previews/tests (no network). Values are
    /// shaped like the web `ChargerTypeData[]` prop.
    enum ChargerTypeSample {
        static let data: [ChargerTypeDatum] = [
            ChargerTypeDatum(name: "Supercharger", cost: 812.40, energy: 1840, sessions: 142),
            ChargerTypeDatum(name: "Home (Level 2)", cost: 318.10, energy: 2120, sessions: 96),
            ChargerTypeDatum(name: "Public (Level 2)", cost: 121.75, energy: 410, sessions: 31),
            ChargerTypeDatum(name: "CHAdeMO", cost: 44.90, energy: 88, sessions: 7)
        ]

        static let totalCost: Double = 1297.15
    }

    @MainActor
    private func previewModel(_ update: ChargerTypeUpdate) -> ChargerTypeModel {
        let source = InMemoryChargerTypeSource(initial: update)
        let model = ChargerTypeModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewShell(_ surface: ChargerTypeBreakdown) -> some View {
        ScrollView {
            surface.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 920)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewShell(
            ChargerTypeBreakdown(
                model: previewModel(
                    ChargerTypeUpdate(
                        status: .loaded,
                        data: ChargerTypeSample.data,
                        totalCost: ChargerTypeSample.totalCost,
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Empty (loaded, no data)") {
        previewShell(
            ChargerTypeBreakdown(
                model: previewModel(ChargerTypeUpdate(status: .empty, data: [], totalCost: 0, updatedAt: Date()))
            )
        )
    }

    #Preview("Loading") {
        previewShell(
            ChargerTypeBreakdown(model: previewModel(ChargerTypeUpdate(status: .loading)))
        )
    }

    #Preview("Error") {
        previewShell(
            ChargerTypeBreakdown(
                model: previewModel(ChargerTypeUpdate(status: .failed("Network unavailable")))
            )
        )
    }

    #Preview("Stale (cached)") {
        previewShell(
            ChargerTypeBreakdown(
                model: previewModel(
                    ChargerTypeUpdate(
                        status: .loaded,
                        connection: .stale,
                        data: ChargerTypeSample.data,
                        totalCost: ChargerTypeSample.totalCost,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        previewShell(
            ChargerTypeBreakdown(
                model: previewModel(
                    ChargerTypeUpdate(
                        status: .loaded,
                        connection: .offline,
                        data: ChargerTypeSample.data,
                        totalCost: ChargerTypeSample.totalCost,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
