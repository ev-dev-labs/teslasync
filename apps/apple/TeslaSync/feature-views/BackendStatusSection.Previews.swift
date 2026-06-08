//
//  BackendStatusSection.Previews.swift
//  TeslaSync — P4 feature view · 0239 · BackendStatusSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (the three
//  populated sections), empty (resolved, nothing to show), loading (skeleton
//  chrome), error (fetch failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentBackendStatusTelemetry: BackendStatusTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample backend snapshot for the populated previews.
    private enum BackendStatusPreviewData {
        static let components: [ComponentHealthDTO] = [
            ComponentHealthDTO(
                name: "database",
                status: "ok",
                latencyMs: 2.4,
                consecutiveFailures: 0,
                lastCheck: "2026-04-15T09:30:00Z"
            ),
            ComponentHealthDTO(
                name: "redis",
                status: "ok",
                latencyMs: 0.8,
                consecutiveFailures: 0,
                lastCheck: "2026-04-15T09:30:01Z"
            ),
            ComponentHealthDTO(
                name: "mqtt",
                status: "degraded",
                latencyMs: 124.5,
                consecutiveFailures: 2,
                lastCheck: "2026-04-15T09:29:58Z"
            ),
            ComponentHealthDTO(
                name: "tesla_api",
                status: "down",
                latencyMs: 0,
                consecutiveFailures: 7,
                lastCheck: "2026-04-15T09:25:10Z"
            )
        ]

        static let system = SystemInfoDTO(goroutines: 142, goVersion: "go1.25.1", uptimeSeconds: 183_600)

        static let pool = ConnectionPoolDTO(
            maxOpen: 25,
            open: 12,
            inUse: 5,
            idle: 7,
            waitCount: 3,
            waitDurationMs: 14.2
        )

        static let version = VersionDTO(
            goVersion: "go1.25.1",
            os: "linux",
            arch: "arm64",
            uptimeSeconds: 183_600,
            goroutines: 142
        )

        static func loaded(connection: BackendConnection = .live) -> BackendStatusUpdate {
            BackendStatusUpdate(
                status: .loaded,
                health: BackendHealthDTO(status: "ok", components: components, system: system),
                pool: pool,
                version: version,
                connection: connection,
                updatedAt: Date(timeIntervalSince1970: 1_775_000_000)
            )
        }
    }

    @MainActor
    private func backendPreview(_ update: BackendStatusUpdate) -> BackendStatusSection {
        BackendStatusSection(
            model: BackendStatusModel(
                source: InMemoryBackendStatusSource(initial: update),
                telemetry: SilentBackendStatusTelemetry(),
                locale: Locale(identifier: "en_US")
            )
        )
    }

    #Preview("Content") {
        ScrollView { backendPreview(BackendStatusPreviewData.loaded()).padding() }
            .frame(maxWidth: 720)
    }

    #Preview("Empty") {
        ScrollView {
            backendPreview(BackendStatusUpdate(status: .loaded, connection: .live)).padding()
        }
        .frame(maxWidth: 720)
    }

    #Preview("Loading") {
        ScrollView {
            backendPreview(BackendStatusUpdate(status: .loading, connection: .live)).padding()
        }
        .frame(maxWidth: 720)
    }

    #Preview("Error") {
        ScrollView {
            backendPreview(BackendStatusUpdate(status: .failed("Request timed out"), connection: .live)).padding()
        }
        .frame(maxWidth: 720)
    }

    #Preview("Stale") {
        ScrollView { backendPreview(BackendStatusPreviewData.loaded(connection: .stale)).padding() }
            .frame(maxWidth: 720)
    }

    #Preview("Offline") {
        ScrollView { backendPreview(BackendStatusPreviewData.loaded(connection: .offline)).padding() }
            .frame(maxWidth: 720)
    }
#endif
