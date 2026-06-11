//
//  ExportModal.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0023 · ExportModal (Apple)
//
//  State-holder coverage for `ExportModel`: the P1/S11 `view.opened` telemetry (once + idempotent), the
//  phase transitions across loading / loaded-empty / failed (incl. the inline-error envelope when a
//  resolved dashboard survives a failed reload), the derived export projections seeded on populate (the
//  pretty JSON, the size badge, the share URL + its over-length guard + warning, the widget-count /
//  updated copy, and the mini-grid), the projection reset when no dashboard resolves, the clipboard
//  commands (copy JSON / share URL, the over-length + no-dashboard no-ops), the download seam (request +
//  finish, guarded without a dashboard), the close, the stale auto-refresh (once, re-armed on return to
//  live), and offline keeping the cached dashboard. Driven through the in-memory source + spies — no
//  network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyExportTelemetry: ExportTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }
}

/// Records the copied strings (web `CopyButton`). Lock-guarded for the `Sendable` clipboard seam.
private final class SpyExportClipboard: ExportClipboard, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func copy(_ text: String) {
        lock.lock(); storage.append(text); lock.unlock()
    }

    var copied: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }
}

/// Records the download requests (web `onDownload`). Lock-guarded for the `Sendable` action seam.
private final class RecordingExportActions: ExportActions, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [ExportDownloadRequest] = []

    func download(_ request: ExportDownloadRequest) {
        lock.lock(); storage.append(request); lock.unlock()
    }

    var requests: [ExportDownloadRequest] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }
}

/// A constant date format so the "Updated {date}" copy is deterministic.
private struct FixedExportDateFormatting: ExportDateFormatting {
    func format(_: Date) -> String {
        "FMT"
    }
}

private enum ModelSample {
    static let updated = Date(timeIntervalSince1970: 1_767_268_800)

    static func dashboard() -> DashboardExportDescriptor {
        DashboardExportDescriptor(
            id: "dash-1",
            name: "Garage",
            icon: "🔋",
            widgets: [
                ExportWidgetInstance(id: "w1", widgetID: "battery", config: .object(["k": .int(1)])),
                ExportWidgetInstance(id: "w2", widgetID: "speed")
            ],
            layouts: ["lg": [
                ExportLayoutItem(itemID: "w1", x: 0, y: 0, width: 2, height: 2),
                ExportLayoutItem(itemID: "w2", x: 2, y: 0, width: 2, height: 2)
            ]],
            updatedAt: updated
        )
    }

    /// A deliberately huge dashboard whose share URL exceeds the 2000-character ceiling.
    static func hugeDashboard() -> DashboardExportDescriptor {
        let widgets = (0 ..< 400).map { index in
            ExportWidgetInstance(
                id: "widget-instance-\(index)",
                widgetID: "battery-health",
                config: .object(["label": .string(String(repeating: "x", count: 24))])
            )
        }
        let layout = (0 ..< 400).map { index in
            ExportLayoutItem(itemID: "widget-instance-\(index)", x: 0, y: index, width: 1, height: 1)
        }
        return DashboardExportDescriptor(
            id: "huge", name: "Huge", widgets: widgets, layouts: ["lg": layout], updatedAt: updated
        )
    }

    static func update(
        status: ExportLoadStatus = .loaded,
        connection: ExportConnection = .live,
        dashboard: DashboardExportDescriptor? = dashboard()
    ) -> ExportUpdate {
        ExportUpdate(status: status, dashboard: dashboard, connection: connection)
    }
}

@MainActor
final class ExportModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryExportSource,
        telemetry: SpyExportTelemetry = SpyExportTelemetry(),
        actions: RecordingExportActions = RecordingExportActions(),
        clipboard: SpyExportClipboard = SpyExportClipboard()
    ) -> ExportModel {
        ExportModel(
            source: source,
            telemetry: telemetry,
            actions: actions,
            clipboard: clipboard,
            originProvider: DefaultExportURLOrigin(origin: "https://app.teslasync.io"),
            dates: FixedExportDateFormatting(),
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let telemetry = SpyExportTelemetry()
        let model = makeModel(
            source: InMemoryExportSource(initial: ModelSample.update()),
            telemetry: telemetry
        )
        model.start()
        model.start()
        XCTAssertEqual(telemetry.surfaces, ["ExportModal"])
    }

    // MARK: Phase

    func testLoadingWithoutDashboardIsLoadingPhase() {
        let model = makeModel(source: InMemoryExportSource(
            initial: ModelSample.update(status: .loading, dashboard: nil)
        ))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDashboardIsPopulatedAndSeedsProjections() {
        let model = makeModel(source: InMemoryExportSource(initial: ModelSample.update()))
        model.start()
        XCTAssertEqual(model.phase, .populated)
        XCTAssertNil(model.inlineErrorMessage)
        XCTAssertFalse(model.dashboardJSON.isEmpty)
        XCTAssertFalse(model.jsonSizeText.isEmpty)
        XCTAssertTrue(model.shareURL.hasPrefix("https://app.teslasync.io/dashboard#import="))
        XCTAssertEqual(model.widgetCountText, "2 widgets")
        XCTAssertEqual(model.updatedText, "Updated FMT")
        XCTAssertEqual(model.miniGrid.cells.count, 2)
        XCTAssertFalse(model.shareURLTooLong)
        XCTAssertNil(model.shareWarningMessage)
    }

    func testLoadedWithoutDashboardIsEmptyAndResetsProjections() {
        let model = makeModel(source: InMemoryExportSource(
            initial: ModelSample.update(status: .loaded, dashboard: nil)
        ))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.dashboardJSON.isEmpty)
        XCTAssertTrue(model.shareURL.isEmpty)
        XCTAssertTrue(model.widgetCountText.isEmpty)
        XCTAssertTrue(model.miniGrid.cells.isEmpty)
    }

    func testFailedWithoutDashboardIsError() {
        let model = makeModel(source: InMemoryExportSource(
            initial: ModelSample.update(status: .failed("boom"), dashboard: nil)
        ))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedReloadWithDashboardKeepsPanelAndShowsInlineError() {
        let source = InMemoryExportSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(status: .failed("reload failed")))
        XCTAssertEqual(model.phase, .populated)
        XCTAssertEqual(model.inlineErrorMessage, "reload failed")
    }

    // MARK: Copy commands

    func testCopyJSONCopiesPrettyJSON() {
        let clipboard = SpyExportClipboard()
        let model = makeModel(
            source: InMemoryExportSource(initial: ModelSample.update()),
            clipboard: clipboard
        )
        model.start()
        model.copyJSON()
        XCTAssertEqual(clipboard.copied, [model.dashboardJSON])
    }

    func testCopyShareURLCopiesURL() {
        let clipboard = SpyExportClipboard()
        let model = makeModel(
            source: InMemoryExportSource(initial: ModelSample.update()),
            clipboard: clipboard
        )
        model.start()
        model.copyShareURL()
        XCTAssertEqual(clipboard.copied, [model.shareURL])
    }

    func testCopyShareURLIsNoOpWhenTooLong() {
        let clipboard = SpyExportClipboard()
        let model = makeModel(
            source: InMemoryExportSource(initial: ModelSample.update(dashboard: ModelSample.hugeDashboard())),
            clipboard: clipboard
        )
        model.start()
        XCTAssertTrue(model.shareURLTooLong)
        XCTAssertNotNil(model.shareWarningMessage)
        model.copyShareURL()
        XCTAssertTrue(clipboard.copied.isEmpty)
    }

    func testCopyCommandsAreNoOpsWithoutDashboard() {
        let clipboard = SpyExportClipboard()
        let model = makeModel(
            source: InMemoryExportSource(initial: ModelSample.update(status: .loaded, dashboard: nil)),
            clipboard: clipboard
        )
        model.start()
        model.copyJSON()
        model.copyShareURL()
        XCTAssertTrue(clipboard.copied.isEmpty)
    }

    // MARK: Download + close

    func testRequestDownloadBuildsRequestAndFinishes() {
        let actions = RecordingExportActions()
        let model = makeModel(
            source: InMemoryExportSource(initial: ModelSample.update()),
            actions: actions
        )
        model.start()
        model.requestDownload()
        XCTAssertEqual(actions.requests.count, 1)
        XCTAssertEqual(actions.requests.first?.fileName, "Garage.json")
        XCTAssertEqual(actions.requests.first?.json, model.dashboardJSON)
        XCTAssertTrue(model.didFinish)
    }

    func testRequestDownloadIsNoOpWithoutDashboard() {
        let actions = RecordingExportActions()
        let model = makeModel(
            source: InMemoryExportSource(initial: ModelSample.update(status: .loaded, dashboard: nil)),
            actions: actions
        )
        model.start()
        model.requestDownload()
        XCTAssertTrue(actions.requests.isEmpty)
        XCTAssertFalse(model.didFinish)
    }

    func testCloseFinishes() {
        let model = makeModel(source: InMemoryExportSource(initial: ModelSample.update()))
        model.start()
        model.close()
        XCTAssertTrue(model.didFinish)
    }

    // MARK: Auto-refresh

    func testStaleTriggersOneAutoRefreshReArmedOnLive() {
        let source = InMemoryExportSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ModelSample.update(connection: .live))
        source.push(ModelSample.update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let source = InMemoryExportSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        source.push(ModelSample.update(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopStopsSource() {
        let source = InMemoryExportSource(initial: ModelSample.update())
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
