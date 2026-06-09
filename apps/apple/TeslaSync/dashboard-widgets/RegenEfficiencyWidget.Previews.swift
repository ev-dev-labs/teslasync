//
//  RegenEfficiencyWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0081 · RegenEfficiencyWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty / error / stale / offline).
//  DEBUG-only; skipped by the release build.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: RegenUpdate) -> RegenEfficiencyModel {
        let source = InMemoryRegenEfficiencySource(initial: update)
        let model = RegenEfficiencyModel(source: source)
        model.start()
        return model
    }

    private let previewPayload = RegenEfficiencyInput(
        totalRegenWh: 184_500,
        totalDriveWh: 642_000,
        regenRatio: 0.287,
        monthlyAvgRegen: 2450,
        freeCharges: 3
    )

    #Preview("Content (expanded)") {
        RegenEfficiencyWidget(
            model: previewModel(
                RegenUpdate(
                    status: .loaded,
                    connection: .live,
                    payload: previewPayload,
                    updatedAt: Date(),
                    isFetching: false
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 300, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (default)") {
        RegenEfficiencyWidget(
            model: previewModel(
                RegenUpdate(status: .loaded, connection: .live, payload: previewPayload, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RegenEfficiencyWidget(
            model: previewModel(RegenUpdate(status: .loading, payload: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        RegenEfficiencyWidget(
            model: previewModel(RegenUpdate(status: .loaded, payload: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        RegenEfficiencyWidget(
            model: previewModel(RegenUpdate(status: .failed("Network unavailable"), payload: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (low recovery)") {
        RegenEfficiencyWidget(
            model: previewModel(
                RegenUpdate(
                    status: .loaded,
                    connection: .stale,
                    payload: RegenEfficiencyInput(
                        totalRegenWh: 42000,
                        regenRatio: 0.12,
                        monthlyAvgRegen: 900,
                        freeCharges: 0
                    ),
                    updatedAt: Date().addingTimeInterval(-180),
                    isFetching: true
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        RegenEfficiencyWidget(
            model: previewModel(
                RegenUpdate(
                    status: .loaded,
                    connection: .offline,
                    payload: previewPayload,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 200)
        .padding()
        .background(Color.TS.bg)
    }
#endif
