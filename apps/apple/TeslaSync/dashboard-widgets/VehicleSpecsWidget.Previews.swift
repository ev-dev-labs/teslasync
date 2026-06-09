//
//  VehicleSpecsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0109 · VehicleSpecsWidget (Apple)
//
//  Xcode previews for each surface state (content / wide / compact / loading /
//  empty / error / stale / offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: VehicleSpecsUpdate) -> VehicleSpecsModel {
        let source = InMemorySpecsSource(initial: update)
        let model = VehicleSpecsModel(source: source)
        model.start()
        return model
    }

    private let previewSpecs = RawVehicleSpecs(
        carType: .text("Model 3"),
        trimBadging: .text("Performance"),
        exteriorColor: .text("Deep Blue Metallic"),
        wheelType: .text("20\" Überturbine"),
        interior: .text("All Black"),
        auxBatteryType: .text("Li-ion")
    )

    private let previewConfig = RawVehicleConfig(version: .text("2024.20.7"))

    private let previewOptions = [
        SpecOption(key: "$APBS", value: .text("Acceleration Boost")),
        SpecOption(key: "$MDL3", value: .text("Model 3")),
        SpecOption(key: "$PPSB", value: .text("Deep Blue Metallic")),
        SpecOption(key: "$W40B", value: .absent)
    ]

    private func contentUpdate(
        connection: SpecsConnection = .live,
        updatedAt: Date = Date()
    ) -> VehicleSpecsUpdate {
        VehicleSpecsUpdate(
            status: .loaded,
            connection: connection,
            specs: previewSpecs,
            config: previewConfig,
            options: previewOptions,
            labels: .default,
            updatedAt: updatedAt
        )
    }

    #Preview("Content (standard)") {
        VehicleSpecsWidget(
            model: previewModel(contentUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (wide)") {
        VehicleSpecsWidget(
            model: previewModel(contentUpdate()),
            size: DashboardWidgetSize(cols: 3, rows: 6)
        )
        .frame(width: 460, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (headline)") {
        VehicleSpecsWidget(
            model: previewModel(contentUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 160)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VehicleSpecsWidget(model: previewModel(VehicleSpecsUpdate(status: .loading)))
            .frame(width: 320, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        VehicleSpecsWidget(model: previewModel(VehicleSpecsUpdate(status: .loaded)))
            .frame(width: 320, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        VehicleSpecsWidget(model: previewModel(VehicleSpecsUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        VehicleSpecsWidget(
            model: previewModel(contentUpdate(connection: .stale, updatedAt: Date().addingTimeInterval(-180))),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        VehicleSpecsWidget(
            model: previewModel(contentUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-900))),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }
#endif
