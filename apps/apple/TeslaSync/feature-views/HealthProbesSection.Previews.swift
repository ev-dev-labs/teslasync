//
//  HealthProbesSection.Previews.swift
//  TeslaSync — P4 feature view · 0244 · HealthProbesSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (the two probe
//  cards), empty (resolved, no health snapshot), loading (skeleton chrome), error
//  (fetch failed → retry), and the stale / offline freshness variants. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentHealthProbesTelemetry: HealthProbesTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample health snapshot for the populated previews.
    private enum HealthProbesPreviewData {
        static let health = HealthProbesHealthDTO(
            status: "ok",
            database: DatabaseProbeDTO(status: "ready", latencyMs: 1.8),
            system: SystemProbeDTO(goroutines: 142, uptimeSeconds: 183_600),
            databasePool: DatabasePoolProbeDTO(totalConns: 12)
        )

        static func loaded(connection: HealthProbesConnection = .live) -> HealthProbesUpdate {
            HealthProbesUpdate(
                status: .loaded,
                health: health,
                connection: connection,
                updatedAt: Date(timeIntervalSince1970: 1_775_000_000)
            )
        }
    }

    @MainActor
    private func healthProbesPreview(_ update: HealthProbesUpdate) -> HealthProbesSection {
        HealthProbesSection(
            model: HealthProbesModel(
                source: InMemoryHealthProbesSource(initial: update),
                telemetry: SilentHealthProbesTelemetry(),
                locale: Locale(identifier: "en_US")
            )
        )
    }

    #Preview("Content") {
        ScrollView { healthProbesPreview(HealthProbesPreviewData.loaded()).padding() }
            .frame(maxWidth: 720)
    }

    #Preview("Empty") {
        ScrollView {
            healthProbesPreview(HealthProbesUpdate(status: .loaded, connection: .live)).padding()
        }
        .frame(maxWidth: 720)
    }

    #Preview("Loading") {
        ScrollView {
            healthProbesPreview(HealthProbesUpdate(status: .loading, connection: .live)).padding()
        }
        .frame(maxWidth: 720)
    }

    #Preview("Error") {
        ScrollView {
            healthProbesPreview(HealthProbesUpdate(status: .failed("Request timed out"), connection: .live)).padding()
        }
        .frame(maxWidth: 720)
    }

    #Preview("Stale") {
        ScrollView { healthProbesPreview(HealthProbesPreviewData.loaded(connection: .stale)).padding() }
            .frame(maxWidth: 720)
    }

    #Preview("Offline") {
        ScrollView { healthProbesPreview(HealthProbesPreviewData.loaded(connection: .offline)).padding() }
            .frame(maxWidth: 720)
    }
#endif
