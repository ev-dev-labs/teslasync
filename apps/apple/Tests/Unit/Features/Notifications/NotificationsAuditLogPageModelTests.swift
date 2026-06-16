import XCTest
@testable import TeslaSync

/// State-machine + display-helper tests for `NotificationsAuditLogPageModel` — the data
/// states the page renders (loading / empty / error / success), the client-side search
/// (web `useFilteredList` over action/resource/details), the active-filter chip flag, and
/// the `AuditEntryFormat` timestamp formatter (web `formatDateTime`) ported from the web.
@MainActor final class NotificationsAuditLogPageModelTests: XCTestCase {
    private struct StubSource: NotificationsAuditLogDataSource {
        var entries: [AuditLogEntry] = []
        var fails = false

        func loadAuditLogs() async throws -> [AuditLogEntry] {
            if fails { throw StubError() }
            return entries
        }
    }

    private struct StubError: Error {}

    private func entry(
        _ id: String,
        action: String = "login",
        resource: String = "session",
        details: String = "Operator console sign-in"
    ) -> AuditLogEntry {
        AuditLogEntry(
            id: id,
            action: action,
            resource: resource,
            details: details,
            createdAt: "2026-06-13T17:42:09Z"
        )
    }

    // MARK: - List states

    func testInitialStateIsLoading() {
        let model = NotificationsAuditLogPageModel(dataSource: StubSource())
        XCTAssertEqual(model.state, .loading)
        XCTAssertTrue(model.entries.isEmpty)
        XCTAssertFalse(model.hasActiveSearch)
    }

    func testLoadSuccessPopulatesEntries() async {
        let rows = [entry("2"), entry("1")]
        let model = NotificationsAuditLogPageModel(dataSource: StubSource(entries: rows))
        await model.load()
        XCTAssertEqual(model.state, .loaded(rows))
        XCTAssertEqual(model.entries.count, 2)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = NotificationsAuditLogPageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertTrue(model.entries.isEmpty)
    }

    func testLoadFailureYieldsErrorState() async {
        let model = NotificationsAuditLogPageModel(dataSource: StubSource(fails: true))
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
    }

    // MARK: - Search (web useFilteredList + ActiveFilterChips)

    func testFilterMatchesAcrossFieldsCaseInsensitively() async {
        let rows = [
            entry("1", action: "vehicle.wake", resource: "vehicle#3", details: "Wake rejected"),
            entry("2", action: "export.create", resource: "gdpr_export#88", details: "Queued export"),
            entry("3", action: "login", resource: "session", details: "Console sign-in")
        ]
        let model = NotificationsAuditLogPageModel(dataSource: StubSource(entries: rows))
        await model.load()

        model.search = "EXPORT" // matches action + resource on row 2
        XCTAssertEqual(model.filteredEntries.map(\.id), ["2"])

        model.search = "vehicle" // matches action + resource on row 1
        XCTAssertEqual(model.filteredEntries.map(\.id), ["1"])

        model.search = "sign-in" // matches details on row 3
        XCTAssertEqual(model.filteredEntries.map(\.id), ["3"])
    }

    func testBlankSearchReturnsAllAndHidesChip() async {
        let rows = [entry("1"), entry("2")]
        let model = NotificationsAuditLogPageModel(dataSource: StubSource(entries: rows))
        await model.load()

        model.search = "   " // whitespace trims to empty → full list, but chip shows (non-empty)
        XCTAssertEqual(model.filteredEntries.count, 2)
        XCTAssertTrue(model.hasActiveSearch)

        model.search = ""
        XCTAssertEqual(model.filteredEntries.count, 2)
        XCTAssertFalse(model.hasActiveSearch)
    }

    func testNoMatchesYieldsEmptyFilteredList() async {
        let model = NotificationsAuditLogPageModel(dataSource: StubSource(entries: [entry("1")]))
        await model.load()
        model.search = "zzz-nothing-matches"
        XCTAssertTrue(model.filteredEntries.isEmpty)
        XCTAssertTrue(model.hasActiveSearch)
    }

    func testClearSearchResetsBox() async {
        let model = NotificationsAuditLogPageModel(dataSource: StubSource(entries: [entry("1")]))
        await model.load()
        model.search = "login"
        model.clearSearch()
        XCTAssertEqual(model.search, "")
        XCTAssertFalse(model.hasActiveSearch)
    }

    // MARK: - Formatter (web formatDateTime) + sample seed

    func testDateTimeFormatsValidAndFallsBack() {
        XCTAssertEqual(AuditEntryFormat.dateTime(nil), "—")
        XCTAssertEqual(AuditEntryFormat.dateTime("not-a-date"), "—")
        XCTAssertNotEqual(AuditEntryFormat.dateTime("2026-06-13T17:42:09Z"), "—")
    }

    func testFilterIsPureOverEmptyInput() {
        XCTAssertTrue(AuditEntryFormat.filter([], query: "x").isEmpty)
        let rows = [entry("1", action: "login")]
        XCTAssertEqual(AuditEntryFormat.filter(rows, query: "").count, 1)
    }

    func testSampleDataSourceIsNonEmpty() async throws {
        let source = SampleNotificationsAuditLogDataSource()
        let all = try await source.loadAuditLogs()
        XCTAssertFalse(all.isEmpty)
        XCTAssertEqual(Set(all.map(\.id)).count, all.count, "row ids are unique")
    }

    // MARK: - Route registration + deep-link parsing

    func testRouteRegistrationHostsNotificationsAudit() {
        let registry = NotificationsAuditLogRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.notificationsAudit))
        XCTAssertNotNil(registry.view(for: .notificationsAudit))
    }

    func testDeepLinkResolvesToNotificationsAudit() {
        XCTAssertEqual(AppRouteParser.parse(path: "/notifications/audit"), .notificationsAudit)
        XCTAssertEqual(AppRoute.notificationsAudit.path, "/notifications/audit")
        XCTAssertEqual(AppRoute.notificationsAudit.group, .operations)
    }
}
