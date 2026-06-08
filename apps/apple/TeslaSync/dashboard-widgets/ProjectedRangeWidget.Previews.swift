//
//  ProjectedRangeWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0074 · ProjectedRangeWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  stale / compact / standard / wide). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ProjectedRangeUpdate) -> ProjectedRangeModel {
        let source = InMemoryProjectedRangeSource(initial: update)
        let model = ProjectedRangeModel(source: source)
        model.start()
        return model
    }

    private let previewData = ProjectedRangeInput(
        currentRangeKm: 412,
        newRangeKm: 505,
        degradationPct: 7.4,
        totalCycles: 312,
        healthScore: 92,
        currentCapacityPct: 92.6,
        avgDailyKm: 48
    )

    private let fairData = ProjectedRangeInput(
        currentRangeKm: 286,
        newRangeKm: 505,
        degradationPct: 18.2,
        totalCycles: 884,
        healthScore: 64,
        currentCapacityPct: 81.8,
        avgDailyKm: 53
    )

    #Preview("Standard (2×2)") {
        ProjectedRangeWidget(
            model: previewModel(
                ProjectedRangeUpdate(status: .loaded, connection: .live, data: previewData, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (3×2)") {
        ProjectedRangeWidget(
            model: previewModel(
                ProjectedRangeUpdate(status: .loaded, connection: .live, data: previewData, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 3, rows: 2),
            onOpen: {}
        )
        .frame(width: 380, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        ProjectedRangeWidget(
            model: previewModel(
                ProjectedRangeUpdate(status: .loaded, connection: .live, data: fairData)
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Imperial units") {
        ProjectedRangeWidget(
            model: previewModel(
                ProjectedRangeUpdate(status: .loaded, data: previewData, units: .imperial, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 3, rows: 2)
        )
        .frame(width: 380, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ProjectedRangeWidget(model: previewModel(ProjectedRangeUpdate(status: .loading, data: nil)))
            .frame(width: 300, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No projected range data") {
        ProjectedRangeWidget(model: previewModel(ProjectedRangeUpdate(status: .loaded, data: nil)))
            .frame(width: 300, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ProjectedRangeWidget(
            model: previewModel(ProjectedRangeUpdate(status: .failed("Network unavailable"), data: nil))
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        ProjectedRangeWidget(
            model: previewModel(
                ProjectedRangeUpdate(
                    status: .loaded,
                    connection: .stale,
                    data: previewData,
                    isRefetching: true,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ProjectedRangeWidget(
            model: previewModel(
                ProjectedRangeUpdate(
                    status: .loaded,
                    connection: .offline,
                    data: previewData,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 3, rows: 2)
        )
        .frame(width: 380, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
