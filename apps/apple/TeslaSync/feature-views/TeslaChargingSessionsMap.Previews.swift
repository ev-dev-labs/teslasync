//
//  TeslaChargingSessionsMap.Previews.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  Xcode previews for each surface state (content / single / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope. The sample sessions here are shaped like the
//  web `TeslaChargingSession` slice and are reused as the tests' hand fixtures.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative sessions for previews/tests (no network). Values are shaped
    /// like the web `TeslaChargingSession` rows.
    enum TeslaChargingSessionsMapSample {
        static func date(_ iso: String) -> Date {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: iso) ?? Date(timeIntervalSince1970: 1_700_000_000)
        }

        /// A paid Supercharger session with a known location.
        static let supercharger = TeslaChargingSessionRecord(
            id: 4821,
            siteLocationName: "Mountain View Supercharger",
            startedAt: date("2026-04-04T14:05:00Z"),
            totalEnergyAddedWh: 42500,
            totalCost: 13.60,
            chargerType: "Supercharger V3",
            latitude: 37.4002,
            longitude: -122.078
        )

        /// A free overnight home/AC session with a known location.
        static let home = TeslaChargingSessionRecord(
            id: 4822,
            siteLocationName: "Home Wall Connector",
            startedAt: date("2026-04-03T23:30:00Z"),
            totalEnergyAddedWh: 31200,
            totalCost: nil,
            chargerType: "Home Wall Connector",
            latitude: 37.3349,
            longitude: -122.009
        )

        /// A DC fast session in a different metro (frames the camera wider).
        static let fast = TeslaChargingSessionRecord(
            id: 4823,
            siteLocationName: "Harris Ranch CCS",
            startedAt: date("2026-04-02T09:12:00Z"),
            totalEnergyAddedWh: 58000,
            totalCost: 21.40,
            chargerType: "CCS",
            latitude: 36.2519,
            longitude: -120.237
        )

        /// A session with no location (filtered out of the plotted markers).
        static let noCoords = TeslaChargingSessionRecord(
            id: 4824,
            siteLocationName: "",
            startedAt: date("2026-04-01T18:00:00Z"),
            totalEnergyAddedWh: 12000,
            totalCost: 4.10,
            chargerType: nil,
            latitude: nil,
            longitude: nil
        )

        static let all: [TeslaChargingSessionRecord] = [supercharger, home, fast]

        @MainActor
        static func model(_ update: TeslaChargingSessionsMapUpdate) -> TeslaChargingSessionsMapModel {
            let source = InMemoryTeslaChargingSessionsMapSource(initial: update)
            let model = TeslaChargingSessionsMapModel(source: source)
            model.start()
            return model
        }

        static func shell(_ map: TeslaChargingSessionsMap) -> some View {
            ScrollView {
                map.padding(TSSpacing.lg)
            }
            .frame(maxWidth: 640)
            .background(Color.TS.bg)
        }
    }

    #Preview("Content · multiple sites") {
        TeslaChargingSessionsMapSample.shell(
            TeslaChargingSessionsMap(
                model: TeslaChargingSessionsMapSample.model(
                    TeslaChargingSessionsMapUpdate(
                        status: .loaded,
                        sessions: TeslaChargingSessionsMapSample.all,
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Content · single free home") {
        TeslaChargingSessionsMapSample.shell(
            TeslaChargingSessionsMap(
                model: TeslaChargingSessionsMapSample.model(
                    TeslaChargingSessionsMapUpdate(
                        status: .loaded,
                        sessions: [TeslaChargingSessionsMapSample.home],
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Empty · no plottable sessions") {
        TeslaChargingSessionsMapSample.shell(
            TeslaChargingSessionsMap(
                model: TeslaChargingSessionsMapSample.model(
                    TeslaChargingSessionsMapUpdate(status: .loaded, sessions: [TeslaChargingSessionsMapSample.noCoords])
                )
            )
        )
    }

    #Preview("Loading") {
        TeslaChargingSessionsMapSample.shell(
            TeslaChargingSessionsMap(
                model: TeslaChargingSessionsMapSample.model(TeslaChargingSessionsMapUpdate(status: .loading))
            )
        )
    }

    #Preview("Error") {
        TeslaChargingSessionsMapSample.shell(
            TeslaChargingSessionsMap(
                model: TeslaChargingSessionsMapSample
                    .model(TeslaChargingSessionsMapUpdate(status: .failed("Network unavailable")))
            )
        )
    }

    #Preview("Stale (cached)") {
        TeslaChargingSessionsMapSample.shell(
            TeslaChargingSessionsMap(
                model: TeslaChargingSessionsMapSample.model(
                    TeslaChargingSessionsMapUpdate(
                        status: .loaded,
                        connection: .stale,
                        sessions: TeslaChargingSessionsMapSample.all,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        TeslaChargingSessionsMapSample.shell(
            TeslaChargingSessionsMap(
                model: TeslaChargingSessionsMapSample.model(
                    TeslaChargingSessionsMapUpdate(
                        status: .loaded,
                        connection: .offline,
                        sessions: [TeslaChargingSessionsMapSample.supercharger, TeslaChargingSessionsMapSample.home],
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
