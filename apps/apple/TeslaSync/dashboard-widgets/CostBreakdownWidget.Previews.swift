//
//  CostBreakdownWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0031 · CostBreakdownWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline / content) and
//  each layout (standard / wide / compact). DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func costBreakdownPreviewModel(_ update: CostBreakdownUpdate) -> CostBreakdownModel {
        let source = InMemoryCostBreakdownSource(initial: update)
        let model = CostBreakdownModel(source: source)
        model.start()
        return model
    }

    private let costBreakdownSampleData = CostBreakdownData(
        monthlyEntries: [
            CostMonthEntry(month: "Jan", evCost: 42),
            CostMonthEntry(month: "Feb", evCost: 38),
            CostMonthEntry(month: "Mar", evCost: 55),
            CostMonthEntry(month: "Apr", evCost: 47),
            CostMonthEntry(month: "May", evCost: 61),
            CostMonthEntry(month: "Jun", evCost: 50)
        ],
        totalChargingCost: 293,
        totalSavings: 180,
        monthlySavings: 22,
        costPerKmEv: 0.043
    )

    private let costBreakdownSamplePrefs = CostBreakdownPrefs(
        distance: .miles,
        currencySymbol: "$",
        precision: 2,
        localeIdentifier: "en_US"
    )

    #Preview("Standard (2×4)") {
        CostBreakdownWidget(
            model: costBreakdownPreviewModel(
                CostBreakdownUpdate(
                    status: .loaded,
                    connection: .live,
                    data: costBreakdownSampleData,
                    prefs: costBreakdownSamplePrefs,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4)") {
        CostBreakdownWidget(
            model: costBreakdownPreviewModel(
                CostBreakdownUpdate(
                    status: .loaded,
                    connection: .live,
                    data: costBreakdownSampleData,
                    prefs: CostBreakdownPrefs(distance: .kilometers),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4),
            onOpen: {}
        )
        .frame(width: 560, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        CostBreakdownWidget(
            model: costBreakdownPreviewModel(
                CostBreakdownUpdate(
                    status: .loaded,
                    connection: .live,
                    data: costBreakdownSampleData,
                    prefs: costBreakdownSamplePrefs,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        CostBreakdownWidget(
            model: costBreakdownPreviewModel(CostBreakdownUpdate(status: .loading, data: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        CostBreakdownWidget(
            model: costBreakdownPreviewModel(
                CostBreakdownUpdate(status: .loaded, data: CostBreakdownData())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        CostBreakdownWidget(
            model: costBreakdownPreviewModel(
                CostBreakdownUpdate(status: .failed("Network unavailable"), data: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        CostBreakdownWidget(
            model: costBreakdownPreviewModel(
                CostBreakdownUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    data: costBreakdownSampleData,
                    prefs: costBreakdownSamplePrefs,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        CostBreakdownWidget(
            model: costBreakdownPreviewModel(
                CostBreakdownUpdate(
                    status: .loaded,
                    connection: .offline,
                    data: costBreakdownSampleData,
                    prefs: costBreakdownSamplePrefs,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 460)
        .padding()
        .background(Color.TS.bg)
    }
#endif
