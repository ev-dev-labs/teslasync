//
//  TemperatureSection.Previews.swift
//  TeslaSync — P4 feature view · 0150 · TemperatureSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (the populated tiles
//  + four-series line chart), empty (resolved, no temperature samples → web empty
//  overlay), loading (initial skeleton chrome), error (fetch failed → retry), and the
//  stale / offline freshness variants. Preview-only; excluded from release builds via
//  `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTempSectionTelemetry: TempSectionTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample SI (°C) telemetry across eight samples: outside climbs, the cabin holds
    /// near its set point, and the seats track it, with climate on and a varying fan —
    /// so every series, tile, and the legend render.
    private enum TempSectionPreviewData {
        static let samples: [TempSectionSample] = (0 ..< 8).map { index in
            TempSectionSample(
                time: String(format: "%02d:%02d", 8 + index / 6, (index * 10) % 60),
                outsideC: 14 + Double(index) * 1.2,
                insideC: 21 + Double(index) * 0.15,
                driverC: 21.5,
                passengerC: 20.5 + Double(index) * 0.1,
                climateOn: index != 2,
                fanStatus: Double(min(7, 2 + index))
            )
        }

        static func update(
            status: TempSectionLoadStatus = .loaded,
            samples: [TempSectionSample] = TempSectionPreviewData.samples,
            connection: TempSectionConnection = .live
        ) -> TempSectionUpdate {
            TempSectionUpdate(
                status: status,
                samples: samples,
                unit: .celsius,
                localeIdentifier: "en_US",
                connection: connection
            )
        }
    }

    @MainActor
    private func tempSectionPreview(_ update: TempSectionUpdate) -> TemperatureSection {
        TemperatureSection(
            model: TemperatureSectionModel(
                source: InMemoryTempSectionSource(initial: update),
                telemetry: SilentTempSectionTelemetry()
            )
        )
    }

    #Preview("Content") {
        tempSectionPreview(TempSectionPreviewData.update())
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Content · °F") {
        tempSectionPreview(
            TempSectionUpdate(
                status: .loaded,
                samples: TempSectionPreviewData.samples,
                unit: .fahrenheit,
                localeIdentifier: "en_US",
                connection: .live
            )
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        tempSectionPreview(TempSectionPreviewData.update(samples: []))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        tempSectionPreview(TempSectionPreviewData.update(status: .loading, samples: []))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        tempSectionPreview(TempSectionPreviewData.update(status: .failed("Request timed out"), samples: []))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        tempSectionPreview(TempSectionPreviewData.update(connection: .stale))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        tempSectionPreview(TempSectionPreviewData.update(connection: .offline))
            .padding()
            .frame(maxWidth: 480)
    }
#endif
