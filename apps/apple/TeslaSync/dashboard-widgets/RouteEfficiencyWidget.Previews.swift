//
//  RouteEfficiencyWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0082 · RouteEfficiencyWidget (Apple)
//
//  Xcode previews for each surface state (content / wide / loading / empty / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: RouteEfficiencyUpdate) -> RouteEfficiencyModel {
        let source = InMemoryRouteEfficiencySource(initial: update)
        let model = RouteEfficiencyModel(source: source)
        model.start()
        return model
    }

    private func previewRoutes() -> [RouteEfficiencyInput] {
        [
            RouteEfficiencyInput(
                id: 1, startLocation: "Home", endLocation: "Office",
                avgEfficiency: 165, bestEfficiency: 150, worstEfficiency: 190, tripCount: 42
            ),
            RouteEfficiencyInput(
                id: 2, startLocation: "Office", endLocation: "Gym",
                avgEfficiency: 240, bestEfficiency: 220, worstEfficiency: 280, tripCount: 18
            ),
            RouteEfficiencyInput(
                id: 3, startLocation: "Home", endLocation: "Airport",
                avgEfficiency: 310, bestEfficiency: 290, worstEfficiency: 360, tripCount: 6
            ),
            RouteEfficiencyInput(
                id: 4, startLocation: "Home", endLocation: "Lake House",
                avgEfficiency: 380, bestEfficiency: 350, worstEfficiency: 430, tripCount: 4
            ),
            RouteEfficiencyInput(
                id: 5, startLocation: "Home", endLocation: "Mountain Trail",
                avgEfficiency: 455, bestEfficiency: 410, worstEfficiency: 520, tripCount: 2
            )
        ]
    }

    #Preview("Content (2×4)") {
        RouteEfficiencyWidget(
            model: previewModel(
                RouteEfficiencyUpdate(
                    status: .loaded,
                    connection: .live,
                    routes: previewRoutes(),
                    unit: .kilometers,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4, miles)") {
        RouteEfficiencyWidget(
            model: previewModel(
                RouteEfficiencyUpdate(
                    status: .loaded,
                    connection: .live,
                    routes: previewRoutes(),
                    unit: .miles,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 620, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RouteEfficiencyWidget(model: previewModel(RouteEfficiencyUpdate(status: .loading, routes: [])))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No route data") {
        RouteEfficiencyWidget(model: previewModel(RouteEfficiencyUpdate(status: .loaded, routes: [])))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        RouteEfficiencyWidget(
            model: previewModel(RouteEfficiencyUpdate(status: .failed("Network unavailable"), routes: []))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        RouteEfficiencyWidget(
            model: previewModel(
                RouteEfficiencyUpdate(
                    status: .loaded,
                    connection: .stale,
                    routes: previewRoutes(),
                    unit: .kilometers,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        RouteEfficiencyWidget(
            model: previewModel(
                RouteEfficiencyUpdate(
                    status: .loaded,
                    connection: .offline,
                    routes: previewRoutes(),
                    unit: .kilometers,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
