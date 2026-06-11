//
//  TirePressurePanel.Previews.swift
//  TeslaSync — P4 feature view · 0286 · TirePressurePanel (Apple)
//
//  Xcode previews — one per state the surface produces: content (four populated tiles + the
//  "All Normal" chip), a mixed-band variant (Normal / soft / critical / No Data so every
//  value tone and the "Attention Needed" chip show), a psi-unit variant, empty (resolved, no
//  snapshot → web no-data sentence), loading (initial skeleton chrome), error (fetch failed
//  → retry), and the stale / offline freshness variants. Preview-only; excluded from release
//  builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTPPanelTelemetry: TPPanelTelemetry {
        func viewOpened(surface _: String) {}
    }

    private enum TPPanelPreviewData {
        /// All four corners in the safe band (≈ 290 kPa), each drifting slightly.
        static let normal = TPPanelSnapshot(
            frontLeftPa: 288_000,
            frontRightPa: 290_000,
            rearLeftPa: 296_000,
            rearRightPa: 294_000
        )

        /// One corner per band: Normal (green) / soft (amber) / critical (red) / No Data.
        static let mixed = TPPanelSnapshot(
            frontLeftPa: 275_000,
            frontRightPa: 220_000,
            rearLeftPa: 190_000,
            rearRightPa: nil
        )

        static func update(
            status: TPPanelLoadStatus = .loaded,
            snapshot: TPPanelSnapshot? = TPPanelPreviewData.normal,
            unit: TPPanelUnit = .kpa,
            connection: TPPanelConnection = .live
        ) -> TPPanelUpdate {
            TPPanelUpdate(
                status: status,
                snapshot: snapshot,
                unit: unit,
                localeIdentifier: "en_US",
                connection: connection
            )
        }
    }

    @MainActor
    private func tpPanelPreview(_ update: TPPanelUpdate) -> TirePressurePanel {
        TirePressurePanel(
            model: TirePressurePanelModel(
                source: InMemoryTPPanelSource(initial: update),
                telemetry: SilentTPPanelTelemetry()
            )
        )
    }

    #Preview("Content") {
        tpPanelPreview(TPPanelPreviewData.update())
            .padding()
            .frame(maxWidth: 420)
    }

    #Preview("Content · mixed bands") {
        tpPanelPreview(TPPanelPreviewData.update(snapshot: TPPanelPreviewData.mixed))
            .padding()
            .frame(maxWidth: 420)
    }

    #Preview("Content · psi") {
        tpPanelPreview(TPPanelPreviewData.update(unit: .psi))
            .padding()
            .frame(maxWidth: 420)
    }

    #Preview("Empty") {
        tpPanelPreview(TPPanelPreviewData.update(snapshot: nil))
            .padding()
            .frame(maxWidth: 420)
    }

    #Preview("Loading") {
        tpPanelPreview(TPPanelPreviewData.update(status: .loading, snapshot: nil))
            .padding()
            .frame(maxWidth: 420)
    }

    #Preview("Error") {
        tpPanelPreview(TPPanelPreviewData.update(status: .failed("Request timed out"), snapshot: nil))
            .padding()
            .frame(maxWidth: 420)
    }

    #Preview("Stale") {
        tpPanelPreview(TPPanelPreviewData.update(connection: .stale))
            .padding()
            .frame(maxWidth: 420)
    }

    #Preview("Offline") {
        tpPanelPreview(TPPanelPreviewData.update(connection: .offline))
            .padding()
            .frame(maxWidth: 420)
    }
#endif
