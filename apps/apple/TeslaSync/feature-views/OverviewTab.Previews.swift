//
//  OverviewTab.Previews.swift
//  TeslaSync — P4 feature view · 0059 · OverviewTab (Apple)
//
//  Xcode previews for each surface state (content / content in miles / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: OverviewUpdate) -> OverviewModel {
        let source = InMemoryOverviewSource(initial: update)
        let model = OverviewModel(source: source)
        model.start()
        return model
    }

    private func previewVehicles() -> [OverviewVehicleInput] {
        [
            OverviewVehicleInput(id: 1, name: "Model 3", distanceKm: 1820.4),
            OverviewVehicleInput(id: 2, name: "Model Y", distanceKm: 2310.9),
            OverviewVehicleInput(id: 3, name: "Model S", distanceKm: 990.2)
        ]
    }

    private func previewDays() -> [OverviewDayInput] {
        [
            OverviewDayInput(day: "Mon", drives: 12, avgDistance: 28.4),
            OverviewDayInput(day: "Tue", drives: 9, avgDistance: 31.1),
            OverviewDayInput(day: "Wed", drives: 14, avgDistance: 22.7),
            OverviewDayInput(day: "Thu", drives: 11, avgDistance: 26.9),
            OverviewDayInput(day: "Fri", drives: 18, avgDistance: 35.2),
            OverviewDayInput(day: "Sat", drives: 7, avgDistance: 48.6),
            OverviewDayInput(day: "Sun", drives: 5, avgDistance: 52.3)
        ]
    }

    private func previewMonths() -> [OverviewMonthInput] {
        [
            OverviewMonthInput(month: "Jan", cost: 42.1, gasCost: 120.5, savings: 78.4),
            OverviewMonthInput(month: "Feb", cost: 38.7, gasCost: 110.2, savings: 71.5),
            OverviewMonthInput(month: "Mar", cost: 45.3, gasCost: 131.0, savings: 85.7),
            OverviewMonthInput(month: "Apr", cost: 40.9, gasCost: 118.4, savings: 77.5),
            OverviewMonthInput(month: "May", cost: 47.8, gasCost: 142.6, savings: 94.8),
            OverviewMonthInput(month: "Jun", cost: 44.2, gasCost: 129.9, savings: 85.7)
        ]
    }

    private func loadedUpdate(
        connection: OverviewConnection = .live,
        distanceUnit: String = "km"
    ) -> OverviewUpdate {
        OverviewUpdate(
            status: .loaded,
            vehicles: previewVehicles(),
            days: previewDays(),
            months: previewMonths(),
            distanceUnit: distanceUnit,
            connection: connection,
            refreshing: false,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: OverviewUpdate) -> some View {
        ScrollView {
            OverviewTab(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Content (miles)") {
        previewSurface(loadedUpdate(distanceUnit: "mi"))
    }

    #Preview("Empty") {
        previewSurface(OverviewUpdate(status: .loaded, vehicles: [], days: [], months: []))
    }

    #Preview("Loading") {
        previewSurface(OverviewUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(OverviewUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
