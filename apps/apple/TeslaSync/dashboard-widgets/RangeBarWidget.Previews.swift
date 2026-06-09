//
//  RangeBarWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0076 · RangeBarWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline / content)
//  and the standard + wide layouts. DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func rangeBarPreviewModel(_ update: RangeBarUpdate) -> RangeBarModel {
        let source = InMemoryRangeBarSource(initial: update)
        let model = RangeBarModel(source: source)
        model.start()
        return model
    }

    private let rangeBarSampleState = RangeBarStateDTO(
        ratedRangeMeters: 405_000,
        idealRangeMeters: 450_000
    )

    private let rangeBarSampleUnits = RangeBarUnitPrefs(distance: .miles, localeIdentifier: "en_US")

    #Preview("Standard (2×2)") {
        RangeBarWidget(
            model: rangeBarPreviewModel(
                RangeBarUpdate(
                    status: .loaded,
                    connection: .live,
                    state: rangeBarSampleState,
                    units: RangeBarUnitPrefs(distance: .kilometers, localeIdentifier: "en_US"),
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

    #Preview("Wide (4×2)") {
        RangeBarWidget(
            model: rangeBarPreviewModel(
                RangeBarUpdate(
                    status: .loaded,
                    connection: .live,
                    state: rangeBarSampleState,
                    units: rangeBarSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onOpen: {}
        )
        .frame(width: 560, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RangeBarWidget(
            model: rangeBarPreviewModel(RangeBarUpdate(status: .loading, state: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        RangeBarWidget(
            model: rangeBarPreviewModel(RangeBarUpdate(status: .loaded, state: RangeBarStateDTO())),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        RangeBarWidget(
            model: rangeBarPreviewModel(
                RangeBarUpdate(status: .failed("Network unavailable"), state: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (auto-refresh)") {
        RangeBarWidget(
            model: rangeBarPreviewModel(
                RangeBarUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    state: rangeBarSampleState,
                    units: rangeBarSampleUnits,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        RangeBarWidget(
            model: rangeBarPreviewModel(
                RangeBarUpdate(
                    status: .loaded,
                    connection: .offline,
                    state: rangeBarSampleState,
                    units: rangeBarSampleUnits,
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
