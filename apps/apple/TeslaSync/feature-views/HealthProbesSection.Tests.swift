//
//  HealthProbesSection.Tests.swift
//  TeslaSync — P4 feature view · 0244 · HealthProbesSection (Apple)
//
//  Pure-adapter + accessibility coverage for the HealthProbesSection surface:
//    • `HealthProbeStatus` — the variant classification (web `statusToBadgeVariant`
//      case lists, including the "connected"-omission distinction).
//    • `HealthProbesProjection` — the liveness / readiness card projections, the
//      header Live / Ready badges, and the content / empty / loading / error phase
//      resolution.
//    • `HealthProbesFormat` — number / int / latency / uptime + the "—" em-dash
//      latency fallback (web fmtNumber / fmtInt / formatUptime).
//    • `HealthProbesAccessibility` — the section summary + per-card VoiceOver label.
//  The state-holder tests live in `.ModelTests`. No network, no bundle.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (used here + in `.ModelTests`)

enum HealthProbesFixture {
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

// MARK: - Adapter: status variant

@MainActor final class HealthProbeStatusTests: XCTestCase {
    func testVariantMatchesWebSuccessList() {
        for raw in ["healthy", "ok", "online", "ready", "sent", "completed"] {
            XCTAssertEqual(HealthProbeStatus.variant(raw), .success, raw)
        }
    }

    func testVariantMatchesWebWarningList() {
        for raw in ["degraded", "warning", "pending", "queued", "processing"] {
            XCTAssertEqual(HealthProbeStatus.variant(raw), .warning, raw)
        }
    }

    func testVariantMatchesWebDangerList() {
        for raw in ["unhealthy", "offline", "error", "down", "failed"] {
            XCTAssertEqual(HealthProbeStatus.variant(raw), .danger, raw)
        }
    }

    func testVariantOmitsConnectedFromSuccessLikeWeb() {
        // statusToBadgeVariant (unlike statusTextClass) does NOT list "connected".
        XCTAssertEqual(HealthProbeStatus.variant("connected"), .neutral)
    }

    func testVariantUnknownAndEmptyAreNeutral() {
        XCTAssertEqual(HealthProbeStatus.variant("unknown"), .neutral)
        XCTAssertEqual(HealthProbeStatus.variant(""), .neutral)
        XCTAssertEqual(HealthProbeStatus.variant("booting"), .neutral)
    }

    func testVariantIsCaseInsensitiveLikeWeb() {
        XCTAssertEqual(HealthProbeStatus.variant("OK"), .success)
        XCTAssertEqual(HealthProbeStatus.variant("Degraded"), .warning)
    }
}

// MARK: - Adapter: projection

@MainActor final class HealthProbesProjectionTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    func testLivenessCardMapsStatusGoroutinesUptime() {
        let card = HealthProbesProjection.livenessCard(from: HealthProbesFixture.health, locale: locale)
        XCTAssertEqual(card.titleKey, "Liveness — /healthz")
        XCTAssertEqual(card.status, "ok")
        XCTAssertEqual(card.tone, .success)
        XCTAssertEqual(card.rows.map(\.labelKey), ["Status", "Goroutines", "Uptime"])
        XCTAssertEqual(card.rows[0].value, "ok")
        XCTAssertEqual(card.rows[1].value, "142")
        XCTAssertEqual(card.rows[2].value, "2d 3h 0m")
    }

    func testReadinessCardMapsDatabaseLatencyPool() {
        let card = HealthProbesProjection.readinessCard(from: HealthProbesFixture.health, locale: locale)
        XCTAssertEqual(card.titleKey, "Readiness — /readyz")
        XCTAssertEqual(card.status, "ready")
        XCTAssertEqual(card.tone, .success)
        XCTAssertEqual(card.rows.map(\.labelKey), ["Database", "Latency", "Pool Connections"])
        XCTAssertEqual(card.rows[0].value, "ready")
        XCTAssertEqual(card.rows[1].value, "1.8 ms")
        XCTAssertEqual(card.rows[2].value, "12")
    }

    func testReadinessCardFallsBackToUnknownAndEmDash() {
        let health = HealthProbesHealthDTO(status: "ok", database: nil, system: nil, databasePool: nil)
        let card = HealthProbesProjection.readinessCard(from: health, locale: locale)
        // Web `data?.database?.status ?? 'unknown'` + `dbLatency != null ? … : '—'`.
        XCTAssertEqual(card.status, "unknown")
        XCTAssertEqual(card.tone, .neutral)
        XCTAssertEqual(card.rows[0].value, "unknown")
        XCTAssertEqual(card.rows[1].value, "—")
        XCTAssertEqual(card.rows[2].value, "0")
    }

    func testLivenessCardDefaultsMissingSystemToZero() {
        let health = HealthProbesHealthDTO(status: "degraded")
        let card = HealthProbesProjection.livenessCard(from: health, locale: locale)
        XCTAssertEqual(card.tone, .warning)
        XCTAssertEqual(card.rows[1].value, "0") // goroutines
        XCTAssertEqual(card.rows[2].value, "0m") // uptime
    }

    func testHeaderBadgesAreLiveThenReadyTonedFromStatuses() {
        let badges = HealthProbesProjection.headerBadges(from: HealthProbesFixture.health)
        XCTAssertEqual(badges.map(\.labelKey), ["Live", "Ready"])
        XCTAssertEqual(badges[0].tone, .success) // status "ok"
        XCTAssertEqual(badges[1].tone, .success) // database "ready"
    }

    func testHeaderBadgesReadyIsNeutralWhenNoDatabase() {
        let badges = HealthProbesProjection.headerBadges(from: HealthProbesHealthDTO(status: "down"))
        XCTAssertEqual(badges[0].tone, .danger) // "down"
        XCTAssertEqual(badges[1].tone, .neutral) // missing database → "unknown"
    }

    func testResolvePhase() {
        XCTAssertEqual(HealthProbesProjection.resolvePhase(.loading, hasHealth: false), .loading)
        XCTAssertEqual(HealthProbesProjection.resolvePhase(.failed("boom"), hasHealth: true), .error("boom"))
        XCTAssertEqual(HealthProbesProjection.resolvePhase(.loaded, hasHealth: true), .content)
        XCTAssertEqual(HealthProbesProjection.resolvePhase(.loaded, hasHealth: false), .empty)
    }
}

// MARK: - Adapter: formatting

@MainActor final class HealthProbesFormatTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    func testNumberAndIntGroupAndRound() {
        XCTAssertEqual(HealthProbesFormat.number(1234.56, fractionDigits: 1, locale: locale), "1,234.6")
        XCTAssertEqual(HealthProbesFormat.int(12345, locale: locale), "12,345")
    }

    func testLatencyHasMillisecondSuffixOrEmDash() {
        XCTAssertEqual(HealthProbesFormat.latency(1.8, locale: locale), "1.8 ms")
        XCTAssertEqual(HealthProbesFormat.latency(0, locale: locale), "0.0 ms")
        // Web `dbLatency != null ? … : '—'`.
        XCTAssertEqual(HealthProbesFormat.latency(nil, locale: locale), "—")
    }

    func testUptimeMatchesWebFormatUptime() {
        XCTAssertEqual(HealthProbesFormat.uptime(183_600), "2d 3h 0m")
        XCTAssertEqual(HealthProbesFormat.uptime(3661), "1h 1m")
        XCTAssertEqual(HealthProbesFormat.uptime(125), "2m")
        XCTAssertEqual(HealthProbesFormat.uptime(0), "0m")
        XCTAssertEqual(HealthProbesFormat.uptime(-5), "0m")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(HealthProbesSurface.slug, "HealthProbesSection")
        XCTAssertEqual(HealthProbesSection.surfaceSlug, "HealthProbesSection")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class HealthProbesAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSectionSummaryWithHealthShowsLiveAndReady() {
        let summary = HealthProbesAccessibility.sectionSummary(
            hasHealth: true,
            livenessStatus: "ok",
            readinessStatus: "ready",
            localize: echo
        )
        XCTAssertEqual(summary, "Health Probes: Live ok, Ready ready")
    }

    func testSectionSummaryEmptyUsesFriendlyMessage() {
        let summary = HealthProbesAccessibility.sectionSummary(
            hasHealth: false,
            livenessStatus: "unknown",
            readinessStatus: "unknown",
            localize: echo
        )
        XCTAssertTrue(summary.contains("No health data available"))
    }

    func testCardLabelIncludesTitleStatusAndEveryRow() {
        let card = HealthProbesProjection.livenessCard(
            from: HealthProbesFixture.health,
            locale: Locale(identifier: "en_US")
        )
        let label = HealthProbesAccessibility.cardLabel(card, localize: echo)
        XCTAssertTrue(label.contains("Liveness — /healthz"))
        XCTAssertTrue(label.contains("ok"))
        XCTAssertTrue(label.contains("Goroutines 142"))
        XCTAssertTrue(label.contains("Uptime 2d 3h 0m"))
    }
}
