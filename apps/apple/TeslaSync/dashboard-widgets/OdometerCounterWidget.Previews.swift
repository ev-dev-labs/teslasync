//
//  OdometerCounterWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0070 · OdometerCounterWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline
//  / content). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: OdometerUpdate) -> OdometerCounterModel {
        let source = InMemoryOdometerSource(initial: update)
        let model = OdometerCounterModel(source: source, localeIdentifier: "en_US")
        model.start()
        return model
    }

    private let loadedInput = OdometerInput(
        odometerMeters: 28_452_000,
        totalDistanceMeters: 19_804_000,
        distanceUnit: "km"
    )

    #Preview("Content · wide") {
        OdometerCounterWidget(
            model: previewModel(OdometerUpdate(
                status: .loaded,
                connection: .live,
                input: loadedInput,
                updatedAt: Date()
            )),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · 1×2") {
        OdometerCounterWidget(
            model: previewModel(OdometerUpdate(
                status: .loaded,
                connection: .live,
                input: loadedInput,
                updatedAt: Date()
            )),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 170, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        OdometerCounterWidget(
            model: previewModel(OdometerUpdate(status: .loading)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        OdometerCounterWidget(
            model: previewModel(OdometerUpdate(status: .loaded, input: OdometerInput(distanceUnit: "mi"))),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        OdometerCounterWidget(
            model: previewModel(OdometerUpdate(status: .failed("Network unavailable"))),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        OdometerCounterWidget(
            model: previewModel(
                OdometerUpdate(
                    status: .loaded,
                    connection: .stale,
                    input: loadedInput,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        OdometerCounterWidget(
            model: previewModel(
                OdometerUpdate(
                    status: .loaded,
                    connection: .offline,
                    input: OdometerInput(odometerMeters: 28_452_000, distanceUnit: "mi"),
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 220)
        .padding()
        .background(Color.TS.bg)
    }
#endif
