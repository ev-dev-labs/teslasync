//
//  BatteryRangeCharts.Previews.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  Xcode previews — one per state the surface produces: content (populated battery gauge +
//  Current/Remaining bars + a multi-drive distance/duration trend), no-drives (the Battery
//  Overview renders, the Drive Distance Trend falls back to its "No drive data for chart" leaf),
//  empty (resolved, no vehicle-state snapshot → surface-level empty), loading (initial skeleton
//  chrome), error (fetch failed → retry), and the stale / offline freshness variants.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentBatteryRangeChartsTelemetry: BatteryRangeChartsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Realistic sample state + a week of drives for the populated previews.
    private enum BatteryRangeChartsPreviewData {
        static let state = BatteryRangeChartsState(batteryLevel: 72, ratedRangeMeters: 412_000)

        static let drives: [BatteryRangeChartsDrive] = {
            let day: TimeInterval = 86400
            let base = Date(timeIntervalSince1970: 1_718_000_000)
            let samples: [(Double, Double)] = [
                (42000, 2880), (18500, 1500), (63200, 4200),
                (9800, 900), (37400, 2640), (51900, 3600)
            ]
            return samples.enumerated().map { index, sample in
                BatteryRangeChartsDrive(
                    id: "drive-\(index)",
                    startTimestamp: base.addingTimeInterval(-Double(index) * day),
                    distanceMeters: sample.0,
                    durationSeconds: sample.1
                )
            }
        }()
    }

    @MainActor
    private func batteryRangeChartsPreview(_ update: BatteryRangeChartsUpdate) -> BatteryRangeCharts {
        BatteryRangeCharts(
            model: BatteryRangeChartsModel(
                source: InMemoryBatteryRangeChartsSource(initial: update),
                telemetry: SilentBatteryRangeChartsTelemetry()
            )
        )
    }

    #Preview("Content") {
        ScrollView {
            batteryRangeChartsPreview(
                BatteryRangeChartsUpdate(
                    status: .loaded,
                    snapshot: BatteryRangeChartsSnapshot(
                        state: BatteryRangeChartsPreviewData.state,
                        drives: BatteryRangeChartsPreviewData.drives
                    )
                )
            )
            .padding()
        }
    }

    #Preview("No drives") {
        batteryRangeChartsPreview(
            BatteryRangeChartsUpdate(
                status: .loaded,
                snapshot: BatteryRangeChartsSnapshot(state: BatteryRangeChartsPreviewData.state, drives: [])
            )
        )
        .padding()
    }

    #Preview("Empty") {
        batteryRangeChartsPreview(BatteryRangeChartsUpdate(status: .loaded, snapshot: nil))
            .padding()
    }

    #Preview("Loading") {
        batteryRangeChartsPreview(BatteryRangeChartsUpdate(status: .loading, snapshot: nil))
            .padding()
    }

    #Preview("Error") {
        batteryRangeChartsPreview(
            BatteryRangeChartsUpdate(status: .failed("Request timed out"), snapshot: nil)
        )
        .padding()
    }

    #Preview("Stale") {
        ScrollView {
            batteryRangeChartsPreview(
                BatteryRangeChartsUpdate(
                    status: .loaded,
                    connection: .stale,
                    snapshot: BatteryRangeChartsSnapshot(
                        state: BatteryRangeChartsPreviewData.state,
                        drives: BatteryRangeChartsPreviewData.drives
                    )
                )
            )
            .padding()
        }
    }

    #Preview("Offline") {
        ScrollView {
            batteryRangeChartsPreview(
                BatteryRangeChartsUpdate(
                    status: .loaded,
                    connection: .offline,
                    snapshot: BatteryRangeChartsSnapshot(
                        state: BatteryRangeChartsPreviewData.state,
                        drives: BatteryRangeChartsPreviewData.drives
                    )
                )
            )
            .padding()
        }
    }
#endif
