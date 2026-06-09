//
//  TirePressureSection.Previews.swift
//  TeslaSync — P4 feature view · 0151 · TirePressureSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (the four populated
//  tiles + four-wheel line chart), empty (resolved, no tire-pressure samples → web
//  empty overlay), loading (initial skeleton chrome), error (fetch failed → retry), and
//  the stale / offline freshness variants, plus a psi-unit variant. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTPSectionTelemetry: TPSectionTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample SI (pascal) telemetry across eight samples around 290 kPa, with each wheel
    /// drifting slightly and the rears sitting a touch higher — so every line, tile, and
    /// legend entry render.
    private enum TPSectionPreviewData {
        static let samples: [TPSectionSample] = (0 ..< 8).map { (index: Int) -> TPSectionSample in
            let drift = Double(index) * 900
            return TPSectionSample(
                time: String(format: "%02d:%02d", 8 + index / 6, (index * 10) % 60),
                frontLeftPa: 288_000 + drift,
                frontRightPa: 290_000 + drift,
                rearLeftPa: 296_000 + drift,
                rearRightPa: 294_000 + drift
            )
        }

        static func update(
            status: TPSectionLoadStatus = .loaded,
            samples: [TPSectionSample] = TPSectionPreviewData.samples,
            unit: TPSectionUnit = .kpa,
            connection: TPSectionConnection = .live
        ) -> TPSectionUpdate {
            TPSectionUpdate(
                status: status,
                samples: samples,
                unit: unit,
                localeIdentifier: "en_US",
                connection: connection
            )
        }
    }

    @MainActor
    private func tpSectionPreview(_ update: TPSectionUpdate) -> TirePressureSection {
        TirePressureSection(
            model: TirePressureSectionModel(
                source: InMemoryTPSectionSource(initial: update),
                telemetry: SilentTPSectionTelemetry()
            )
        )
    }

    #Preview("Content") {
        tpSectionPreview(TPSectionPreviewData.update())
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Content · psi") {
        tpSectionPreview(TPSectionPreviewData.update(unit: .psi))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Empty") {
        tpSectionPreview(TPSectionPreviewData.update(samples: []))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Loading") {
        tpSectionPreview(TPSectionPreviewData.update(status: .loading, samples: []))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Error") {
        tpSectionPreview(TPSectionPreviewData.update(status: .failed("Request timed out"), samples: []))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Stale") {
        tpSectionPreview(TPSectionPreviewData.update(connection: .stale))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Offline") {
        tpSectionPreview(TPSectionPreviewData.update(connection: .offline))
            .padding()
            .frame(maxWidth: 520)
    }
#endif
