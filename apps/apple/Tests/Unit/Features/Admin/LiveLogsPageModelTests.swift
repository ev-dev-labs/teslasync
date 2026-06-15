import SwiftUI
import XCTest
@testable import TeslaSync

/// State-machine + projection tests for `LiveLogsPageModel` and `LiveLogsFormat` — the live
/// connection status precedence (web `ConnectionBadge`), the rolling buffer (append / FIFO cap
/// / clear), the pause / vehicle-filter / grep / reconnect behaviors, the ADR-013 staleness
/// clock, and the display-boundary projections ported from the web `LiveLogsPage` (`formatTime`,
/// `extractMessage` / `extractFields` / `extractVehicleId`, `downloadFilename`, `eventToText`).
@MainActor final class LiveLogsPageModelTests: XCTestCase {
    private func model(
        _ elements: [LiveLogStreamElement] = [],
        finishes: Bool = true,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) -> LiveLogsPageModel {
        LiveLogsPageModel(source: ScriptedLiveLogsSource(elements, finishes: finishes), clock: clock)
    }

    // MARK: - Connection status (web ConnectionBadge precedence)

    func testInitialStatusIsConnecting() {
        let model = model()
        XCTAssertEqual(model.status, .connecting)
        XCTAssertEqual(model.tableState, .empty)
        XCTAssertTrue(model.events.isEmpty)
        XCTAssertNil(model.errorDetail)
    }

    func testConnectedThenPausedThenError() {
        let model = model()
        model.ingest(.connected)
        XCTAssertEqual(model.status, .connected)
        model.togglePause()
        XCTAssertEqual(model.status, .paused)
        model.ingest(.failed(detail: "403 Forbidden"))
        XCTAssertEqual(model.status, .error)
        XCTAssertEqual(model.errorDetail, "403 Forbidden")
    }

    // MARK: - Ingestion (web useLogStream frame handling)

    func testRunIngestsLogsDropsAndFinishes() async {
        let payload = #"{"level":"warn","message":"cache miss","vehicle_id":"7","component":"cache"}"#
        let model = model([.connected, .log(payload: payload), .drop(count: 3)])
        await model.run()
        XCTAssertEqual(model.totalReceived, 1)
        XCTAssertEqual(model.drops, 3)
        XCTAssertEqual(model.events.first?.message, "cache miss")
        XCTAssertEqual(model.events.first?.vehicleID, "7")
        XCTAssertEqual(model.events.first?.severity, .warning)
        XCTAssertEqual(model.tableState, .success)
        // A finished (non-failed) stream is no longer connected (web `finally` isConnected=false).
        XCTAssertFalse(model.isConnected)
        XCTAssertEqual(model.status, .connecting)
    }

    func testPauseHoldsBufferWithoutDropping() {
        let model = model()
        model.ingest(.connected)
        model.togglePause()
        model.ingest(.log(payload: #"{"level":"info","message":"ignored"}"#))
        XCTAssertTrue(model.events.isEmpty)
        XCTAssertEqual(model.totalReceived, 0)
        XCTAssertTrue(model.isConnected)
    }

    func testBufferEvictsOldestPastTheCap() {
        let model = model()
        for index in 0 ..< (LiveLogsPageModel.maxEvents + 5) {
            model.ingest(.log(payload: #"{"level":"info","message":"m\#(index)"}"#))
        }
        XCTAssertEqual(model.events.count, LiveLogsPageModel.maxEvents)
        XCTAssertEqual(model.totalReceived, LiveLogsPageModel.maxEvents + 5)
        // seq starts at 1; after evicting the first 5, the oldest retained seq is 6.
        XCTAssertEqual(model.events.first?.seq, 6)
    }

    func testClearResetsBufferAndCounters() {
        let model = model()
        model.ingest(.log(payload: #"{"level":"info","message":"a"}"#))
        model.ingest(.drop(count: 2))
        model.clear()
        XCTAssertTrue(model.events.isEmpty)
        XCTAssertEqual(model.drops, 0)
        XCTAssertEqual(model.totalReceived, 0)
    }

    // MARK: - Vehicle filter (web client-side filteredEvents)

    func testVehicleFilterNarrowsBuffer() {
        let model = model()
        model.ingest(.log(payload: #"{"level":"info","message":"a","vehicle_id":"3"}"#))
        model.ingest(.log(payload: #"{"level":"info","message":"b","vehicle_id":"7"}"#))
        model.vehicleFilter = "3"
        XCTAssertEqual(model.filteredEvents.count, 1)
        XCTAssertEqual(model.tableState, .success)
        XCTAssertTrue(model.canDownload)
        model.vehicleFilter = "999"
        XCTAssertTrue(model.filteredEvents.isEmpty)
        XCTAssertEqual(model.tableState, .empty)
        XCTAssertFalse(model.canDownload)
    }

    // MARK: - Subscription identity (web effect deps)

    func testGrepDraftDoesNotRestartUntilApplied() {
        let model = model()
        let before = model.subscription
        model.grepDraft = "mqtt|signal"
        XCTAssertEqual(model.subscription, before)
        model.applyGrep()
        XCTAssertEqual(model.grep, "mqtt|signal")
        XCTAssertNotEqual(model.subscription, before)
    }

    func testPauseDoesNotRestartSubscriptionButLevelAndReconnectDo() {
        let model = model()
        let base = model.subscription
        model.togglePause()
        XCTAssertEqual(model.subscription, base, "pause must not tear down the stream")
        model.level = .error
        XCTAssertNotEqual(model.subscription, base)
        let afterLevel = model.subscription
        model.reconnect()
        XCTAssertNotEqual(model.subscription, afterLevel)
        XCTAssertNil(model.errorDetail)
    }

    // MARK: - Staleness (ADR-013)

    func testStaleAfterWindowOfSilence() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let model = model(clock: { base })
        model.ingest(.connected)
        model.ingest(.log(payload: #"{"level":"info","message":"hi"}"#))
        XCTAssertFalse(model.isStale(asOf: base.addingTimeInterval(60)))
        XCTAssertTrue(model.isStale(asOf: base.addingTimeInterval(121)))
    }

    func testNotStaleWithoutAnyActivity() {
        let model = model()
        model.ingest(.connected)
        XCTAssertFalse(model.isStale(asOf: Date().addingTimeInterval(10000)))
    }

    func testOffersReconnectWhenNotLive() {
        let model = model()
        XCTAssertTrue(model.offersReconnect) // connecting
        model.ingest(.connected)
        XCTAssertFalse(model.offersReconnect) // connected
        model.ingest(.failed(detail: "x"))
        XCTAssertTrue(model.offersReconnect) // error
    }
}

/// Pure projection tests for `LiveLogsFormat` (bundle-independent).
final class LiveLogsFormatTests: XCTestCase {
    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    func testTimeFormatsHoursMinutesSecondsMillis() {
        XCTAssertEqual(LiveLogsFormat.time(Date(timeIntervalSince1970: 0), calendar: Self.utc), "00:00:00.000")
        XCTAssertEqual(LiveLogsFormat.time(Date(timeIntervalSince1970: 3661), calendar: Self.utc), "01:01:01.000")
    }

    func testMakeEntryExtractsLevelMessageFieldsVehicle() {
        let payload = #"{"level":"error","message":"boom","vehicle_id":3,"component":"x","ok":true,"n":5}"#
        let entry = LiveLogsFormat.makeEntry(seq: 1, payload: payload, receivedAt: Date(timeIntervalSince1970: 0))
        XCTAssertEqual(entry.level, "error")
        XCTAssertEqual(entry.message, "boom")
        XCTAssertEqual(entry.vehicleID, "3")
        XCTAssertEqual(entry.severity, .danger)
        XCTAssertEqual(entry.fields.map(\.key), ["component", "n", "ok", "vehicle_id"])
        XCTAssertEqual(entry.fields.map(\.value), ["x", "5", "true", "3"])
    }

    func testMakeEntryFallsBackForNonJSON() {
        let entry = LiveLogsFormat.makeEntry(seq: 2, payload: "plain line", receivedAt: Date(timeIntervalSince1970: 0))
        XCTAssertEqual(entry.level, "info")
        XCTAssertEqual(entry.message, "plain line")
        XCTAssertTrue(entry.fields.isEmpty)
        XCTAssertNil(entry.vehicleID)
    }

    func testTimestampReplacesColonsAndTrimsFraction() {
        XCTAssertEqual(LiveLogsFormat.timestamp(now: Date(timeIntervalSince1970: 0)), "1970-01-01T00-00-00Z")
    }

    func testGrepRegexHandlesEmptyValidAndInvalid() {
        XCTAssertNil(LiveLogsFormat.grepRegex("   "))
        XCTAssertNotNil(LiveLogsFormat.grepRegex("mqtt|signal_log"))
        XCTAssertNil(LiveLogsFormat.grepRegex("[unterminated"))
    }

    func testSeverityFromLevel() {
        XCTAssertEqual(LiveLogSeverity.from(level: "WARN"), .warning)
        XCTAssertEqual(LiveLogSeverity.from(level: "panic"), .danger)
        XCTAssertEqual(LiveLogSeverity.from(level: "trace"), .neutral)
        XCTAssertEqual(LiveLogSeverity.from(level: "info"), .info)
        XCTAssertEqual(LiveLogSeverity.from(level: "weird"), .neutral)
    }

    func testEventToTextAndDownloadBody() {
        let payload = #"{"level":"warn","message":"x"}"#
        let entry = LiveLogsFormat.makeEntry(seq: 1, payload: payload, receivedAt: Date(timeIntervalSince1970: 0))
        let line = LiveLogsFormat.eventToText(entry, calendar: Self.utc)
        XCTAssertEqual(line, "[00:00:00.000] WARN \(payload)")
        XCTAssertEqual(LiveLogsFormat.downloadBody([entry, entry], calendar: Self.utc), "\(line)\n\(line)")
    }

    func testGroupedUsesLocale() {
        XCTAssertEqual(LiveLogsFormat.grouped(1234, locale: Locale(identifier: "en_US")), "1,234")
    }
}

/// Route registration + deep-link parsing for the Live Logs surface.
@MainActor final class LiveLogsRouteRegistrationTests: XCTestCase {
    func testRegistersLiveLogsRoute() {
        let registry = LiveLogsRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.liveLogs))
        XCTAssertNotNil(registry.view(for: .liveLogs))
    }

    func testPreservesBaseRegistrations() {
        var base = AppRouteHostRegistry()
        base.register(.dashboard) { EmptyView() }
        let registry = LiveLogsRouteRegistration.registry(base: base)
        XCTAssertTrue(registry.registeredRoutes.contains(.dashboard))
        XCTAssertTrue(registry.registeredRoutes.contains(.liveLogs))
    }

    func testInjectedSourceIsUsed() {
        let registry = LiveLogsRouteRegistration.registry(source: ScriptedLiveLogsSource([.connected]))
        XCTAssertNotNil(registry.view(for: .liveLogs))
    }

    func testRouteMetadata() {
        XCTAssertEqual(AppRoute.liveLogs.pathSegment, "live-logs")
        XCTAssertEqual(AppRoute.liveLogs.path, "/live-logs")
        XCTAssertEqual(AppRoute.liveLogs.group, .system)
    }

    func testCanonicalAndAliasPathsParse() {
        XCTAssertEqual(AppRouteParser.parse(path: "/live-logs"), .liveLogs)
        XCTAssertEqual(AppRouteParser.parse(path: "/live-logs/"), .liveLogs)
        XCTAssertEqual(AppRouteParser.parse(path: "/admin/live-logs"), .liveLogs)
    }
}
