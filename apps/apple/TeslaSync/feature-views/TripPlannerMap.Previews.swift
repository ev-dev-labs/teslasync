//
//  TripPlannerMap.Previews.swift
//  TeslaSync — P4 feature view · 0178 · TripPlannerMap (Apple)
//
//  Xcode previews for each surface state (content route / single endpoint / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope. The sample trip here is shaped like the
//  web `TripPlannerMap` props and is reused as the tests' hand fixtures.
//

import Foundation
import SwiftUI

#if DEBUG
    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTripPlannerMapTelemetry: TripPlannerMapTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A representative San Francisco → Los Angeles plan with two charge stops, shaped
    /// like the web `TripPlannerMap` props. Reused by previews + tests.
    enum TripPlannerMapSample {
        static let sanFrancisco = TripPlannerLocation(
            latitude: 37.7749,
            longitude: -122.4194,
            name: "San Francisco, CA"
        )
        static let losAngeles = TripPlannerLocation(latitude: 34.0522, longitude: -118.2437, name: "Los Angeles, CA")
        static let harrisRanch = TripPlannerLocation(latitude: 36.2519, longitude: -120.237, name: "Harris Ranch")
        static let kettleman = TripPlannerLocation(latitude: 35.9966, longitude: -119.9558, name: "Kettleman City")

        static let legs: [TripPlannerLeg] = [
            TripPlannerLeg(from: sanFrancisco, to: harrisRanch),
            TripPlannerLeg(from: harrisRanch, to: kettleman),
            TripPlannerLeg(from: kettleman, to: losAngeles)
        ]

        static let chargeStops: [TripPlannerChargeStop] = [
            TripPlannerChargeStop(
                name: "Harris Ranch Supercharger",
                location: harrisRanch,
                chargeFromSoc: 18,
                chargeToSoc: 80,
                chargeDurationS: 1800
            ),
            TripPlannerChargeStop(
                name: "Kettleman City Supercharger",
                location: kettleman,
                chargeFromSoc: 22,
                chargeToSoc: 75,
                chargeDurationS: 1500
            )
        ]

        @MainActor
        static func model(_ update: TripPlannerMapUpdate) -> TripPlannerMapModel {
            let source = InMemoryTripPlannerMapSource(initial: update)
            let model = TripPlannerMapModel(source: source, telemetry: SilentTripPlannerMapTelemetry())
            model.start()
            return model
        }

        static func shell(_ map: TripPlannerMap) -> some View {
            ScrollView {
                map.padding(TSSpacing.lg)
            }
            .frame(maxWidth: 640)
            .background(Color.TS.bg)
        }

        static func fullPlan(
            status: TripPlannerMapLoadStatus = .loaded,
            connection: TripPlannerMapConnection = .live,
            updatedAt: Date? = Date()
        ) -> TripPlannerMapUpdate {
            TripPlannerMapUpdate(
                status: status,
                origin: sanFrancisco,
                destination: losAngeles,
                legs: legs,
                chargeStops: chargeStops,
                connection: connection,
                updatedAt: updatedAt
            )
        }
    }

    #Preview("Content · full route") {
        TripPlannerMapSample.shell(
            TripPlannerMap(model: TripPlannerMapSample.model(TripPlannerMapSample.fullPlan()))
        )
    }

    #Preview("Content · origin only") {
        TripPlannerMapSample.shell(
            TripPlannerMap(
                model: TripPlannerMapSample.model(
                    TripPlannerMapUpdate(
                        status: .loaded,
                        origin: TripPlannerMapSample.sanFrancisco,
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Empty · no endpoints") {
        TripPlannerMapSample.shell(
            TripPlannerMap(model: TripPlannerMapSample.model(TripPlannerMapUpdate(status: .loaded)))
        )
    }

    #Preview("Loading") {
        TripPlannerMapSample.shell(
            TripPlannerMap(model: TripPlannerMapSample.model(TripPlannerMapUpdate(status: .loading)))
        )
    }

    #Preview("Error") {
        TripPlannerMapSample.shell(
            TripPlannerMap(
                model: TripPlannerMapSample.model(TripPlannerMapUpdate(status: .failed("Network unavailable")))
            )
        )
    }

    #Preview("Stale (cached)") {
        TripPlannerMapSample.shell(
            TripPlannerMap(
                model: TripPlannerMapSample.model(
                    TripPlannerMapSample.fullPlan(connection: .stale, updatedAt: Date().addingTimeInterval(-180))
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        TripPlannerMapSample.shell(
            TripPlannerMap(
                model: TripPlannerMapSample.model(
                    TripPlannerMapSample.fullPlan(connection: .offline, updatedAt: Date().addingTimeInterval(-600))
                )
            )
        )
    }
#endif
