//
//  TripReplayMap.Previews.swift
//  TeslaSync — P4 feature view · 0274 · TripReplayMap (Apple)
//
//  Xcode previews for each surface state (route / stationary-GPS / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. The sample drive here is shaped like the web
//  `TripReplayMap` props (a `positions` array + a `currentIndex`) and is reused as the
//  tests' hand fixtures.
//

import Foundation
import SwiftUI

#if DEBUG
    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTripReplayMapTelemetry: TripReplayMapTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A representative short San Francisco drive, shaped like the web `TripReplayMap`
    /// props. Reused by previews + tests.
    enum TripReplayMapSample {
        /// A six-sample route that varies enough to be "meaningful" (≥ 10 m), with a
        /// range of speeds so every band colors a segment.
        static let route: [TripReplayPosition] = [
            TripReplayPosition(latitude: 37.7749, longitude: -122.4194, speed: 0),
            TripReplayPosition(latitude: 37.7769, longitude: -122.4181, speed: 25),
            TripReplayPosition(latitude: 37.7799, longitude: -122.4155, speed: 48),
            TripReplayPosition(latitude: 37.7841, longitude: -122.4119, speed: 72),
            TripReplayPosition(latitude: 37.7894, longitude: -122.4078, speed: 105),
            TripReplayPosition(latitude: 37.7939, longitude: -122.4032, speed: 60)
        ]

        /// A stationary capture: many odometer/speed samples but a single frozen fix
        /// (web stationary-GPS case → the anchor + "Route can't be plotted" banner).
        static let stationary: [TripReplayPosition] = Array(
            repeating: TripReplayPosition(latitude: 37.7749, longitude: -122.4194, speed: 0),
            count: 8
        )

        @MainActor
        static func model(_ input: TripReplayMapInput) -> TripReplayMapModel {
            let source = InMemoryTripReplayMapSource(initial: input)
            let model = TripReplayMapModel(source: source, telemetry: SilentTripReplayMapTelemetry())
            model.start()
            return model
        }

        static func shell(_ map: TripReplayMap) -> some View {
            ScrollView {
                map.padding(TSSpacing.lg)
            }
            .frame(maxWidth: 640)
            .background(Color.TS.bg)
        }

        static func loaded(
            positions: [TripReplayPosition] = route,
            currentIndex: Int = 2,
            connection: TripReplayMapConnection = .live,
            isFetching: Bool = false
        ) -> TripReplayMapInput {
            TripReplayMapInput(
                status: .loaded,
                positions: positions,
                currentIndex: currentIndex,
                connection: connection,
                isFetching: isFetching,
                updatedAt: Date()
            )
        }
    }

    #Preview("Content · route") {
        TripReplayMapSample.shell(
            TripReplayMap(model: TripReplayMapSample.model(TripReplayMapSample.loaded()))
        )
    }

    #Preview("Content · stationary GPS") {
        TripReplayMapSample.shell(
            TripReplayMap(
                model: TripReplayMapSample.model(TripReplayMapSample.loaded(positions: TripReplayMapSample.stationary))
            )
        )
    }

    #Preview("Empty · no positions") {
        TripReplayMapSample.shell(
            TripReplayMap(model: TripReplayMapSample.model(TripReplayMapInput(status: .loaded)))
        )
    }

    #Preview("Loading") {
        TripReplayMapSample.shell(
            TripReplayMap(model: TripReplayMapSample.model(TripReplayMapInput(status: .loading)))
        )
    }

    #Preview("Error") {
        TripReplayMapSample.shell(
            TripReplayMap(
                model: TripReplayMapSample.model(TripReplayMapInput(status: .failed("Network unavailable")))
            )
        )
    }

    #Preview("Stale (cached)") {
        TripReplayMapSample.shell(
            TripReplayMap(model: TripReplayMapSample.model(TripReplayMapSample.loaded(connection: .stale)))
        )
    }

    #Preview("Offline (cached)") {
        TripReplayMapSample.shell(
            TripReplayMap(model: TripReplayMapSample.model(TripReplayMapSample.loaded(connection: .offline)))
        )
    }
#endif
