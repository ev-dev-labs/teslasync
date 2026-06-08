//
//  ChartsRow.Previews.swift
//  TeslaSync — P4 feature view · 0099 · ChartsRow (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope. The sample data here is shaped like the web ChartsRow props
//  (energyTrend / chargerBreakdown / costByType).
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative ChartsRow data for previews (no network). Values are shaped like
    /// the web props produced by charging-list/helpers.ts.
    enum ChartsRowSample {
        static let data = ChartsRowData(
            energyTrend: [
                ChartsRowEnergyPoint(date: "Jan", energy: 312, cost: 41.2),
                ChartsRowEnergyPoint(date: "Feb", energy: 288, cost: 37.9),
                ChartsRowEnergyPoint(date: "Mar", energy: 401, cost: 52.4),
                ChartsRowEnergyPoint(date: "Apr", energy: 356, cost: 47.1),
                ChartsRowEnergyPoint(date: "May", energy: 422, cost: 55.0),
                ChartsRowEnergyPoint(date: "Jun", energy: 389, cost: 50.3)
            ],
            chargerBreakdown: [
                ChartsRowBreakdownSlice(label: "Supercharger", value: 18, tone: .danger),
                ChartsRowBreakdownSlice(label: "DC Fast", value: 9, tone: .warning),
                ChartsRowBreakdownSlice(label: "Home / AC", value: 31, tone: .success)
            ],
            costByType: [
                ChartsRowCostRow(label: "Home / AC", energy: 412.5, cost: 58.4, perKwh: 0.14),
                ChartsRowCostRow(label: "Supercharger", energy: 286.1, cost: 92.3, perKwh: 0.32),
                ChartsRowCostRow(label: "DC Fast", energy: 121.0, cost: 39.7, perKwh: 0.33)
            ]
        )
    }

    @MainActor
    private func previewModel(_ update: ChartsRowUpdate) -> ChartsRowModel {
        let source = InMemoryChartsRowSource(initial: update)
        let model = ChartsRowModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewShell(_ surface: ChartsRow) -> some View {
        ScrollView {
            surface.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 980)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewShell(
            ChartsRow(
                model: previewModel(
                    ChartsRowUpdate(status: .loaded, data: ChartsRowSample.data, updatedAt: Date())
                )
            )
        )
    }

    #Preview("Empty (loaded, no data)") {
        previewShell(
            ChartsRow(
                model: previewModel(
                    ChartsRowUpdate(status: .empty, data: ChartsRowData(), updatedAt: Date())
                )
            )
        )
    }

    #Preview("Loading") {
        previewShell(ChartsRow(model: previewModel(ChartsRowUpdate(status: .loading))))
    }

    #Preview("Error") {
        previewShell(
            ChartsRow(model: previewModel(ChartsRowUpdate(status: .failed("Network unavailable"))))
        )
    }

    #Preview("Stale (cached)") {
        previewShell(
            ChartsRow(
                model: previewModel(
                    ChartsRowUpdate(
                        status: .loaded,
                        connection: .stale,
                        data: ChartsRowSample.data,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        previewShell(
            ChartsRow(
                model: previewModel(
                    ChartsRowUpdate(
                        status: .loaded,
                        connection: .offline,
                        data: ChartsRowSample.data,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
