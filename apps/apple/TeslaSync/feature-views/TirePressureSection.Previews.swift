//
//  TirePressureSection.Previews.swift
//  TeslaSync — P4 feature view · 0299 · TirePressureSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (four populated tiles),
//  a mixed-status variant (Normal / Low / Critical / No Data so every badge tone shows),
//  a psi-unit variant, empty (resolved, no snapshot → web `EmptyState`), loading (initial
//  skeleton chrome), error (fetch failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTPSectionTelemetry: TPSectionTelemetry {
        func viewOpened(surface _: String) {}
    }

    private enum TPSectionPreviewData {
        /// All four corners in the safe band (≈ 290 kPa), each drifting slightly.
        static let normal = TPSectionSnapshot(
            frontLeftPa: 288_000,
            frontRightPa: 290_000,
            rearLeftPa: 296_000,
            rearRightPa: 294_000
        )

        /// One corner per status: Normal / Low (soft) / Critical (hard) / No Data.
        static let mixed = TPSectionSnapshot(
            frontLeftPa: 275_000,
            frontRightPa: 220_000,
            rearLeftPa: 190_000,
            rearRightPa: nil
        )

        static func update(
            status: TPSectionLoadStatus = .loaded,
            snapshot: TPSectionSnapshot? = TPSectionPreviewData.normal,
            unit: TPSectionUnit = .kpa,
            connection: TPSectionConnection = .live
        ) -> TPSectionUpdate {
            TPSectionUpdate(
                status: status,
                snapshot: snapshot,
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

    #Preview("Content · mixed status") {
        tpSectionPreview(TPSectionPreviewData.update(snapshot: TPSectionPreviewData.mixed))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Content · psi") {
        tpSectionPreview(TPSectionPreviewData.update(unit: .psi))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Empty") {
        tpSectionPreview(TPSectionPreviewData.update(snapshot: nil))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Loading") {
        tpSectionPreview(TPSectionPreviewData.update(status: .loading, snapshot: nil))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Error") {
        tpSectionPreview(TPSectionPreviewData.update(status: .failed("Request timed out"), snapshot: nil))
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
