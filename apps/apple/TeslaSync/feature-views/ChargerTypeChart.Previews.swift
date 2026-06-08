//
//  ChargerTypeChart.Previews.swift
//  TeslaSync — P4 feature view · 0087 · ChargerTypeChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  clustered chart + breakdown + table), empty (resolved, no sessions → web empty
//  branch), loading (initial skeleton chrome), error (fetch failed → retry), and the
//  stale / offline freshness variants. Preview-only; excluded from release builds
//  via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentChargerTypeTelemetry: ChargerTypeChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample charging sessions spanning all three charger types for the populated
    /// previews (Supercharger via "Tesla", DC Fast via a third-party network, Home /
    /// AC via a low-power untyped session).
    private enum ChargerTypePreviewData {
        static let reference = Date(timeIntervalSince1970: 1_770_000_000)

        static func session(
            _ charger: String?,
            _ peakW: Double?,
            _ energyWh: Double,
            _ minutes: Double
        ) -> ChargingSessionInput {
            ChargingSessionInput(
                chargerType: charger,
                peakPowerW: peakW,
                totalEnergyAddedWh: energyWh,
                startedAt: reference,
                endedAt: reference.addingTimeInterval(minutes * 60)
            )
        }

        static let sessions: [ChargingSessionInput] = [
            session("Tesla", 150_000, 52000, 28),
            session("Tesla", 168_000, 61000, 24),
            session("EVgo", 50000, 44000, 41),
            session("Electrify America", 62000, 48000, 38),
            session(nil, 7400, 31000, 320),
            session(nil, 11000, 42000, 240)
        ]
    }

    @MainActor
    private func chargerTypePreview(_ update: ChargerTypeUpdate) -> ChargerTypeChart {
        ChargerTypeChart(
            model: ChargerTypeChartModel(
                source: InMemoryChargerTypeSource(initial: update),
                telemetry: SilentChargerTypeTelemetry()
            )
        )
    }

    #Preview("Content") {
        chargerTypePreview(
            ChargerTypeUpdate(status: .loaded, sessions: ChargerTypePreviewData.sessions, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        chargerTypePreview(ChargerTypeUpdate(status: .loaded, sessions: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        chargerTypePreview(ChargerTypeUpdate(status: .loading, sessions: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        chargerTypePreview(
            ChargerTypeUpdate(status: .failed("Request timed out"), sessions: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        chargerTypePreview(
            ChargerTypeUpdate(status: .loaded, sessions: ChargerTypePreviewData.sessions, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        chargerTypePreview(
            ChargerTypeUpdate(status: .loaded, sessions: ChargerTypePreviewData.sessions, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
