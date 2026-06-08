//
//  LiveSignalsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0058 · LiveSignalsWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale /
//  offline / content / partial). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: LiveSignalsUpdate) -> LiveSignalsModel {
        let source = InMemoryLiveSignalsSource(initial: update)
        let model = LiveSignalsModel(source: source)
        model.start()
        return model
    }

    private let fullUpdate = LiveSignalsUpdate(
        status: .loaded,
        connection: .live,
        prefs: .metric,
        motor: LiveSignalsMotorInput(torqueNm: 285, statorTempC: 42, gear: "D"),
        climate: LiveSignalsClimateInput(insideTempC: 21.5, outsideTempC: 9, hvacPowerKw: 1.8),
        security: LiveSignalsSecurityInput(locked: true, sentryMode: true),
        tires: LiveSignalsTiresInput(frontLeftKpa: 250, frontRightKpa: 250, rearLeftKpa: 248, rearRightKpa: 249),
        updatedAt: Date()
    )

    #Preview("Content") {
        LiveSignalsWidget(model: previewModel(fullUpdate), size: DashboardWidgetSize(cols: 2, rows: 4))
            .frame(width: 280, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Partial (section skeletons)") {
        LiveSignalsWidget(
            model: previewModel(
                LiveSignalsUpdate(
                    status: .loaded,
                    motor: LiveSignalsMotorInput(torqueNm: 120, statorTempC: 31, gear: "P"),
                    security: LiveSignalsSecurityInput(locked: false, sentryMode: false),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Imperial units") {
        LiveSignalsWidget(
            model: previewModel(
                LiveSignalsUpdate(
                    status: .loaded,
                    prefs: .imperial,
                    motor: LiveSignalsMotorInput(torqueNm: 285, statorTempC: 42, gear: "D"),
                    climate: LiveSignalsClimateInput(insideTempC: 21.5, outsideTempC: 9, hvacPowerKw: 1.8),
                    security: LiveSignalsSecurityInput(locked: true, sentryMode: false),
                    tires: LiveSignalsTiresInput(
                        frontLeftKpa: 250,
                        frontRightKpa: 250,
                        rearLeftKpa: 248,
                        rearRightKpa: 249
                    ),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        LiveSignalsWidget(model: previewModel(LiveSignalsUpdate(status: .loading)))
            .frame(width: 280, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        LiveSignalsWidget(model: previewModel(LiveSignalsUpdate(status: .loaded)))
            .frame(width: 280, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        LiveSignalsWidget(model: previewModel(LiveSignalsUpdate(status: .failed("Network unavailable"))))
            .frame(width: 280, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        LiveSignalsWidget(
            model: previewModel(
                LiveSignalsUpdate(
                    status: .loaded,
                    connection: .stale,
                    motor: LiveSignalsMotorInput(torqueNm: 0, statorTempC: 38, gear: "D"),
                    climate: LiveSignalsClimateInput(insideTempC: 20, outsideTempC: 7, hvacPowerKw: 0),
                    security: LiveSignalsSecurityInput(locked: true, sentryMode: false),
                    tires: LiveSignalsTiresInput(
                        frontLeftKpa: 249,
                        frontRightKpa: 250,
                        rearLeftKpa: 247,
                        rearRightKpa: 248
                    ),
                    updatedAt: Date().addingTimeInterval(-120)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        LiveSignalsWidget(
            model: previewModel(
                LiveSignalsUpdate(
                    status: .loaded,
                    connection: .offline,
                    motor: LiveSignalsMotorInput(torqueNm: 0, statorTempC: 30, gear: "P"),
                    security: LiveSignalsSecurityInput(locked: true, sentryMode: true),
                    tires: LiveSignalsTiresInput(
                        frontLeftKpa: 248,
                        frontRightKpa: 249,
                        rearLeftKpa: 247,
                        rearRightKpa: 248
                    ),
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
