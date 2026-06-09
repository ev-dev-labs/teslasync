//
//  XRayControls.Previews.swift
//  TeslaSync — P4 feature view · 0033 · XRayControls (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error /
//  stale / offline) at both a wide (single-row) and a compact (stacked) width, so
//  the responsive wrap is exercised. The wide content preview selects a 5-minute
//  window so the buckets that are not strictly finer than it render disabled (web
//  `tooBig`). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: XRayControlsUpdate) -> XRayControlsModel {
        let source = InMemoryXRayControlsSource(initial: update)
        let model = XRayControlsModel(source: source)
        model.start()
        return model
    }

    private func previewVehicles() -> [XRayVehicleRef] {
        [
            XRayVehicleRef(id: 1, displayName: "Lightning", vin: "5YJ3E1EA7KF000001"),
            XRayVehicleRef(id: 2, displayName: "Roadrunner", vin: "5YJ3E1EA7KF000002"),
            XRayVehicleRef(id: 3, displayName: nil, vin: "5YJSA1E26HF000003")
        ]
    }

    #Preview("Content (wide, disabled buckets)") {
        XRayControls(
            model: previewModel(
                XRayControlsUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicles: previewVehicles(),
                    vehicleID: 1,
                    window: .m5,
                    bucket: .m1
                )
            )
        )
        .frame(width: 640)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact, stacked)") {
        XRayControls(
            model: previewModel(
                XRayControlsUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicles: previewVehicles(),
                    vehicleID: 2,
                    window: .h1,
                    bucket: .m1
                )
            )
        )
        .frame(width: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        XRayControls(
            model: previewModel(XRayControlsUpdate(status: .loading, vehicles: []))
        )
        .frame(width: 640)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (no vehicles)") {
        XRayControls(
            model: previewModel(
                XRayControlsUpdate(status: .loaded, connection: .live, vehicles: [], window: .h6, bucket: .m5)
            )
        )
        .frame(width: 640)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        XRayControls(
            model: previewModel(
                XRayControlsUpdate(status: .failed("The vehicles endpoint timed out"), vehicles: [])
            )
        )
        .frame(width: 640)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        XRayControls(
            model: previewModel(
                XRayControlsUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicles: previewVehicles(),
                    vehicleID: 1,
                    window: .h1,
                    bucket: .m1,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 640)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        XRayControls(
            model: previewModel(
                XRayControlsUpdate(
                    status: .loaded,
                    connection: .offline,
                    vehicles: previewVehicles(),
                    vehicleID: 3,
                    window: .h24,
                    bucket: .h1,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 640)
        .padding()
        .background(Color.TS.bg)
    }
#endif
