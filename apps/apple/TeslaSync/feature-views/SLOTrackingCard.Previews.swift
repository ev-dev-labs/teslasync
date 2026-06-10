//
//  SLOTrackingCard.Previews.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  Xcode previews — one per state the surface produces: content (the populated
//  figure + window selector), the snapshot-caveat variant, editing (the open target
//  editor), empty (resolved, no figure), loading (skeleton chrome), error (fetch
//  failed → retry), and the stale / offline freshness variants. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSLOTrackingTelemetry: SLOTrackingTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample uptime snapshots for the populated previews.
    private enum SLOTrackingPreviewData {
        static func series(_ window: SLOWindow = .d30, percent: Double = 99.95) -> UptimeWindowDTO {
            UptimeWindowDTO(
                window: window.apiValue,
                uptimePercent: percent,
                healthyCount: 6,
                totalCount: 6,
                generatedAt: "2026-04-15T09:30:00Z",
                historicalSource: "series"
            )
        }

        static let snapshotCaveat = UptimeWindowDTO(
            window: SLOWindow.d90.apiValue,
            uptimePercent: 98.4,
            healthyCount: 5,
            totalCount: 6,
            generatedAt: "2026-04-15T09:30:00Z",
            historicalSource: "snapshot"
        )

        static func loaded(
            _ snapshot: UptimeWindowDTO,
            connection: SLOConnection = .live
        ) -> SLOTrackingUpdate {
            SLOTrackingUpdate(
                status: .loaded,
                snapshot: snapshot,
                connection: connection,
                updatedAt: Date(timeIntervalSince1970: 1_775_000_000)
            )
        }
    }

    @MainActor
    private func sloPreview(
        _ update: SLOTrackingUpdate,
        window: SLOWindow = .d30,
        target: Double = 99
    ) -> SLOTrackingCard {
        SLOTrackingCard(
            model: SLOTrackingModel(
                source: InMemorySLOTrackingSource(initial: update, window: window),
                telemetry: SilentSLOTrackingTelemetry(),
                targetStore: InMemorySLOTargetStore(stored: target),
                initialWindow: window,
                locale: Locale(identifier: "en_US")
            )
        )
    }

    #Preview("Content") {
        ScrollView { sloPreview(SLOTrackingPreviewData.loaded(SLOTrackingPreviewData.series())).padding() }
            .frame(maxWidth: 520)
    }

    #Preview("Below target") {
        ScrollView {
            sloPreview(SLOTrackingPreviewData.loaded(SLOTrackingPreviewData.series(percent: 97.2))).padding()
        }
        .frame(maxWidth: 520)
    }

    #Preview("Snapshot caveat") {
        ScrollView {
            sloPreview(
                SLOTrackingPreviewData.loaded(SLOTrackingPreviewData.snapshotCaveat),
                window: .d90
            ).padding()
        }
        .frame(maxWidth: 520)
    }

    #Preview("Empty") {
        ScrollView {
            sloPreview(SLOTrackingUpdate(status: .loaded, connection: .live)).padding()
        }
        .frame(maxWidth: 520)
    }

    #Preview("Loading") {
        ScrollView {
            sloPreview(SLOTrackingUpdate(status: .loading, connection: .live)).padding()
        }
        .frame(maxWidth: 520)
    }

    #Preview("Error") {
        ScrollView {
            sloPreview(SLOTrackingUpdate(status: .failed("Network timeout"), connection: .live)).padding()
        }
        .frame(maxWidth: 520)
    }

    #Preview("Stale") {
        ScrollView {
            sloPreview(SLOTrackingPreviewData.loaded(SLOTrackingPreviewData.series(), connection: .stale)).padding()
        }
        .frame(maxWidth: 520)
    }

    #Preview("Offline") {
        ScrollView {
            sloPreview(SLOTrackingPreviewData.loaded(SLOTrackingPreviewData.series(), connection: .offline)).padding()
        }
        .frame(maxWidth: 520)
    }
#endif
