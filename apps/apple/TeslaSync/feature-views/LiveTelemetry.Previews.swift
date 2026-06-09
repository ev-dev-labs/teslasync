//
//  LiveTelemetry.Previews.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline) and the imperial-unit variant. DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum LiveTelemetryPreviewData {
        static let motor = MotorTelemetry(
            torque: 248,
            statorTemp: 47,
            gear: "D",
            lateralAccel: 0.12,
            longitudinalAccel: 0.31
        )
        static let climate = ClimateTelemetry(
            insideTemp: 21,
            outsideTemp: 9,
            hvacPower: 3.4,
            fanSpeed: 4,
            defrostMode: "Front",
            batteryHeaterOn: true
        )
        static let security = LiveSecurityTelemetry(
            locked: true,
            sentryMode: true,
            doorState: "FrontLeftClosed,FrontRightOpen,RearLeftClosed,RearRightClosed",
            frontDriverWindow: "Closed",
            frontPassengerWindow: "Vented",
            rearDriverWindow: "Closed",
            rearPassengerWindow: "Closed"
        )
        static let tire = LiveTirePressureTelemetry(
            frontLeft: 2.62,
            frontRight: 2.58,
            rearLeft: 2.20,
            rearRight: 3.20
        )
        static let media = MediaTelemetry(
            nowPlayingTitle: "Midnight City",
            nowPlayingArtist: "M83",
            playbackStatus: "Playing",
            audioVolume: 7,
            audioVolumeMax: 11
        )
        static let navigation = NavigationTelemetry(
            destinationName: "Supercharger — Mountain View",
            distanceToArrival: 12.4,
            minutesToArrival: 14,
            locatedAtHome: false,
            locatedAtWork: true,
            locatedAtFavorite: false
        )

        static func full(units: LiveTelemetryUnits = .metric) -> LiveTelemetryInput {
            LiveTelemetryInput(
                motor: motor,
                climate: climate,
                security: security,
                tire: tire,
                media: media,
                navigation: navigation,
                units: units
            )
        }
    }

    @MainActor
    private func previewModel(_ input: LiveTelemetryInput) -> LiveTelemetryModel {
        let source = InMemoryLiveTelemetrySource(initial: input)
        let model = LiveTelemetryModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        ScrollView {
            LiveTelemetry(model: previewModel(LiveTelemetryPreviewData.full()))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Imperial") {
        ScrollView {
            LiveTelemetry(model: previewModel(LiveTelemetryPreviewData.full(units: .imperial)))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        LiveTelemetry(model: previewModel(LiveTelemetryInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ScrollView {
            LiveTelemetry(model: previewModel(LiveTelemetryInput(isLoading: true)))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        LiveTelemetry(model: previewModel(LiveTelemetryInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView {
            LiveTelemetry(model: previewModel(LiveTelemetryPreviewData.full().withConnection(.stale)))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView {
            LiveTelemetry(model: previewModel(LiveTelemetryPreviewData.full().withConnection(.offline)))
                .padding()
        }
        .background(Color.TS.bg)
    }

    private extension LiveTelemetryInput {
        func withConnection(_ connection: LiveTelemetryConnection) -> LiveTelemetryInput {
            var copy = self
            copy.connection = connection
            return copy
        }
    }
#endif
