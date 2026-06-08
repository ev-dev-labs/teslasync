//
//  RangeEstimateWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0077 · RangeEstimateWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / content) and
//  each layout (compact / standard). DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func rangePreviewModel(_ update: RangeEstimateUpdate) -> RangeEstimateModel {
        let source = InMemoryRangeEstimateSource(initial: update)
        let model = RangeEstimateModel(source: source)
        model.start()
        return model
    }

    private let rangeSampleState = RangeStateDTO(
        ratedRangeMeters: 405_000,
        idealRangeMeters: 450_000
    )

    private let rangeSampleUnits = RangeUnitPrefs(distance: .miles, localeIdentifier: "en_US")

    #Preview("Compact (1×2)") {
        RangeEstimateWidget(
            model: rangePreviewModel(
                RangeEstimateUpdate(
                    status: .loaded,
                    connection: .live,
                    state: rangeSampleState,
                    units: rangeSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 168, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Standard (2×2)") {
        RangeEstimateWidget(
            model: rangePreviewModel(
                RangeEstimateUpdate(
                    status: .loaded,
                    connection: .live,
                    state: rangeSampleState,
                    units: RangeUnitPrefs(distance: .kilometers, localeIdentifier: "en_US"),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RangeEstimateWidget(
            model: rangePreviewModel(RangeEstimateUpdate(status: .loading, state: nil)),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 168, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        RangeEstimateWidget(
            model: rangePreviewModel(RangeEstimateUpdate(status: .loaded, state: nil)),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 168, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        RangeEstimateWidget(
            model: rangePreviewModel(
                RangeEstimateUpdate(status: .failed("Network unavailable"), state: nil)
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 168, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        RangeEstimateWidget(
            model: rangePreviewModel(
                RangeEstimateUpdate(
                    status: .loaded,
                    connection: .offline,
                    state: rangeSampleState,
                    units: rangeSampleUnits,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 220)
        .padding()
        .background(Color.TS.bg)
    }
#endif
