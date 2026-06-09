//
//  InfrastructureSection.Previews.swift
//  TeslaSync — P4 feature view · 0248 · InfrastructureSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (streaming + pool),
//  the polling-fallback variant, empty (resolved, nothing to show), loading (skeleton
//  chrome), error (fetch failed → retry), and the stale / offline freshness variants.
//  Each preview opens the accordion (`initiallyExpanded: true`) so the state is
//  visible. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentInfrastructureTelemetry: InfrastructureTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample infrastructure snapshots for the previews.
    private enum InfrastructurePreviewData {
        static let streaming = InfraTelemetryDTO(
            enabled: true,
            mode: "streaming",
            endpoint: "wss://telemetry.teslasync.io/v1/stream",
            protocolName: "fleet-telemetry/2",
            speedComparison: InfraSpeedComparisonDTO(
                speedup: "11.4× faster",
                fleetTelemetryLatency: "~250 ms",
                fleetApiPolling: "~15 s"
            )
        )

        static let polling = InfraTelemetryDTO(
            enabled: false,
            mode: "polling",
            endpoint: "https://owner-api.teslamotors.com",
            protocolName: "fleet-api/rest",
            speedComparison: InfraSpeedComparisonDTO(
                speedup: "1× baseline",
                fleetTelemetryLatency: "n/a",
                fleetApiPolling: "~15 s"
            )
        )

        static let pool = InfraDatabasePoolDTO(totalConns: 25, acquiredConns: 5, idleConns: 20)

        static func loaded(
            telemetry: InfraTelemetryDTO? = streaming,
            pool: InfraDatabasePoolDTO? = pool,
            connection: InfraConnection = .live
        ) -> InfraStatusUpdate {
            InfraStatusUpdate(
                status: .loaded,
                telemetry: telemetry,
                pool: pool,
                connection: connection,
                updatedAt: Date(timeIntervalSince1970: 1_775_000_000)
            )
        }
    }

    @MainActor
    private func infraPreview(_ update: InfraStatusUpdate) -> InfrastructureSection {
        InfrastructureSection(
            model: InfrastructureModel(
                source: InMemoryInfrastructureSource(initial: update),
                telemetry: SilentInfrastructureTelemetry(),
                locale: Locale(identifier: "en_US")
            ),
            initiallyExpanded: true
        )
    }

    #Preview("Content · Streaming") {
        ScrollView { infraPreview(InfrastructurePreviewData.loaded()).padding() }
            .frame(maxWidth: 760)
    }

    #Preview("Content · Polling fallback") {
        ScrollView {
            infraPreview(InfrastructurePreviewData.loaded(telemetry: InfrastructurePreviewData.polling)).padding()
        }
        .frame(maxWidth: 760)
    }

    #Preview("Empty") {
        ScrollView {
            infraPreview(InfraStatusUpdate(status: .loaded, telemetry: nil, pool: nil)).padding()
        }
        .frame(maxWidth: 760)
    }

    #Preview("Loading") {
        ScrollView {
            infraPreview(InfraStatusUpdate(status: .loading)).padding()
        }
        .frame(maxWidth: 760)
    }

    #Preview("Error") {
        ScrollView {
            infraPreview(InfraStatusUpdate(status: .failed("Request timed out"))).padding()
        }
        .frame(maxWidth: 760)
    }

    #Preview("Stale") {
        ScrollView { infraPreview(InfrastructurePreviewData.loaded(connection: .stale)).padding() }
            .frame(maxWidth: 760)
    }

    #Preview("Offline") {
        ScrollView { infraPreview(InfrastructurePreviewData.loaded(connection: .offline)).padding() }
            .frame(maxWidth: 760)
    }
#endif
