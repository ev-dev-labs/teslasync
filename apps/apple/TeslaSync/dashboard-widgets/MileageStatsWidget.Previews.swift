//
//  MileageStatsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0064 · MileageStatsWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale /
//  offline / content) in both the standard 2×2 and compact 1-column layouts.
//  DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: MileageStatsUpdate) -> MileageStatsModel {
        let source = InMemoryMileageStatsSource(initial: update)
        let model = MileageStatsModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = MileageVehicleRef(id: 1, displayName: "Model Y")

    /// ~30 000 mi lifetime, ~750 mi over the last 30 days (≈25 mi/day).
    private let previewInput = MileageStatsInput(lifetimeKm: 48280.32, last30dKm: 1207.008)

    #Preview("Content · standard (mi)") {
        MileageStatsWidget(
            model: previewModel(
                MileageStatsUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    input: previewInput,
                    unitLabel: "mi",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · compact (km)") {
        MileageStatsWidget(
            model: previewModel(
                MileageStatsUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    input: previewInput,
                    unitLabel: "km",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 160, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        MileageStatsWidget(model: previewModel(MileageStatsUpdate(status: .loading, input: nil)))
            .frame(width: 320, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MileageStatsWidget(model: previewModel(MileageStatsUpdate(status: .loaded, input: nil)))
            .frame(width: 320, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        MileageStatsWidget(model: previewModel(MileageStatsUpdate(status: .failed("Network unavailable"), input: nil)))
            .frame(width: 320, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        MileageStatsWidget(
            model: previewModel(
                MileageStatsUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    input: previewInput,
                    unitLabel: "mi",
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        MileageStatsWidget(
            model: previewModel(
                MileageStatsUpdate(
                    status: .failed("Offline"),
                    connection: .offline,
                    vehicle: previewVehicle,
                    input: previewInput,
                    unitLabel: "km",
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }
#endif
