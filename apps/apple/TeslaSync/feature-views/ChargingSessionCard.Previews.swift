//
//  ChargingSessionCard.Previews.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  Xcode previews for each surface state (content / compact / selected / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope. The sample sessions here are shaped
//  like the web `ChargingSession` slice and are reused as the tests' hand fixtures.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative sessions for previews/tests (no network). Values are shaped
    /// like the web `ChargingSession` rows.
    enum ChargingSessionCardSample {
        static func date(_ iso: String) -> Date {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: iso) ?? Date(timeIntervalSince1970: 1_700_000_000)
        }

        /// A paid Supercharger session: low→sweet-spot SoC (A-grade), peak/avg power,
        /// cost, and odometer-derived range gained.
        static let supercharger = ChargingSessionSummary(
            id: 4821,
            chargerType: "Supercharger V3",
            startedAt: date("2026-04-04T14:05:00Z"),
            endedAt: date("2026-04-04T14:41:00Z"),
            totalEnergyAddedWh: 42500,
            peakPowerW: 142_000,
            avgPowerW: 70800,
            costDecimal: 13.60,
            startSocPct: 18,
            endSocPct: 72,
            odometerStartM: 30_120_000,
            odometerEndM: 30_320_000,
            startPlace: "Mountain View Supercharger",
            startLat: 37.4002,
            startLng: -122.078
        )

        /// A free overnight home/AC session — no cost, gentle SoC swing.
        static let home = ChargingSessionSummary(
            id: 4822,
            chargerType: "Home Wall Connector",
            startedAt: date("2026-04-03T23:30:00Z"),
            endedAt: date("2026-04-04T05:10:00Z"),
            totalEnergyAddedWh: 31200,
            peakPowerW: 11000,
            avgPowerW: 5500,
            costDecimal: nil,
            startSocPct: 42,
            endSocPct: 80,
            odometerStartM: nil,
            odometerEndM: nil,
            startPlace: "Home",
            startLat: 37.3349,
            startLng: -122.009
        )

        @MainActor
        static func model(
            _ update: ChargingSessionCardUpdate,
            formatting: any ChargingSessionCardFormatting = DefaultChargingSessionCardFormatting()
        ) -> ChargingSessionCardModel {
            let source = InMemoryChargingSessionCardSource(initial: update)
            let model = ChargingSessionCardModel(source: source, formatting: formatting)
            model.start()
            return model
        }

        static func shell(_ card: ChargingSessionCard) -> some View {
            ScrollView {
                card.padding(TSSpacing.lg)
            }
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
        }
    }

    #Preview("Content · Supercharger (selectable)") {
        ChargingSessionCardSample.shell(
            ChargingSessionCard(
                model: ChargingSessionCardSample.model(
                    ChargingSessionCardUpdate(
                        status: .loaded,
                        session: ChargingSessionCardSample.supercharger,
                        selectable: true,
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Content · Home (free, with anomaly)") {
        ChargingSessionCardSample.shell(
            ChargingSessionCard(
                model: ChargingSessionCardSample.model(
                    ChargingSessionCardUpdate(
                        status: .loaded,
                        session: ChargingSessionCardSample.home,
                        anomaly: ChargingAnomalyInfo(message: "Slow charge"),
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Compact density") {
        ChargingSessionCardSample.shell(
            ChargingSessionCard(
                model: ChargingSessionCardSample.model(
                    ChargingSessionCardUpdate(
                        status: .loaded,
                        session: ChargingSessionCardSample.supercharger,
                        density: .compact,
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Selected") {
        ChargingSessionCardSample.shell(
            ChargingSessionCard(
                model: ChargingSessionCardSample.model(
                    ChargingSessionCardUpdate(
                        status: .loaded,
                        session: ChargingSessionCardSample.supercharger,
                        selected: true,
                        selectable: true,
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Empty") {
        ChargingSessionCardSample.shell(
            ChargingSessionCard(
                model: ChargingSessionCardSample.model(ChargingSessionCardUpdate(status: .empty))
            )
        )
    }

    #Preview("Loading") {
        ChargingSessionCardSample.shell(
            ChargingSessionCard(
                model: ChargingSessionCardSample.model(ChargingSessionCardUpdate(status: .loading))
            )
        )
    }

    #Preview("Error") {
        ChargingSessionCardSample.shell(
            ChargingSessionCard(
                model: ChargingSessionCardSample
                    .model(ChargingSessionCardUpdate(status: .failed("Network unavailable")))
            )
        )
    }

    #Preview("Stale (cached)") {
        ChargingSessionCardSample.shell(
            ChargingSessionCard(
                model: ChargingSessionCardSample.model(
                    ChargingSessionCardUpdate(
                        status: .loaded,
                        connection: .stale,
                        session: ChargingSessionCardSample.supercharger,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        ChargingSessionCardSample.shell(
            ChargingSessionCard(
                model: ChargingSessionCardSample.model(
                    ChargingSessionCardUpdate(
                        status: .loaded,
                        connection: .offline,
                        session: ChargingSessionCardSample.home,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
