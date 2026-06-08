//
//  BackendStatusSection.Tests.swift
//  TeslaSync — P4 feature view · 0239 · BackendStatusSection (Apple)
//
//  Pure-adapter + accessibility coverage for the BackendStatusSection surface:
//    • `BackendComponentStatus` — the tone classification + okCount predicate
//      (web `getStatusIcon` / `statusTextClass` case lists + `okCount`).
//    • `BackendStatusProjection` — component rows, connection-pool tiles, system-
//      runtime key/values (version-then-system fallback), and the content / empty /
//      loading / error phase resolution.
//    • `BackendStatusFormat` — number / int / latency / uptime / ISO parsing + the
//      "—" em-dash fallback contract (web fmtNumber / fmtInt / formatUptime /
//      formatDateTime).
//    • `BackendStatusAccessibility` — the section summary + per-component VoiceOver
//      label. The state-holder tests live in `.ModelTests`. No network, no bundle.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (used here + in `.ModelTests`)

enum BackendStatusFixture {
    /// Four components: two healthy, one degraded, one down (okCount = 2 of 4).
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
            status: "healthy",
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
            lastCheck: ""
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

    static func health(_ system: SystemInfoDTO? = system) -> BackendHealthDTO {
        BackendHealthDTO(status: "ok", components: components, system: system)
    }

    static func loaded(connection: BackendConnection = .live) -> BackendStatusUpdate {
        BackendStatusUpdate(
            status: .loaded,
            health: health(),
            pool: pool,
            version: version,
            connection: connection,
            updatedAt: Date(timeIntervalSince1970: 1_775_000_000)
        )
    }
}

// MARK: - Adapter: status tone + okCount

final class BackendComponentStatusTests: XCTestCase {
    func testToneMatchesWebSuccessList() {
        for raw in ["healthy", "ok", "online", "connected", "ready", "sent", "completed"] {
            XCTAssertEqual(BackendComponentStatus.tone(raw), .success, raw)
        }
    }

    func testToneMatchesWebWarningList() {
        for raw in ["degraded", "warning", "pending", "queued", "processing"] {
            XCTAssertEqual(BackendComponentStatus.tone(raw), .warning, raw)
        }
    }

    func testToneMatchesWebDangerList() {
        for raw in ["unhealthy", "offline", "error", "down", "failed"] {
            XCTAssertEqual(BackendComponentStatus.tone(raw), .danger, raw)
        }
    }

    func testToneUnknownIsNeutralAndDefaultsToTriangle() {
        XCTAssertEqual(BackendComponentStatus.tone("booting"), .neutral)
        XCTAssertEqual(BackendComponentStatus.tone(""), .neutral)
        // Web default branch renders an AlertTriangle, so neutral maps to the triangle.
        XCTAssertEqual(BackendStatusTone.neutral.symbol, "exclamationmark.triangle.fill")
    }

    func testToneIsCaseInsensitiveLikeWeb() {
        XCTAssertEqual(BackendComponentStatus.tone("OK"), .success)
        XCTAssertEqual(BackendComponentStatus.tone("Degraded"), .warning)
    }

    func testIsOKIsCaseExactLikeWeb() {
        XCTAssertTrue(BackendComponentStatus.isOK("ok"))
        XCTAssertTrue(BackendComponentStatus.isOK("healthy"))
        // Web `okCount` uses `===` so only lowercase ok/healthy count.
        XCTAssertFalse(BackendComponentStatus.isOK("OK"))
        XCTAssertFalse(BackendComponentStatus.isOK("online"))
    }
}

// MARK: - Adapter: projection

final class BackendStatusProjectionTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    func testComponentRowsMapEveryFieldPreserveOrderAndToneAndEmptyLastCheck() {
        let rows = BackendStatusProjection.componentRows(from: BackendStatusFixture.components)
        XCTAssertEqual(rows.map(\.name), ["database", "redis", "mqtt", "tesla_api"])
        XCTAssertEqual(rows[0].tone, .success)
        XCTAssertEqual(rows[2].tone, .warning)
        XCTAssertEqual(rows[3].tone, .danger)
        XCTAssertEqual(rows[2].failures, 2)
        XCTAssertEqual(rows[2].latencyMs, 124.5)
        XCTAssertEqual(rows[0].lastCheckISO, "2026-04-15T09:30:00Z")
        // Empty last_check projects to nil (em-dash at the boundary).
        XCTAssertNil(rows[3].lastCheckISO)
        XCTAssertEqual(rows[0].id, "database")
    }

    func testOkCountMatchesWeb() {
        let rows = BackendStatusProjection.componentRows(from: BackendStatusFixture.components)
        XCTAssertEqual(BackendStatusProjection.okCount(rows), 2)
    }

    func testPoolStatsAreFiveOrderedFormattedTiles() {
        let stats = BackendStatusProjection.poolStats(from: BackendStatusFixture.pool, locale: locale)
        XCTAssertEqual(stats.map(\.metric), [.maxOpen, .open, .inUse, .idle, .waitCount])
        XCTAssertEqual(stats.map(\.value), ["25", "12", "5", "7", "3"])
    }

    func testRuntimeRowsPreferVersionThenSystem() {
        let rows = BackendStatusProjection.runtimeRows(
            version: BackendStatusFixture.version,
            system: BackendStatusFixture.system,
            locale: locale
        )
        XCTAssertEqual(rows.map(\.labelKey), ["Go Version", "Uptime", "Goroutines", "OS / Arch"])
        XCTAssertEqual(rows[0].value, "go1.25.1")
        XCTAssertEqual(rows[1].value, "2d 3h 0m")
        XCTAssertEqual(rows[2].value, "142")
        XCTAssertEqual(rows[3].value, "linux / arm64")
    }

    func testRuntimeRowsFallBackToSystemWhenNoVersion() {
        let rows = BackendStatusProjection.runtimeRows(
            version: nil,
            system: SystemInfoDTO(goroutines: 9, goVersion: "go1.25.0", uptimeSeconds: 61),
            locale: locale
        )
        XCTAssertEqual(rows[0].value, "go1.25.0")
        XCTAssertEqual(rows[1].value, "1m")
        XCTAssertEqual(rows[2].value, "9")
        // No version → OS / Arch is the em-dash fallback (web `version ? … : '—'`).
        XCTAssertEqual(rows[3].value, "—")
    }

    func testHasRuntime() {
        XCTAssertTrue(BackendStatusProjection.hasRuntime(version: BackendStatusFixture.version, system: nil))
        XCTAssertTrue(BackendStatusProjection.hasRuntime(version: nil, system: BackendStatusFixture.system))
        XCTAssertFalse(BackendStatusProjection.hasRuntime(version: nil, system: nil))
    }

    func testResolvePhase() {
        XCTAssertEqual(
            BackendStatusProjection.resolvePhase(.loading, hasComponents: false, hasPool: false, hasRuntime: false),
            .loading
        )
        XCTAssertEqual(
            BackendStatusProjection.resolvePhase(.failed("boom"), hasComponents: true, hasPool: true, hasRuntime: true),
            .error("boom")
        )
        XCTAssertEqual(
            BackendStatusProjection.resolvePhase(.loaded, hasComponents: true, hasPool: false, hasRuntime: false),
            .content
        )
        XCTAssertEqual(
            BackendStatusProjection.resolvePhase(.loaded, hasComponents: false, hasPool: true, hasRuntime: false),
            .content
        )
        XCTAssertEqual(
            BackendStatusProjection.resolvePhase(.loaded, hasComponents: false, hasPool: false, hasRuntime: true),
            .content
        )
        XCTAssertEqual(
            BackendStatusProjection.resolvePhase(.loaded, hasComponents: false, hasPool: false, hasRuntime: false),
            .empty
        )
    }
}

// MARK: - Adapter: formatting

final class BackendStatusFormatTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let zone = TimeZone(identifier: "UTC")!

    func testNumberAndIntGroupAndRound() {
        XCTAssertEqual(BackendStatusFormat.number(1234.56, fractionDigits: 1, locale: locale), "1,234.6")
        XCTAssertEqual(BackendStatusFormat.int(12345, locale: locale), "12,345")
    }

    func testLatencyHasMillisecondSuffix() {
        XCTAssertEqual(BackendStatusFormat.latency(124.5, locale: locale), "124.5 ms")
        XCTAssertEqual(BackendStatusFormat.latency(0, locale: locale), "0.0 ms")
    }

    func testUptimeMatchesWebFormatUptime() {
        XCTAssertEqual(BackendStatusFormat.uptime(183_600), "2d 3h 0m") // 2 days 3 hours
        XCTAssertEqual(BackendStatusFormat.uptime(3661), "1h 1m") // 1 hour 1 min
        XCTAssertEqual(BackendStatusFormat.uptime(125), "2m") // < 1 hour
        XCTAssertEqual(BackendStatusFormat.uptime(0), "0m")
        XCTAssertEqual(BackendStatusFormat.uptime(-5), "0m")
    }

    func testParseAcceptsIsoWithAndWithoutFractionAndRejectsGarbage() {
        XCTAssertNotNil(BackendStatusFormat.parse("2026-04-15T09:30:00.500Z"))
        XCTAssertNotNil(BackendStatusFormat.parse("2026-04-15T09:30:00Z"))
        XCTAssertNil(BackendStatusFormat.parse(""))
        XCTAssertNil(BackendStatusFormat.parse("not-a-date"))
    }

    func testDateTimeRendersDateAndTime() {
        let label = BackendStatusFormat.dateTime("2026-04-15T09:30:00Z", locale: locale, timeZone: zone)
        XCTAssertTrue(label.contains("2026"))
        XCTAssertTrue(label.contains("Apr"))
    }

    func testDateTimeEmDashForMissingOrInvalid() {
        XCTAssertEqual(BackendStatusFormat.dateTime(nil, locale: locale, timeZone: zone), "—")
        XCTAssertEqual(BackendStatusFormat.dateTime("", locale: locale, timeZone: zone), "—")
        XCTAssertEqual(BackendStatusFormat.dateTime("garbage", locale: locale, timeZone: zone), "—")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(BackendStatusSurface.slug, "BackendStatusSection")
        XCTAssertEqual(BackendStatusSection.surfaceSlug, "BackendStatusSection")
    }
}

// MARK: - Accessibility: VoiceOver summaries

final class BackendStatusAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSectionSummaryWithComponentsShowsHealthyTally() {
        let rows = BackendStatusProjection.componentRows(from: BackendStatusFixture.components)
        let summary = BackendStatusAccessibility.sectionSummary(
            componentCount: rows.count,
            okCount: BackendStatusProjection.okCount(rows),
            hasPool: true,
            hasRuntime: true,
            localize: echo
        )
        XCTAssertEqual(summary, "Backend Status: 2/4 healthy")
    }

    func testSectionSummaryEmptyUsesFriendlyMessage() {
        let summary = BackendStatusAccessibility.sectionSummary(
            componentCount: 0, okCount: 0, hasPool: false, hasRuntime: false, localize: echo
        )
        XCTAssertTrue(summary.contains("No backend status available"))
    }

    func testSectionSummaryNoComponentsButPoolReturnsTitleOnly() {
        let summary = BackendStatusAccessibility.sectionSummary(
            componentCount: 0, okCount: 0, hasPool: true, hasRuntime: false, localize: echo
        )
        XCTAssertEqual(summary, "Backend Status")
    }

    func testComponentLabelIncludesEveryField() throws {
        let rows = BackendStatusProjection.componentRows(from: BackendStatusFixture.components)
        let mqtt = try XCTUnwrap(rows.first { $0.name == "mqtt" })
        let label = BackendStatusAccessibility.componentLabel(
            mqtt,
            latencyText: "124.5 ms",
            lastCheckText: "Apr 15, 2026 at 9:29 AM",
            localize: echo
        )
        XCTAssertTrue(label.contains("degraded"))
        XCTAssertTrue(label.contains("mqtt"))
        XCTAssertTrue(label.contains("Latency 124.5 ms"))
        XCTAssertTrue(label.contains("Failures 2"))
        XCTAssertTrue(label.contains("Last Check Apr 15, 2026"))
    }
}
