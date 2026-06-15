import XCTest
@testable import TeslaSync

/// State-machine tests for `SecretRotationPageModel` — every data state the page renders
/// (loading / empty / error / success, plus the 503 subsystem-unavailable variant), the
/// summary tallies, the severity fold, the kind/severity label maps, and the
/// display-boundary formatters (`fmtNumber` / thresholds / `formatDateTime` /
/// `formatDate` / `formatRelative`) ported from the web.
@MainActor final class SecretRotationPageModelTests: XCTestCase {
    private struct StubSource: SecretRotationDataSource {
        var rows: [SecretRotationStatus] = []
        var unavailable = false
        var fails = false

        func load() async throws -> [SecretRotationStatus] {
            if unavailable { throw SecretRotationSubsystemUnavailable() }
            if fails { throw StubError() }
            return rows
        }
    }

    private struct StubError: Error {}

    private func secret(
        _ kind: String,
        target: String? = nil,
        rotated: String = "2026-06-01T00:00:00Z",
        age: Int = 14,
        expires: String? = nil,
        daysToExpiry: Int? = nil,
        warn: Int = 90,
        critical: Int = 180,
        severity: SecretRotationSeverity = .ok
    ) -> SecretRotationStatus {
        SecretRotationStatus(
            kind: kind,
            targetID: target,
            lastRotated: rotated,
            ageDays: age,
            expiresAt: expires,
            daysToExpiry: daysToExpiry,
            warnDays: warn,
            criticalDays: critical,
            severity: severity
        )
    }

    private static let utc = TimeZone.gmt

    // MARK: - States

    func testInitialStateIsLoading() {
        let model = SecretRotationPageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .loading)
        XCTAssertFalse(model.showsSummary)
        XCTAssertFalse(model.isSubsystemUnavailable)
        XCTAssertFalse(model.hasCriticalOverdue)
        XCTAssertTrue(model.rows.isEmpty)
    }

    func testLoadSuccessPopulatesRows() async {
        let rows = [secret("session_jwk")]
        let model = SecretRotationPageModel(dataSource: StubSource(rows: rows))
        await model.load()
        XCTAssertEqual(model.state, .loaded(rows))
        XCTAssertTrue(model.showsSummary)
        XCTAssertEqual(model.rows.count, 1)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = SecretRotationPageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertFalse(model.showsSummary)
    }

    func testLoad503YieldsUnavailableState() async {
        let model = SecretRotationPageModel(dataSource: StubSource(unavailable: true))
        await model.load()
        XCTAssertEqual(model.state, .unavailable)
        XCTAssertTrue(model.isSubsystemUnavailable)
        XCTAssertFalse(model.showsSummary)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = SecretRotationPageModel(dataSource: StubSource(fails: true))
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
        XCTAssertFalse(model.isSubsystemUnavailable)
    }

    func testRefreshReloads() async {
        let model = SecretRotationPageModel(dataSource: StubSource(rows: [secret("session_jwk")]))
        await model.load()
        await model.refresh()
        XCTAssertTrue(model.showsSummary)
    }

    // MARK: - Summary tallies (web `counts`)

    func testCountsTallyBySeverity() async {
        let rows = [
            secret("a", severity: .ok),
            secret("b", severity: .ok),
            secret("c", severity: .warn),
            secret("d", severity: .critical),
            secret("e", severity: .unknown)
        ]
        let model = SecretRotationPageModel(dataSource: StubSource(rows: rows))
        await model.load()
        let counts = model.counts
        XCTAssertEqual(counts.total, 5)
        XCTAssertEqual(counts.ok, 2)
        XCTAssertEqual(counts.warn, 1)
        XCTAssertEqual(counts.critical, 1)
        XCTAssertTrue(model.hasCriticalOverdue)
    }

    func testCountsZeroWhenNotLoaded() {
        let model = SecretRotationPageModel(dataSource: StubSource())
        XCTAssertEqual(model.counts.total, 0)
        XCTAssertFalse(model.hasCriticalOverdue)
    }

    // MARK: - Identity (web keyExtractor)

    func testIdCombinesKindAndTarget() {
        XCTAssertEqual(secret("mqtt_mtls_cert", target: "broker").id, "mqtt_mtls_cert:broker")
        XCTAssertEqual(secret("session_jwk").id, "session_jwk:")
    }

    // MARK: - Severity fold + maps

    func testSeverityFoldsUnknownToken() {
        XCTAssertEqual(SecretRotationSeverity(wire: "ok"), .ok)
        XCTAssertEqual(SecretRotationSeverity(wire: "warn"), .warn)
        XCTAssertEqual(SecretRotationSeverity(wire: "critical"), .critical)
        XCTAssertEqual(SecretRotationSeverity(wire: "bogus"), .unknown)
    }

    func testSeverityBadgeLabelsAndTones() {
        XCTAssertEqual(SecretRotationSeverityBadge.label(.ok), "OK")
        XCTAssertEqual(SecretRotationSeverityBadge.label(.warn), "Rotate soon")
        XCTAssertEqual(SecretRotationSeverityBadge.label(.critical), "Overdue")
        XCTAssertEqual(SecretRotationSeverityBadge.label(.unknown), "—")
        XCTAssertEqual(SecretRotationSeverityBadge.tone(.ok), .success)
        XCTAssertEqual(SecretRotationSeverityBadge.tone(.warn), .warning)
        XCTAssertEqual(SecretRotationSeverityBadge.tone(.critical), .danger)
        XCTAssertEqual(SecretRotationSeverityBadge.tone(.unknown), .neutral)
    }

    func testKindLabelMapAndFallback() {
        XCTAssertEqual(SecretRotationTable.kindLabel("tesla_refresh_token"), "Tesla refresh token")
        XCTAssertEqual(SecretRotationTable.kindLabel("mqtt_mtls_cert"), "MQTT mTLS certificate")
        XCTAssertEqual(SecretRotationTable.kindLabel("database_password"), "Database password")
        XCTAssertEqual(SecretRotationTable.kindLabel("session_jwk"), "Session JWK")
        XCTAssertEqual(SecretRotationTable.kindLabel("app_signing_key"), "App signing key")
        XCTAssertEqual(SecretRotationTable.kindLabel("authentik_secret"), "Authentik client secret")
        XCTAssertEqual(SecretRotationTable.kindLabel("future_kind"), "future_kind")
    }

    // MARK: - Number formatter (web `fmtNumber`)

    func testNumberUsesGroupingAndDefaultPrecision() {
        XCTAssertEqual(SecretRotationFormat.number(42), "42.00")
        XCTAssertEqual(SecretRotationFormat.number(1234.5), "1,234.50")
        XCTAssertEqual(SecretRotationFormat.number(1000, decimals: 0), "1,000")
    }

    func testThresholdsCell() {
        XCTAssertEqual(SecretRotationFormat.thresholds(warnDays: 30, criticalDays: 90), "30.00d / 90.00d")
    }

    // MARK: - Date / relative formatters (web `formatDateTime` / `formatDate` / `formatRelative`)

    func testParseISOHandlesPlainAndFractional() {
        XCTAssertNotNil(SecretRotationFormat.parseISO("2026-06-14T23:36:00Z"))
        XCTAssertNotNil(SecretRotationFormat.parseISO("2026-06-14T23:36:00.500Z"))
        XCTAssertNil(SecretRotationFormat.parseISO("not-a-date"))
    }

    func testDateTimeFormatsAndEmptyFallback() {
        XCTAssertEqual(
            SecretRotationFormat.dateTime("2026-06-14T23:36:00Z", timeZone: Self.utc),
            "Jun 14, 2026, 11:36 PM"
        )
        XCTAssertEqual(SecretRotationFormat.dateTime(nil), "—")
        XCTAssertEqual(SecretRotationFormat.dateTime("garbage"), "—")
    }

    func testDateOnlyFormatsAndEmptyFallback() {
        XCTAssertEqual(SecretRotationFormat.dateOnly("2026-06-14T23:36:00Z", timeZone: Self.utc), "Jun 14, 2026")
        XCTAssertEqual(SecretRotationFormat.dateOnly(nil), "—")
    }

    func testRelativeBuckets() throws {
        let base = try XCTUnwrap(SecretRotationFormat.parseISO("2026-06-14T12:00:00Z"))
        func rel(_ offset: TimeInterval) -> String {
            SecretRotationFormat.relative(
                "2026-06-14T12:00:00Z",
                now: base.addingTimeInterval(offset),
                timeZone: Self.utc
            )
        }
        XCTAssertEqual(rel(30), "just now")
        XCTAssertEqual(rel(5 * 60), "5m ago")
        XCTAssertEqual(rel(3 * 3600), "3h ago")
        XCTAssertEqual(rel(3 * 86400), "3d ago")
        XCTAssertEqual(rel(10 * 86400), "Jun 14, 2026")
        XCTAssertEqual(SecretRotationFormat.relative(nil), "—")
    }

    // MARK: - Default seed

    func testSampleDataSourceIsNonEmptyAndWellFormed() async throws {
        let rows = try await SampleSecretRotationDataSource().load()
        XCTAssertFalse(rows.isEmpty)
        XCTAssertTrue(rows.allSatisfy { !$0.kind.isEmpty })
        XCTAssertEqual(Set(rows.map(\.id)).count, rows.count, "row ids are unique")
        XCTAssertTrue(rows.contains { $0.severity == .critical }, "seed exercises the overdue tier")
    }
}
