//
//  DriveOverviewChart.Previews.swift
//  TeslaSync — P4 feature view · 0138 · DriveOverviewChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (composed trace +
//  legend), empty (resolved, ≤ 1 sample → friendly state), loading (initial skeleton
//  chrome), error (fetch failed → retry), and the stale / offline freshness variants.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentDriveOverviewTelemetry: DriveOverviewTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A synthetic drive trace: speed ramps + cruises, SOC + range drift down, power
    /// swings positive (accel) and negative (regen), plus a usable-SOC track.
    private enum DriveOverviewPreviewData {
        static let units = DriveUnitLabels.of(.imperial)

        static let samples: [DriveChartSample] = (0 ..< 48).map { step in
            let phase = Double(step) / 48
            let speed = 18 + 44 * sin(Double(step) / 6) * 0.5 + 22 * phase
            let power = 60 * sin(Double(step) / 4) - 8
            let battery = 86 - 24 * phase
            return DriveChartSample(
                index: step,
                time: String(format: "%02d:%02d", 8 + step / 12, (step * 5) % 60),
                speed: max(0, speed),
                battery: battery,
                power: power,
                idealRange: 252 - 70 * phase,
                ratedRange: 240 - 68 * phase,
                estRange: 233 - 66 * phase,
                usableSoc: max(0, battery - 2.5)
            )
        }
    }

    @MainActor
    private func driveOverviewPreview(_ update: DriveOverviewUpdate) -> DriveOverviewChart {
        DriveOverviewChart(
            model: DriveOverviewChartModel(
                source: InMemoryDriveOverviewSource(initial: update),
                telemetry: SilentDriveOverviewTelemetry(),
                locale: Locale(identifier: "en_US")
            )
        )
    }

    #Preview("Content") {
        driveOverviewPreview(
            DriveOverviewUpdate(
                status: .loaded,
                samples: DriveOverviewPreviewData.samples,
                units: DriveOverviewPreviewData.units,
                connection: .live
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Empty") {
        driveOverviewPreview(
            DriveOverviewUpdate(status: .loaded, samples: [], units: DriveOverviewPreviewData.units)
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Loading") {
        driveOverviewPreview(DriveOverviewUpdate(status: .loading, samples: []))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Error") {
        driveOverviewPreview(DriveOverviewUpdate(status: .failed("Request timed out"), samples: []))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Stale") {
        driveOverviewPreview(
            DriveOverviewUpdate(
                status: .loaded,
                samples: DriveOverviewPreviewData.samples,
                units: DriveOverviewPreviewData.units,
                connection: .stale
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Offline") {
        driveOverviewPreview(
            DriveOverviewUpdate(
                status: .loaded,
                samples: DriveOverviewPreviewData.samples,
                units: DriveOverviewPreviewData.units,
                connection: .offline
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }
#endif
