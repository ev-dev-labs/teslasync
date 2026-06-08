//
//  AlertsSection.Previews.swift
//  TeslaSync — P4 feature view · 0071 · AlertsSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  severity list + donut), empty (resolved, no alerts → web `EmptyState`), loading
//  (initial skeleton chrome), error (fetch failed → retry), and the stale / offline
//  freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentAlertsTelemetry: AlertsSectionTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample severity counts for the populated previews (web `alertsByType`).
    private enum AlertsPreviewData {
        static let counts: [String: Int] = [
            "critical": 3,
            "warning": 11,
            "info": 6
        ]

        static let withUnknown: [String: Int] = [
            "critical": 2,
            "warning": 7,
            "info": 4,
            "debug": 5
        ]
    }

    @MainActor
    private func alertsPreview(_ update: AlertsUpdate) -> AlertsSection {
        AlertsSection(
            model: AlertsSectionModel(
                source: InMemoryAlertsSectionSource(initial: update),
                telemetry: SilentAlertsTelemetry()
            )
        )
    }

    #Preview("Content") {
        alertsPreview(
            AlertsUpdate(status: .loaded, counts: AlertsPreviewData.counts, connection: .live)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Content + unknown severity") {
        alertsPreview(
            AlertsUpdate(status: .loaded, counts: AlertsPreviewData.withUnknown, connection: .live)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Empty") {
        alertsPreview(AlertsUpdate(status: .loaded, counts: [:], connection: .live))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Loading") {
        alertsPreview(AlertsUpdate(status: .loading, counts: [:], connection: .live))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Error") {
        alertsPreview(
            AlertsUpdate(status: .failed("Request timed out"), counts: [:], connection: .live)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Stale") {
        alertsPreview(
            AlertsUpdate(status: .loaded, counts: AlertsPreviewData.counts, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Offline") {
        alertsPreview(
            AlertsUpdate(status: .loaded, counts: AlertsPreviewData.counts, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 560)
    }
#endif
