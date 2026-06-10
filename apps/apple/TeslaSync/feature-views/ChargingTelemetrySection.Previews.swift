//
//  ChargingTelemetrySection.Previews.swift
//  TeslaSync — P4 feature view · 0290 · ChargingTelemetrySection (Apple)
//
//  Xcode previews — one per state the surface produces: data (the populated eight-tile
//  grid), empty (telemetry resolved as null → web `EmptyState`), loading (initial
//  skeleton grid), error (fetch failed → retry), and the stale / offline freshness
//  variants. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    /// A no-op diagnostics sink so previews don't emit `view.opened`.
    private struct SilentChargingTelemetryDiagnostics: ChargingTelemetrySectionDiagnostics {
        func viewOpened(surface _: String) {}
    }

    /// Sample charging telemetry for the populated previews — all SI on the wire.
    private enum ChargingTelemetryPreviewData {
        static let sample = ChargingTelemetrySectionData(
            chargerPowerW: 11000,
            chargerVoltage: 232.4,
            chargerActualCurrent: 47.8,
            chargeEnergyAddedWh: 18450,
            chargingState: "Charging",
            batteryLevel: 72,
            rangeAddedMetersPerHour: 48280,
            rangeAddedMeters: 32180
        )
    }

    @MainActor
    private func chargingTelemetryPreview(_ input: ChargingTelemetrySectionInput) -> ChargingTelemetrySection {
        ChargingTelemetrySection(
            model: ChargingTelemetrySectionModel(
                source: InMemoryChargingTelemetrySectionSource(initial: input),
                diagnostics: SilentChargingTelemetryDiagnostics()
            )
        )
    }

    private func loadedInput(connection: ChargingTelemetrySectionConnection) -> ChargingTelemetrySectionInput {
        ChargingTelemetrySectionInput(
            data: ChargingTelemetryPreviewData.sample,
            prefs: ChargingTelemetrySectionUnitPrefs(localeIdentifier: "en-US"),
            connection: connection
        )
    }

    #Preview("Data") {
        chargingTelemetryPreview(loadedInput(connection: .live))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        chargingTelemetryPreview(ChargingTelemetrySectionInput(data: nil))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        chargingTelemetryPreview(ChargingTelemetrySectionInput(isLoading: true))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        chargingTelemetryPreview(ChargingTelemetrySectionInput(errorMessage: "Network request timed out"))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        chargingTelemetryPreview(loadedInput(connection: .stale))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        chargingTelemetryPreview(loadedInput(connection: .offline))
            .padding()
            .background(Color.TS.bg)
    }
#endif
