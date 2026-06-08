//
//  MotorHistoryCharts.Previews.swift
//  TeslaSync — P4 feature view · 0172 · MotorHistoryCharts (Apple)
//
//  Xcode previews — one per state the surface produces: content (populated
//  power/torque/rpm traces), empty (resolved, no samples → web `EmptyState`),
//  loading (initial skeleton chrome), error (fetch failed → retry), and the
//  stale / offline freshness variants. Preview-only; excluded from release builds
//  via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentMotorHistoryChartsTelemetry: MotorHistoryChartsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A realistic short drive: a throttle pull with intermittent regen on lift-off,
    /// correlated front/rear torque, and motor rpm rising with road speed.
    private enum MotorHistoryChartsPreviewData {
        static let samples: [MotorHistoryChartsSample] = {
            let formatter = ISO8601DateFormatter()
            let base = Date(timeIntervalSince1970: 1_700_000_000)
            return (0 ..< 24).map { index in
                let time = base.addingTimeInterval(Double(index) * 5)
                let phase = Double(index)
                let drive = max(0, 90 + 70 * sin(phase / 3.2))
                let regen = max(0, 45 * sin(phase / 2.6 + .pi))
                return MotorHistoryChartsSample(
                    timestamp: formatter.string(from: time),
                    powerKw: drive > 4 ? drive : nil,
                    regenKw: regen > 2 ? regen : nil,
                    torqueFront: 210 + 120 * sin(phase / 4),
                    torqueRear: 190 + 110 * cos(phase / 5),
                    rpmFront: 4200 + 2600 * sin(phase / 3),
                    rpmRear: 4400 + 2400 * cos(phase / 4)
                )
            }
        }()
    }

    @MainActor
    private func motorHistoryPreview(_ update: MotorHistoryChartsUpdate) -> some View {
        ScrollView {
            MotorHistoryCharts(
                model: MotorHistoryChartsModel(
                    source: InMemoryMotorHistoryChartsSource(initial: update),
                    telemetry: SilentMotorHistoryChartsTelemetry()
                )
            )
            .padding()
            .frame(maxWidth: 560)
        }
    }

    #Preview("Content") {
        motorHistoryPreview(
            MotorHistoryChartsUpdate(
                status: .loaded,
                samples: MotorHistoryChartsPreviewData.samples,
                connection: .live
            )
        )
    }

    #Preview("Empty") {
        motorHistoryPreview(MotorHistoryChartsUpdate(status: .loaded, samples: [], connection: .live))
    }

    #Preview("Loading") {
        motorHistoryPreview(MotorHistoryChartsUpdate(status: .loading, samples: [], connection: .live))
    }

    #Preview("Error") {
        motorHistoryPreview(
            MotorHistoryChartsUpdate(status: .failed("Request timed out"), samples: [], connection: .live)
        )
    }

    #Preview("Stale") {
        motorHistoryPreview(
            MotorHistoryChartsUpdate(
                status: .loaded,
                samples: MotorHistoryChartsPreviewData.samples,
                connection: .stale
            )
        )
    }

    #Preview("Offline") {
        motorHistoryPreview(
            MotorHistoryChartsUpdate(
                status: .loaded,
                samples: MotorHistoryChartsPreviewData.samples,
                connection: .offline
            )
        )
    }
#endif
