//
//  InfrastructureSection.Tests.swift
//  TeslaSync — P4 feature view · 0248 · InfrastructureSection (Apple)
//
//  Pure-adapter + accessibility coverage for the InfrastructureSection surface:
//    • `InfrastructureProjection` — SSE-connection info, polling-engine info, database-
//      pool tiles, the connection-mode / polling-active derivations, and the content /
//      empty / loading / error phase resolution (web `telemetry` / `extHealth` reads).
//    • `InfrastructureFormat` — locale-grouped integer (web `fmtInt`).
//    • `InfrastructureAccessibility` — the section summary + per-card VoiceOver label.
//  The state-holder tests live in `.ModelTests`. No network, no bundle.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (used here + in `.ModelTests`)

enum InfrastructureFixture {
    /// A connected streaming snapshot (SSE enabled, polling fallback off).
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

    /// A disconnected polling-fallback snapshot (SSE off, polling active).
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

// MARK: - Projection: derivations

@MainActor final class InfrastructureProjectionTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    func testSseConnectedMirrorsWebEnabledFallback() {
        XCTAssertTrue(InfrastructureProjection.sseConnected(InfrastructureFixture.streaming))
        XCTAssertFalse(InfrastructureProjection.sseConnected(InfrastructureFixture.polling))
        // Web `telemetry?.enabled ?? false`.
        XCTAssertFalse(InfrastructureProjection.sseConnected(nil))
    }

    func testConnectionModeDefaultsToUnknownLikeWeb() {
        XCTAssertEqual(InfrastructureProjection.connectionMode(InfrastructureFixture.streaming), "streaming")
        // Web `telemetry?.mode ?? 'unknown'`; an empty mode is treated as unknown too.
        XCTAssertEqual(InfrastructureProjection.connectionMode(nil), "unknown")
        XCTAssertEqual(InfrastructureProjection.connectionMode(InfraTelemetryDTO(mode: "")), "unknown")
    }

    func testPollingActiveMatchesWebPollingMode() {
        XCTAssertTrue(InfrastructureProjection.pollingActive(InfrastructureFixture.polling))
        XCTAssertFalse(InfrastructureProjection.pollingActive(InfrastructureFixture.streaming))
        XCTAssertFalse(InfrastructureProjection.pollingActive(nil))
    }

    func testSseInfoProjectsEveryFieldFromStreaming() {
        let info = InfrastructureProjection.sseInfo(from: InfrastructureFixture.streaming)
        XCTAssertTrue(info.connected)
        XCTAssertEqual(info.endpoint, "wss://telemetry.teslasync.io/v1/stream")
        XCTAssertEqual(info.protocolName, "fleet-telemetry/2")
        XCTAssertFalse(info.fallbackActive)
    }

    func testSseInfoFallsBackToEmDashWhenTelemetryAbsent() {
        let info = InfrastructureProjection.sseInfo(from: nil)
        XCTAssertFalse(info.connected)
        XCTAssertEqual(info.endpoint, "—")
        XCTAssertEqual(info.protocolName, "—")
        XCTAssertFalse(info.fallbackActive)
    }

    func testPollingInfoProjectsRawModeAndSpeedComparison() {
        let info = InfrastructureProjection.pollingInfo(from: InfrastructureFixture.polling)
        XCTAssertTrue(info.active)
        XCTAssertEqual(info.mode, "polling")
        XCTAssertEqual(info.speedup, "1× baseline")
        XCTAssertEqual(info.fleetTelemetryLatency, "n/a")
        XCTAssertEqual(info.fleetApiPolling, "~15 s")
    }

    func testPollingInfoFallsBackToEmDashWhenTelemetryAbsent() {
        let info = InfrastructureProjection.pollingInfo(from: nil)
        XCTAssertFalse(info.active)
        XCTAssertEqual(info.mode, "unknown")
        XCTAssertEqual(info.speedup, "—")
        XCTAssertEqual(info.fleetTelemetryLatency, "—")
        XCTAssertEqual(info.fleetApiPolling, "—")
    }

    func testPoolStatsAreThreeOrderedFormattedTilesOrNil() {
        let stats = InfrastructureProjection.poolStats(from: InfrastructureFixture.pool, locale: locale)
        XCTAssertEqual(stats?.map(\.metric), [.totalConns, .acquired, .idle])
        XCTAssertEqual(stats?.map(\.value), ["25", "5", "20"])
        // Web `{extHealth?.database_pool && …}` — no pool → the row is omitted.
        XCTAssertNil(InfrastructureProjection.poolStats(from: nil, locale: locale))
    }

    func testResolvePhase() {
        XCTAssertEqual(
            InfrastructureProjection.resolvePhase(.loading, hasTelemetry: false, hasPool: false),
            .loading
        )
        XCTAssertEqual(
            InfrastructureProjection.resolvePhase(.failed("boom"), hasTelemetry: true, hasPool: true),
            .error("boom")
        )
        XCTAssertEqual(
            InfrastructureProjection.resolvePhase(.loaded, hasTelemetry: true, hasPool: false),
            .content
        )
        XCTAssertEqual(
            InfrastructureProjection.resolvePhase(.loaded, hasTelemetry: false, hasPool: true),
            .content
        )
        XCTAssertEqual(
            InfrastructureProjection.resolvePhase(.loaded, hasTelemetry: false, hasPool: false),
            .empty
        )
    }

    func testDashTreatsNilAndEmptyAsEmDash() {
        XCTAssertEqual(InfrastructureProjection.dash(nil), "—")
        XCTAssertEqual(InfrastructureProjection.dash(""), "—")
        XCTAssertEqual(InfrastructureProjection.dash("wss://x"), "wss://x")
    }
}

// MARK: - Format + surface identity

@MainActor final class InfrastructureFormatTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    func testIntGroupsThousands() {
        XCTAssertEqual(InfrastructureFormat.int(25, locale: locale), "25")
        XCTAssertEqual(InfrastructureFormat.int(12345, locale: locale), "12,345")
        XCTAssertEqual(InfrastructureFormat.int(0, locale: locale), "0")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(InfrastructureSurface.slug, "InfrastructureSection")
        XCTAssertEqual(InfrastructureSection.surfaceSlug, "InfrastructureSection")
    }

    func testPoolMetricLabelsAndTones() {
        XCTAssertEqual(InfraPoolMetric.totalConns.labelKey, "Total Conns")
        XCTAssertEqual(InfraPoolMetric.acquired.labelKey, "Acquired")
        XCTAssertEqual(InfraPoolMetric.idle.labelKey, "Idle")
        XCTAssertEqual(InfraPoolMetric.totalConns.tone, .accent)
        XCTAssertEqual(InfraPoolMetric.acquired.tone, .success)
        XCTAssertEqual(InfraPoolMetric.idle.tone, .warning)
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class InfrastructureAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSectionSummaryReflectsConnectedState() {
        XCTAssertEqual(
            InfrastructureAccessibility.sectionSummary(hasContent: true, sseConnected: true, localize: echo),
            "Infrastructure: Connected"
        )
        XCTAssertEqual(
            InfrastructureAccessibility.sectionSummary(hasContent: true, sseConnected: false, localize: echo),
            "Infrastructure: Disconnected"
        )
    }

    func testSectionSummaryEmptyUsesFriendlyMessage() {
        let summary = InfrastructureAccessibility.sectionSummary(
            hasContent: false, sseConnected: false, localize: echo
        )
        XCTAssertTrue(summary.contains("No infrastructure data available"))
    }

    func testSseLabelIncludesEveryField() {
        let info = InfrastructureProjection.sseInfo(from: InfrastructureFixture.streaming)
        let label = InfrastructureAccessibility.sseLabel(info, localize: echo)
        XCTAssertTrue(label.contains("SSE Connection: Connected"))
        XCTAssertTrue(label.contains("Endpoint wss://telemetry.teslasync.io/v1/stream"))
        XCTAssertTrue(label.contains("Protocol fleet-telemetry/2"))
        XCTAssertTrue(label.contains("Fallback Mode No"))
    }

    func testPollingLabelIncludesEveryField() {
        let info = InfrastructureProjection.pollingInfo(from: InfrastructureFixture.polling)
        let label = InfrastructureAccessibility.pollingLabel(info, localize: echo)
        XCTAssertTrue(label.contains("Polling Engine: Active"))
        XCTAssertTrue(label.contains("Mode polling"))
        XCTAssertTrue(label.contains("Speed Comparison 1× baseline"))
        XCTAssertTrue(label.contains("Fleet Telemetry Latency n/a"))
        XCTAssertTrue(label.contains("Fleet API Polling ~15 s"))
    }
}
