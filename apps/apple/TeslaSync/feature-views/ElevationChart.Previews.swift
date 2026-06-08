//
//  ElevationChart.Previews.swift
//  TeslaSync — P4 feature view · 0141 · ElevationChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  area+line trace with the gain/loss/net header + legend), empty (resolved, no
//  trace → web "No telemetry data available" branch), loading (initial skeleton
//  chrome), error (fetch failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentElevationTelemetry: ElevationChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A rolling drive trace climbing a ridge and descending the far side, with
    /// speed easing through the bends — enough samples to exercise the area, the
    /// projected speed line, both axes, and the gain/loss/net header.
    private enum ElevationPreviewData {
        static func sample(_ index: Int, _ elevationM: Double, _ speedMps: Double, _ time: String) -> ElevationSample {
            ElevationSample(index: index, time: time, elevationM: elevationM, speedMps: speedMps)
        }

        static let samples: [ElevationSample] = [
            sample(0, 48, 0, "09:00"),
            sample(1, 63, 12.5, "09:04"),
            sample(2, 91, 18.0, "09:08"),
            sample(3, 128, 22.4, "09:12"),
            sample(4, 176, 16.7, "09:16"),
            sample(5, 214, 9.2, "09:20"),
            sample(6, 248, 6.1, "09:24"),
            sample(7, 233, 14.8, "09:28"),
            sample(8, 197, 23.6, "09:32"),
            sample(9, 152, 27.9, "09:36"),
            sample(10, 118, 21.3, "09:40"),
            sample(11, 86, 12.0, "09:44"),
            sample(12, 64, 4.5, "09:48")
        ]
    }

    @MainActor
    private func elevationPreview(_ update: ElevationUpdate) -> ElevationChart {
        ElevationChart(
            model: ElevationChartModel(
                source: InMemoryElevationSource(initial: update),
                cursor: InMemoryElevationCursorSync(),
                telemetry: SilentElevationTelemetry()
            )
        )
    }

    #Preview("Content") {
        elevationPreview(
            ElevationUpdate(status: .loaded, samples: ElevationPreviewData.samples, speedUnit: .kmh, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Content (mph)") {
        elevationPreview(
            ElevationUpdate(status: .loaded, samples: ElevationPreviewData.samples, speedUnit: .mph, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        elevationPreview(ElevationUpdate(status: .loaded, samples: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        elevationPreview(ElevationUpdate(status: .loading, samples: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        elevationPreview(
            ElevationUpdate(status: .failed("Request timed out"), samples: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        elevationPreview(
            ElevationUpdate(status: .loaded, samples: ElevationPreviewData.samples, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        elevationPreview(
            ElevationUpdate(status: .loaded, samples: ElevationPreviewData.samples, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
