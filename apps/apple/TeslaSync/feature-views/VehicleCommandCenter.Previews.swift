//
//  VehicleCommandCenter.Previews.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  Xcode previews for each surface state (content / loading / search-empty /
//  command-status error / stale / offline-asleep). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    enum VCCPreviewData {
        static func vehicle(state: String = "online") -> VCCVehicle {
            VCCVehicle(
                id: 1,
                vin: "5YJ3E1EA7KF000000",
                displayName: "Model 3",
                model: "model3",
                state: state,
                updatedAt: Date()
            )
        }

        static func state() -> VCCVehicleState {
            VCCVehicleState(
                batteryLevel: 82,
                ratedRangeMeters: 386_243,
                insideTempCelsius: 21,
                isLocked: true,
                isCharging: false,
                isClimateOn: false,
                sentryMode: true
            )
        }

        static func latestCommands() -> [VCCCommandLogEntry] {
            [
                VCCCommandLogEntry(command: "lock", status: "success", createdAt: Date().addingTimeInterval(-120)),
                VCCCommandLogEntry(command: "honk_horn", status: "error", createdAt: Date().addingTimeInterval(-600))
            ]
        }

        static func loaded(
            connection: VCCConnection = .live,
            vehicleState: String = "online",
            commandStatus: VCCLoadStatus = .loaded
        ) -> VCCUpdate {
            VCCUpdate(
                vehicle: vehicle(state: vehicleState),
                state: state(),
                latestCommands: latestCommands(),
                commandStatus: commandStatus,
                connection: connection,
                units: VCCUnitPrefs(distance: "mi", temperature: "°F")
            )
        }
    }

    @MainActor
    private func vccPreviewModel(_ update: VCCUpdate?, search: String = "") -> VehicleCommandCenterModel {
        let source = InMemoryVehicleCommandSource(initial: update)
        let model = VehicleCommandCenterModel(
            source: source,
            favoritesStore: InMemoryVehicleCommandFavoritesStore(),
            feedback: InMemoryVehicleCommandFeedback()
        )
        model.start()
        model.search = search
        return model
    }

    @MainActor
    private func vccPreviewSurface(_ update: VCCUpdate?, search: String = "") -> some View {
        ScrollView {
            VehicleCommandCenter(model: vccPreviewModel(update, search: search))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        vccPreviewSurface(VCCPreviewData.loaded())
    }

    #Preview("Loading") {
        vccPreviewSurface(nil)
    }

    #Preview("Search results") {
        vccPreviewSurface(VCCPreviewData.loaded(), search: "charge")
    }

    #Preview("Search empty") {
        vccPreviewSurface(VCCPreviewData.loaded(), search: "zzzz")
    }

    #Preview("Command-status error") {
        vccPreviewSurface(VCCPreviewData.loaded(commandStatus: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        vccPreviewSurface(VCCPreviewData.loaded(connection: .stale))
    }

    #Preview("Offline / asleep") {
        vccPreviewSurface(VCCPreviewData.loaded(connection: .offline, vehicleState: "asleep"))
    }
#endif
