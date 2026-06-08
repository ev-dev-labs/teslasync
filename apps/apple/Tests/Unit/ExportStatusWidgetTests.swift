import XCTest
@testable import TeslaSync

/// Unit coverage for the Export Status dashboard widget: the pure merge/sort/format
/// adapter, the per-state view-state machine, the accessibility-label builder, and
/// the observable model's provider binding. These exercise every rendered branch
/// (loading / empty / error / content / stale / offline) without a snapshot library
/// (none is vendored), driving the same state the SwiftUI view switches on.
final class ExportStatusWidgetTests: XCTestCase {
    // MARK: Status normalisation

    func testStatusNormalisationIsLenient() {
        XCTAssertEqual(ExportJobStatus.normalised(from: "running"), .processing)
        XCTAssertEqual(ExportJobStatus.normalised(from: "PROCESSING"), .processing)
        XCTAssertEqual(ExportJobStatus.normalised(from: "done"), .ready)
        XCTAssertEqual(ExportJobStatus.normalised(from: "completed"), .ready)
        XCTAssertEqual(ExportJobStatus.normalised(from: "ready"), .ready)
        XCTAssertEqual(ExportJobStatus.normalised(from: "error"), .failed)
        XCTAssertEqual(ExportJobStatus.normalised(from: "failed"), .failed)
        XCTAssertEqual(ExportJobStatus.normalised(from: "unknown"), .queued)
        XCTAssertEqual(ExportJobStatus.normalised(from: ""), .queued)
    }

    func testStatusSortOrderMatchesWeb() {
        XCTAssertEqual(ExportJobStatus.processing.order, 0)
        XCTAssertEqual(ExportJobStatus.queued.order, 1)
        XCTAssertEqual(ExportJobStatus.ready.order, 2)
        XCTAssertEqual(ExportJobStatus.failed.order, 3)
    }

    // MARK: Merge / dedupe / sort

    func testMergeDedupesByIDWithAdminWinning() {
        let exports = [source(id: "a", status: "queued", minutesAgo: 5)]
        let admin = [source(id: "a", status: "ready", minutesAgo: 5)]

        let rows = ExportStatusReducer.merge(exports: exports, admin: admin)

        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.status, .ready, "admin feed must win on a shared id")
    }

    func testMergeSortsByStatusThenNewestFirst() {
        let exports = [
            source(id: "ready-old", status: "ready", minutesAgo: 60),
            source(id: "processing", status: "processing", minutesAgo: 2),
            source(id: "failed", status: "failed", minutesAgo: 1)
        ]
        let admin = [
            source(id: "queued", status: "queued", minutesAgo: 90),
            source(id: "ready-new", status: "ready", minutesAgo: 1)
        ]

        let rows = ExportStatusReducer.merge(exports: exports, admin: admin)

        // processing (0) → queued (1) → ready (2, newest first) → failed (3)
        XCTAssertEqual(rows.map(\.id), ["processing", "queued", "ready-new", "ready-old", "failed"])
    }

    func testActiveCountAndHasRunning() {
        let rows = ExportStatusReducer.merge(
            exports: [
                source(id: "p", status: "processing", minutesAgo: 1),
                source(id: "q", status: "queued", minutesAgo: 1)
            ],
            admin: [
                source(id: "r", status: "ready", minutesAgo: 1),
                source(id: "f", status: "failed", minutesAgo: 1)
            ]
        )

        XCTAssertEqual(ExportStatusReducer.activeCount(rows), 2, "processing + queued are active")
        XCTAssertTrue(ExportStatusReducer.hasRunning(rows))
    }

    func testHasRunningFalseWhenNoneProcessing() {
        let rows = ExportStatusReducer.merge(
            exports: [source(id: "q", status: "queued", minutesAgo: 1)],
            admin: []
        )
        XCTAssertFalse(ExportStatusReducer.hasRunning(rows))
    }

    // MARK: Formatting helpers

    func testFormatBytesMatchesWeb() {
        XCTAssertEqual(ExportStatusReducer.formatBytes(0), "—")
        XCTAssertEqual(ExportStatusReducer.formatBytes(-5), "—")
        XCTAssertEqual(ExportStatusReducer.formatBytes(512), "512 B")
        XCTAssertEqual(ExportStatusReducer.formatBytes(2048), "2.0 KB")
        XCTAssertEqual(ExportStatusReducer.formatBytes(1_572_864), "1.5 MB")
        XCTAssertEqual(ExportStatusReducer.formatBytes(1_610_612_736), "1.5 GB")
    }

    func testTruncateFilenameTakesBasenameAndEllipsises() {
        XCTAssertEqual(ExportStatusReducer.truncateFilename(nil, maxLength: 10), "—")
        XCTAssertEqual(ExportStatusReducer.truncateFilename("/exports/drives.csv", maxLength: 28), "drives.csv")
        XCTAssertEqual(
            ExportStatusReducer.truncateFilename("/a/very_long_export_filename.csv", maxLength: 10),
            "very_long…"
        )
    }

    func testEpochMillisParsesISOAndFallsBackToZero() {
        XCTAssertEqual(ExportStatusReducer.epochMillis("not-a-date"), 0)
        XCTAssertEqual(ExportStatusReducer.epochMillis(""), 0)
        XCTAssertGreaterThan(ExportStatusReducer.epochMillis("2026-01-01T00:00:00Z"), 0)
        XCTAssertGreaterThan(
            ExportStatusReducer.epochMillis("2026-01-01T00:00:00.500Z"),
            ExportStatusReducer.epochMillis("2026-01-01T00:00:00Z")
        )
    }

    // MARK: Accessibility label

    func testAccessibilityLabelComposesResolvedPieces() {
        let label = ExportStatusReducer.accessibilityLabel(
            filename: "drives.csv",
            format: "csv",
            size: "2.4 MB",
            status: "Ready",
            time: "4m ago"
        )
        XCTAssertEqual(label, "drives.csv, CSV, 2.4 MB, Ready, 4m ago")
    }

    func testAccessibilityLabelSkipsEmptyPieces() {
        let label = ExportStatusReducer.accessibilityLabel(
            filename: "—",
            format: "",
            size: "—",
            status: "Queued",
            time: ""
        )
        XCTAssertEqual(label, "—, —, —, Queued")
    }

    // MARK: View-state machine (per-rendered-state coverage)

    func testViewStateLoadingWhenInitialLoadAndNoRows() {
        let state = ExportStatusViewState(snapshot: .init(
            exports: .loading(cached: [], stale: false),
            admin: .loading(cached: [], stale: false)
        ))
        XCTAssertEqual(state.phase, .loading)
        XCTAssertFalse(state.isRefreshing)
    }

    func testViewStateEmptyWhenResolvedWithNoRows() {
        let state = ExportStatusViewState(snapshot: .init(
            exports: .empty(stale: false),
            admin: .empty(stale: false)
        ))
        XCTAssertEqual(state.phase, .empty)
    }

    func testViewStateErrorWhenFailedWithNoCache() {
        let state = ExportStatusViewState(snapshot: .init(
            exports: .failed(message: "x", cached: [], stale: false),
            admin: .idle
        ))
        XCTAssertEqual(state.phase, .error)
    }

    func testViewStateContentWhenRowsPresent() {
        let state = ExportStatusViewState(snapshot: .init(
            exports: .loaded([source(id: "p", status: "processing", minutesAgo: 1)], stale: false),
            admin: .idle
        ))
        XCTAssertEqual(state.phase, .content)
        XCTAssertEqual(state.rows.count, 1)
        XCTAssertEqual(state.activeCount, 1)
        XCTAssertTrue(state.hasRunning)
    }

    func testViewStateContentWithCachedRowsDuringErrorIsGraceful() {
        // A failed feed that still has cached rows must keep showing content (and
        // surface staleness), not blank to an error wall.
        let cached = [source(id: "r", status: "ready", minutesAgo: 3)]
        let state = ExportStatusViewState(snapshot: .init(
            exports: .failed(message: "x", cached: cached, stale: true),
            admin: .idle
        ))
        XCTAssertEqual(state.phase, .content)
        XCTAssertTrue(state.isStale)
    }

    func testViewStateStaleAndRefreshingFlags() {
        let cached = [source(id: "r", status: "ready", minutesAgo: 3)]
        let state = ExportStatusViewState(snapshot: .init(
            exports: .loading(cached: cached, stale: true),
            admin: .idle
        ))
        XCTAssertEqual(state.phase, .content)
        XCTAssertTrue(state.isStale)
        XCTAssertTrue(state.isRefreshing)
    }

    func testViewStateOfflineFlagPropagates() {
        let state = ExportStatusViewState(snapshot: .init(
            exports: .loaded([source(id: "r", status: "ready", minutesAgo: 1)], stale: false),
            admin: .idle,
            isOffline: true
        ))
        XCTAssertTrue(state.isOffline)
        XCTAssertEqual(state.phase, .content)
    }

    // MARK: Size breakpoints

    func testSizeBreakpoints() {
        XCTAssertTrue(ExportStatusWidgetSize(cols: 1, rows: 2).isCompact)
        XCTAssertFalse(ExportStatusWidgetSize(cols: 2, rows: 4).isCompact)
        XCTAssertFalse(ExportStatusWidgetSize(cols: 2, rows: 4).isWide)
        XCTAssertTrue(ExportStatusWidgetSize(cols: 3, rows: 4).isWide)
        XCTAssertTrue(ExportStatusWidgetSize(cols: 4, rows: 40).isWide)
    }

    func testRegistryMetadataMatchesWebRegistry() {
        XCTAssertEqual(ExportStatusWidgetRegistry.id, "export-status")
        XCTAssertEqual(ExportStatusWidgetRegistry.category, "system")
        XCTAssertEqual(ExportStatusWidgetRegistry.defaultSize, ExportStatusWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(ExportStatusWidgetRegistry.minSize, ExportStatusWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(ExportStatusWidgetRegistry.maxSize, ExportStatusWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(ExportStatusWidgetRegistry.surfaceSlug, "ExportStatusWidget")
    }

    // MARK: Model / provider binding

    @MainActor
    func testModelIngestsProviderSnapshotOnStart() {
        let provider = PreviewExportStatusProvider(ExportStatusPreviewData.populated)
        let model = ExportStatusModel(provider: provider)

        XCTAssertEqual(model.viewState.phase, .empty, "idle before start")
        model.start()
        XCTAssertEqual(model.viewState.phase, .content, "provider snapshot ingested")
        XCTAssertGreaterThan(model.viewState.rows.count, 0)
    }

    @MainActor
    func testModelRefreshForwardsToProvider() {
        let provider = PreviewExportStatusProvider(ExportStatusPreviewData.empty)
        let model = ExportStatusModel(provider: provider)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(provider.refreshCount, 2)
    }

    // MARK: Helpers

    private func source(id: String, status: String, minutesAgo: Int) -> ExportStatusSourceJob {
        let date = Calendar.current.date(byAdding: .minute, value: -minutesAgo, to: Date()) ?? Date()
        let iso = ISO8601DateFormatter().string(from: date)
        return ExportStatusSourceJob(
            id: id,
            format: "csv",
            filePath: "/exports/\(id).csv",
            fileSizeBytes: 1024,
            createdAt: iso,
            rawStatus: status
        )
    }
}
