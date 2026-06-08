//
//  OverviewVehicleComparison.Previews.swift
//  TeslaSync — P4 feature view · 0060 · OverviewVehicleComparison (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error /
//  stale / offline). DEBUG-only; skipped by the production swiftc host gate and
//  exercised by a separate preview-typecheck pass under the Xcode toolchain.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: OverviewComparisonUpdate) -> OverviewComparisonModel {
        let source = InMemoryOverviewComparisonSource(initial: update)
        let model = OverviewComparisonModel(source: source)
        model.start()
        return model
    }

    private let previewFleet: [OverviewVehicle] = [
        OverviewVehicle(id: 1, name: "Model 3", distanceKm: 1200, energyKwh: 180, efficiencyWhKm: 150, drives: 42),
        OverviewVehicle(id: 2, name: "Model Y", distanceKm: 820, energyKwh: 150, efficiencyWhKm: 183, drives: 30),
        OverviewVehicle(id: 3, name: "Model S", distanceKm: 1540, energyKwh: 268, efficiencyWhKm: 174, drives: 55)
    ]

    private func previewUpdate(
        status: OverviewVehicleComparisonLoadStatus = .loaded,
        connection: OverviewVehicleComparisonConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        vehicles: [OverviewVehicle] = previewFleet,
        distanceUnit: OverviewDistanceUnit = .km,
        updatedAt: Date? = Date()
    ) -> OverviewComparisonUpdate {
        OverviewComparisonUpdate(
            status: status,
            connection: connection,
            isFetching: isFetching,
            isError: isError,
            vehicles: vehicles,
            distanceUnit: distanceUnit,
            updatedAt: updatedAt
        )
    }

    #Preview("Content") {
        ScrollView {
            OverviewVehicleComparison(model: previewModel(previewUpdate()))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content · miles") {
        ScrollView {
            OverviewVehicleComparison(model: previewModel(previewUpdate(distanceUnit: .mi)))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        OverviewVehicleComparison(model: previewModel(previewUpdate(status: .loading, vehicles: [], updatedAt: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        OverviewVehicleComparison(model: previewModel(previewUpdate(status: .loaded, vehicles: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        OverviewVehicleComparison(
            model: previewModel(
                OverviewComparisonUpdate(status: .failed("Network unavailable"), isError: true, vehicles: [])
            )
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView {
            OverviewVehicleComparison(
                model: previewModel(previewUpdate(connection: .stale, updatedAt: Date().addingTimeInterval(-240)))
            )
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ScrollView {
            OverviewVehicleComparison(
                model: previewModel(previewUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-600)))
            )
            .padding()
        }
        .background(Color.TS.bg)
    }
#endif
