//
//  BatteryComparison.Previews.swift
//  TeslaSync — P4 feature view · 0275 · BatteryComparison (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated fleet with mixed
//  charge levels), empty (resolved, no vehicle state → friendly empty surface), loading (initial
//  skeleton chrome), error (fetch failed → retry), and the stale / offline freshness variants.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentBatteryComparisonTelemetry: BatteryComparisonTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A realistic mixed fleet: a healthy car, a mid-charge car, a low car (red, VIN fallback), and
    /// a near-full truck — exercising every battery tint + the `display_name || vin` fallback.
    private enum BatteryComparisonPreviewData {
        static let entries: [BatteryComparisonEntry] = [
            entry(id: 1, name: "Model 3", vin: "5YJ3E1EA0001", level: 82, rangeMeters: 380_000),
            entry(id: 2, name: "Model Y", vin: "5YJYGDEE1002", level: 47, rangeMeters: 214_000),
            entry(id: 3, name: "", vin: "5YJSA1E40003", level: 18, rangeMeters: 96000),
            entry(id: 4, name: "Cybertruck", vin: "7G2CE1ED0004", level: 64, rangeMeters: 505_000)
        ]

        private static func entry(
            id: Int,
            name: String,
            vin: String,
            level: Double,
            rangeMeters: Double
        ) -> BatteryComparisonEntry {
            BatteryComparisonEntry(
                vehicle: BatteryComparisonVehicle(id: id, displayName: name, vin: vin),
                state: BatteryComparisonVehicleState(batteryLevel: level, ratedRange: rangeMeters)
            )
        }
    }

    @MainActor
    private func batteryComparisonPreview(_ update: BatteryComparisonUpdate) -> BatteryComparison {
        BatteryComparison(
            model: BatteryComparisonModel(
                source: InMemoryBatteryComparisonSource(initial: update),
                telemetry: SilentBatteryComparisonTelemetry()
            )
        )
    }

    #Preview("Content") {
        batteryComparisonPreview(
            BatteryComparisonUpdate(status: .loaded, entries: BatteryComparisonPreviewData.entries, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        batteryComparisonPreview(BatteryComparisonUpdate(status: .loaded, entries: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        batteryComparisonPreview(BatteryComparisonUpdate(status: .loading, entries: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        batteryComparisonPreview(
            BatteryComparisonUpdate(status: .failed("Request timed out"), entries: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        batteryComparisonPreview(
            BatteryComparisonUpdate(status: .loaded, entries: BatteryComparisonPreviewData.entries, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        batteryComparisonPreview(
            BatteryComparisonUpdate(
                status: .loaded,
                entries: BatteryComparisonPreviewData.entries,
                connection: .offline
            )
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
