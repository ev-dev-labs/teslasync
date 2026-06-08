//
//  SpeedProfileWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0095 · SpeedProfileWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale /
//  offline / content) across the standard 2×4 and wide 4×4 layouts. DEBUG-only;
//  skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private func previewModel(_ update: SpeedProfileUpdate) -> SpeedProfileModel {
        let source = InMemorySpeedProfileSource(initial: update)
        let model = SpeedProfileModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = SpeedProfileVehicleRef(id: 1, displayName: "Model Y")

    /// A realistic SI speed histogram (m/s buckets) peaking in the cruising band,
    /// with an optimal-speed estimate of ~16 m/s.
    private let previewInput = SpeedProfileInput(
        distribution: [
            SpeedProfileBucketInput(speedBucket: "0-5", readings: 120, avgPowerKw: 6),
            SpeedProfileBucketInput(speedBucket: "5-10", readings: 340, avgPowerKw: 9),
            SpeedProfileBucketInput(speedBucket: "10-15", readings: 820, avgPowerKw: 12),
            SpeedProfileBucketInput(speedBucket: "15-20", readings: 960, avgPowerKw: 16),
            SpeedProfileBucketInput(speedBucket: "20-25", readings: 540, avgPowerKw: 21),
            SpeedProfileBucketInput(speedBucket: "25-30", readings: 260, avgPowerKw: 28),
            SpeedProfileBucketInput(speedBucket: "30+", readings: 90, avgPowerKw: 35)
        ],
        optimalSpeedMps: 16
    )

    #Preview("Content · standard (mph)") {
        SpeedProfileWidget(
            model: previewModel(
                SpeedProfileUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    input: previewInput,
                    unitLabel: "mph",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · wide (km/h)") {
        SpeedProfileWidget(
            model: previewModel(
                SpeedProfileUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    input: previewInput,
                    unitLabel: "km/h",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4),
            onOpen: {}
        )
        .frame(width: 560, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SpeedProfileWidget(model: previewModel(SpeedProfileUpdate(status: .loading, input: nil)))
            .frame(width: 320, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SpeedProfileWidget(model: previewModel(SpeedProfileUpdate(status: .loaded, input: SpeedProfileInput())))
            .frame(width: 320, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SpeedProfileWidget(
            model: previewModel(SpeedProfileUpdate(status: .failed("Network unavailable"), input: nil))
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        SpeedProfileWidget(
            model: previewModel(
                SpeedProfileUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    input: previewInput,
                    unitLabel: "mph",
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SpeedProfileWidget(
            model: previewModel(
                SpeedProfileUpdate(
                    status: .failed("Offline"),
                    connection: .offline,
                    vehicle: previewVehicle,
                    input: previewInput,
                    unitLabel: "km/h",
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }
#endif
