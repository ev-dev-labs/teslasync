//
//  LiveTelemetryPanels.Previews.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  Xcode previews for each surface state (data / loading / empty / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    enum LiveTelemetryPanelsPreviewData {
        static func motor() -> LTPMotor {
            LTPMotor(
                shiftState: "D",
                powerKw: 184.2,
                regenKw: 0,
                motorRpmFront: 4210,
                motorRpmRear: 4188,
                torqueNmFront: 312,
                torqueNmRear: 298,
                motorTempCFront: 62,
                motorTempCRear: 58,
                inverterTempC: 44
            )
        }

        static func climate() -> LTPClimate {
            LTPClimate(
                insideTempC: 21.5,
                outsideTempC: 12,
                driverSetpointC: 21,
                passengerSetpointC: 21,
                hvacState: "On",
                defrostMode: "Off",
                isClimateOn: true,
                isPreconditioning: false,
                fanStatus: 4
            )
        }

        static func security() -> LTPSecurity {
            LTPSecurity(
                locked: true,
                sentryMode: true,
                doorsOpen: "Closed",
                windowsOpen: "Closed",
                userPresent: true,
                detail: "All systems nominal"
            )
        }

        static func tire() -> LTPTire {
            LTPTire(frontLeft: 290_000, frontRight: 288_500, rearLeft: 230_000, rearRight: 291_000)
        }

        static func charging() -> LTPCharging {
            LTPCharging(
                chargerVoltage: 232,
                chargerActualCurrent: 16,
                chargerPowerW: 11000,
                chargeEnergyAddedWh: 24500,
                chargingState: "Charging",
                batteryLevel: 64,
                rangeAddedMetersPerHour: 48000
            )
        }

        static func media() -> LTPMedia {
            LTPMedia(
                nowPlayingTitle: "Electric Feel",
                nowPlayingArtist: "MGMT",
                playbackSource: "Spotify",
                playbackStatus: "Playing"
            )
        }

        static func location() -> LTPLocation {
            LTPLocation(
                destinationName: "Supercharger — Mountain View",
                metresToArrival: 18400,
                minutesToArrival: 14,
                locatedAtHome: false,
                locatedAtWork: true,
                locatedAtFavorite: false
            )
        }

        static func live() -> LTPVehicleStateLive {
            LTPVehicleStateLive(
                lightsHighBeams: false,
                lightsTurnSignal: "Left",
                lightsHazards: false,
                driverSeatOccupied: true,
                pairedKeyCount: "3",
                valetMode: false,
                serviceMode: false,
                speedLimitMode: true,
                currentSpeedLimit: 29,
                centerDisplay: "On",
                homelinkDeviceCount: "2"
            )
        }

        static func loaded(
            connection: LiveTelemetryPanelsConnection = .live,
            isFetching: Bool = false
        ) -> LiveTelemetryPanelsUpdate {
            LiveTelemetryPanelsUpdate(
                motor: motor(),
                climate: climate(),
                security: security(),
                tire: tire(),
                charging: charging(),
                media: media(),
                location: location(),
                live: live(),
                sseConnected: connection == .live,
                remoteStartEnabled: true,
                status: .loaded,
                connection: connection,
                isFetching: isFetching,
                units: .imperial,
                updatedAt: Date().addingTimeInterval(connection == .live ? -3 : -180)
            )
        }

        static func empty() -> LiveTelemetryPanelsUpdate {
            LiveTelemetryPanelsUpdate(status: .loaded)
        }

        static func failed() -> LiveTelemetryPanelsUpdate {
            LiveTelemetryPanelsUpdate(status: .failed("Network unavailable"))
        }
    }

    @MainActor
    private func ltpPreviewModel(_ update: LiveTelemetryPanelsUpdate?) -> LiveTelemetryPanelsModel {
        let source = InMemoryLiveTelemetryPanelsSource(initial: update)
        let model = LiveTelemetryPanelsModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func ltpPreviewSurface(_ update: LiveTelemetryPanelsUpdate?) -> some View {
        ScrollView {
            LiveTelemetryPanels(model: ltpPreviewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Data") {
        ltpPreviewSurface(LiveTelemetryPanelsPreviewData.loaded())
    }

    #Preview("Loading") {
        ltpPreviewSurface(nil)
    }

    #Preview("Empty") {
        ltpPreviewSurface(LiveTelemetryPanelsPreviewData.empty())
    }

    #Preview("Error") {
        ltpPreviewSurface(LiveTelemetryPanelsPreviewData.failed())
    }

    #Preview("Stale (cached)") {
        ltpPreviewSurface(LiveTelemetryPanelsPreviewData.loaded(connection: .stale))
    }

    #Preview("Offline") {
        ltpPreviewSurface(LiveTelemetryPanelsPreviewData.loaded(connection: .offline))
    }
#endif
