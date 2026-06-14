//
//  TelemetryGrid.Previews.swift
//  TeslaSync — P4 feature view · 0285 · TelemetryGrid (Apple)
//
//  Xcode previews for each surface state (data / loading / empty / error / stale / offline),
//  in both metric and imperial units. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    enum TelemetryGridPreviewData {
        static func vehicle() -> TGVehicleSnapshot {
            TGVehicleSnapshot(
                batteryLevel: 64,
                ratedRangeMeters: 412_000,
                speedMetersPerSecond: 29,
                insideTempC: 21.5,
                outsideTempC: 12,
                odometerMeters: 53_201_000,
                isCharging: true,
                chargerPowerKw: 11,
                timeToFullChargeHours: 1.5,
                sentryMode: true
            )
        }

        static func parkedVehicle() -> TGVehicleSnapshot {
            TGVehicleSnapshot(
                batteryLevel: 18,
                ratedRangeMeters: 96000,
                speedMetersPerSecond: 0,
                insideTempC: 19,
                outsideTempC: 4,
                odometerMeters: 53_201_000,
                isCharging: false,
                sentryMode: false
            )
        }

        static func loaded(
            connection: TelemetryGridConnection = .live,
            isFetching: Bool = false,
            units: TGUnitPrefs = .imperial,
            vehicle: TGVehicleSnapshot? = nil
        ) -> TelemetryGridUpdate {
            TelemetryGridUpdate(
                vehicle: vehicle ?? self.vehicle(),
                status: .loaded,
                connection: connection,
                isFetching: isFetching,
                units: units,
                updatedAt: Date().addingTimeInterval(connection == .live ? -3 : -180)
            )
        }

        static func empty() -> TelemetryGridUpdate {
            TelemetryGridUpdate(status: .loaded)
        }

        static func failed() -> TelemetryGridUpdate {
            TelemetryGridUpdate(status: .failed("Network unavailable"))
        }
    }

    @MainActor
    private func telemetryGridPreviewModel(_ update: TelemetryGridUpdate?) -> TelemetryGridModel {
        let source = InMemoryTelemetryGridSource(initial: update)
        let model = TelemetryGridModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func telemetryGridPreviewSurface(_ update: TelemetryGridUpdate?) -> some View {
        ScrollView {
            TelemetryGrid(model: telemetryGridPreviewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Data (imperial)") {
        telemetryGridPreviewSurface(TelemetryGridPreviewData.loaded())
    }

    #Preview("Data (metric, parked)") {
        telemetryGridPreviewSurface(
            TelemetryGridPreviewData.loaded(
                units: TGUnitPrefs(),
                vehicle: TelemetryGridPreviewData.parkedVehicle()
            )
        )
    }

    #Preview("Loading") {
        telemetryGridPreviewSurface(nil)
    }

    #Preview("Empty") {
        telemetryGridPreviewSurface(TelemetryGridPreviewData.empty())
    }

    #Preview("Error") {
        telemetryGridPreviewSurface(TelemetryGridPreviewData.failed())
    }

    #Preview("Stale (cached)") {
        telemetryGridPreviewSurface(TelemetryGridPreviewData.loaded(connection: .stale))
    }

    #Preview("Offline") {
        telemetryGridPreviewSurface(TelemetryGridPreviewData.loaded(connection: .offline))
    }
#endif
