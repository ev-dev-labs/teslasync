//
//  ChargingSection.Previews.swift
//  TeslaSync — P4 feature view · 0074 · ChargingSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated chart +
//  stats + badge), empty (resolved, no charging → web `EmptyState`), loading (initial
//  skeleton chrome), error (fetch failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentChargingTelemetry: ChargingSectionTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample week of charging data for the populated previews.
    private enum ChargingPreviewData {
        static let metrics = ChargingMetrics(
            sessionCount: 9,
            energyAddedKwh: 142.6,
            avgChargeRateKw: 11.2,
            cost: 24.18,
            prevEnergyKwh: 121.4
        )

        static let dailyEnergy: [ChargingDailyEnergy] = [
            ChargingDailyEnergy(day: "Mon", energy: 18.4),
            ChargingDailyEnergy(day: "Tue", energy: 0),
            ChargingDailyEnergy(day: "Wed", energy: 32.1),
            ChargingDailyEnergy(day: "Thu", energy: 11.7),
            ChargingDailyEnergy(day: "Fri", energy: 27.9),
            ChargingDailyEnergy(day: "Sat", energy: 44.2),
            ChargingDailyEnergy(day: "Sun", energy: 8.3)
        ]
    }

    @MainActor
    private func chargingPreview(_ update: ChargingUpdate) -> ChargingSection {
        ChargingSection(
            model: ChargingSectionModel(
                source: InMemoryChargingSource(initial: update),
                telemetry: SilentChargingTelemetry(),
                locale: Locale(identifier: "en_US")
            )
        )
    }

    private func loadedUpdate(connection: ChargingConnection) -> ChargingUpdate {
        ChargingUpdate(
            status: .loaded,
            metrics: ChargingPreviewData.metrics,
            dailyEnergy: ChargingPreviewData.dailyEnergy,
            connection: connection
        )
    }

    #Preview("Content") {
        chargingPreview(loadedUpdate(connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        chargingPreview(ChargingUpdate(status: .loaded, metrics: nil, dailyEnergy: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        chargingPreview(ChargingUpdate(status: .loading, connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        chargingPreview(ChargingUpdate(status: .failed("Request timed out"), connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        chargingPreview(loadedUpdate(connection: .stale))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        chargingPreview(loadedUpdate(connection: .offline))
            .padding()
            .frame(maxWidth: 480)
    }
#endif
