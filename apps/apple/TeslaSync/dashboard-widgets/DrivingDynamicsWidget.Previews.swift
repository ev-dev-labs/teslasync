//
//  DrivingDynamicsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0044 · DrivingDynamicsWidget (Apple)
//
//  Xcode previews for each surface state (loading/empty/error/stale/offline/
//  content + wide + compact). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Deterministic sample data: a moderate "sporty" drive with peaks across the
    /// three gauges plus a believable acceleration histogram so the wide layout
    /// renders a full distribution.
    private enum DrivingDynamicsPreviewData {
        static let dynamics = DrivingDynamicsDTO(
            maxAccelerationG: 0.46,
            maxBrakingG: 0.52,
            maxCorneringG: 0.41,
            avgAccelerationG: 0.22,
            avgBrakingG: 0.27,
            smoothnessScore: 78
        )

        static let calmDynamics = DrivingDynamicsDTO(
            maxAccelerationG: 0.18,
            maxBrakingG: 0.22,
            maxCorneringG: 0.15,
            avgAccelerationG: 0.08,
            avgBrakingG: 0.11,
            smoothnessScore: 94
        )

        static let distribution = DrivingDynamicsAccelerationDistribution(
            values: [4, 18, 42, 63, 51, 29, 14, 6]
        )
    }

    @MainActor
    private func previewModel(_ update: DrivingDynamicsUpdate) -> DrivingDynamicsModel {
        let source = InMemoryDrivingDynamicsSource(initial: update)
        let model = DrivingDynamicsModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = DrivingDynamicsVehicle(id: 1, displayName: "Model Y")

    #Preview("Content") {
        DrivingDynamicsWidget(
            model: previewModel(
                DrivingDynamicsUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    dynamics: DrivingDynamicsPreviewData.dynamics,
                    distribution: DrivingDynamicsPreviewData.distribution,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (wide)") {
        DrivingDynamicsWidget(
            model: previewModel(
                DrivingDynamicsUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    dynamics: DrivingDynamicsPreviewData.dynamics,
                    distribution: DrivingDynamicsPreviewData.distribution,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 6)
        )
        .frame(width: 560, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DrivingDynamicsWidget(model: previewModel(DrivingDynamicsUpdate(status: .loading)))
            .frame(width: 340, height: 340)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DrivingDynamicsWidget(
            model: previewModel(DrivingDynamicsUpdate(status: .loaded, vehicle: previewVehicle, dynamics: nil))
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        DrivingDynamicsWidget(model: previewModel(DrivingDynamicsUpdate(status: .failed("Network unavailable"))))
            .frame(width: 340, height: 340)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        DrivingDynamicsWidget(
            model: previewModel(
                DrivingDynamicsUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    dynamics: DrivingDynamicsPreviewData.dynamics,
                    distribution: DrivingDynamicsPreviewData.distribution,
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        DrivingDynamicsWidget(
            model: previewModel(
                DrivingDynamicsUpdate(
                    status: .failed("Offline"),
                    connection: .offline,
                    vehicle: previewVehicle,
                    dynamics: DrivingDynamicsPreviewData.dynamics,
                    distribution: DrivingDynamicsPreviewData.distribution,
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1-col)") {
        DrivingDynamicsWidget(
            model: previewModel(
                DrivingDynamicsUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    dynamics: DrivingDynamicsPreviewData.calmDynamics,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 3)
        )
        .frame(width: 180, height: 240)
        .padding()
        .background(Color.TS.bg)
    }
#endif
