//
//  PowerProfileChart.Previews.swift
//  TeslaSync — P4 feature view · 0146 · PowerProfileChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (amber trace + footer),
//  empty (resolved, ≤ 1 sample → friendly state), loading (initial skeleton chrome), error
//  (fetch failed → retry), and the stale / offline freshness variants. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentPowerProfileTelemetry: PowerProfileTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A synthetic power trace: power swings positive (acceleration) and negative
    /// (regeneration) as the drive cruises, with a couple of hard regen dips.
    private enum PowerProfilePreviewData {
        static let samples: [PowerProfileSample] = (0 ..< 56).map { step in
            let base = 70 * sin(Double(step) / 5)
            let regenDip = (step % 14 == 0) ? -38.0 : 0
            return PowerProfileSample(
                index: step,
                time: String(format: "%02d:%02d", 9 + step / 12, (step * 5) % 60),
                power: base + regenDip - 6
            )
        }

        static var stats: PowerProfileStats {
            PowerProfileProjection.stats(from: samples)
        }
    }

    @MainActor
    private func powerProfilePreview(_ update: PowerProfileUpdate) -> PowerProfileChart {
        PowerProfileChart(
            model: PowerProfileChartModel(
                source: InMemoryPowerProfileSource(initial: update),
                telemetry: SilentPowerProfileTelemetry(),
                locale: Locale(identifier: "en_US")
            )
        )
    }

    #Preview("Content") {
        powerProfilePreview(
            PowerProfileUpdate(
                status: .loaded,
                samples: PowerProfilePreviewData.samples,
                stats: PowerProfilePreviewData.stats,
                connection: .live
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Empty") {
        powerProfilePreview(PowerProfileUpdate(status: .loaded, samples: []))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Loading") {
        powerProfilePreview(PowerProfileUpdate(status: .loading, samples: []))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Error") {
        powerProfilePreview(PowerProfileUpdate(status: .failed("Request timed out"), samples: []))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Stale") {
        powerProfilePreview(
            PowerProfileUpdate(
                status: .loaded,
                samples: PowerProfilePreviewData.samples,
                stats: PowerProfilePreviewData.stats,
                connection: .stale
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Offline") {
        powerProfilePreview(
            PowerProfileUpdate(
                status: .loaded,
                samples: PowerProfilePreviewData.samples,
                stats: PowerProfilePreviewData.stats,
                connection: .offline
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }
#endif
