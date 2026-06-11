//
//  ExportModal.Model.swift
//  TeslaSync — P4 modal / dialog · 0023 · ExportModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `ExportModal` is presentational: it derives
//  the pretty export JSON, the size badge, and the share URL from the `dashboard` prop via `useMemo`,
//  copies the JSON / URL through `CopyButton`, and on "Download JSON File" calls `onDownload` then
//  `onClose`. The native surface reproduces that whole lifecycle here: an `ExportSource` pushes the
//  exported dashboard + freshness, and the model owns the resolved phase, the derived export
//  projections (JSON, size, share URL + its over-length guard, the widget-count / updated copy, and the
//  mini-grid geometry), the clipboard + download command seams, the stale auto-refresh, and the close —
//  emitting the P1/S11 `view.opened` event once on first appearance. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to an `ExportSource`, holds the exported dashboard +
/// freshness, exposes the resolved phase + the derived export projections, and drives the copy /
/// download / close command seams.
@MainActor
@Observable
public final class ExportModel {
    // Load + freshness (from the source)
    public private(set) var loadStatus: ExportLoadStatus = .loading
    public private(set) var connection: ExportConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Resolved render state
    public private(set) var phase: ExportPhase = .loading
    public private(set) var inlineErrorMessage: String?

    /// Exported dashboard (from the source)
    public private(set) var dashboard: DashboardExportDescriptor?

    // Derived export projections (web `useMemo` outputs)
    public private(set) var dashboardJSON = ""
    public private(set) var jsonSizeText = ""
    public private(set) var shareURL = ""
    public private(set) var shareURLTooLong = false
    public private(set) var shareWarningMessage: String?
    public private(set) var widgetCountText = ""
    public private(set) var updatedText = ""
    public private(set) var miniGrid = ExportMiniGrid(
        columns: ExportProjection.gridColumns,
        rows: ExportProjection.fallbackRows,
        aspectRatio: 1,
        cells: []
    )

    /// Set when the modal should dismiss (web `onClose`, plus the post-download close).
    public private(set) var didFinish = false

    @ObservationIgnored private let source: any ExportSource
    @ObservationIgnored private let telemetry: any ExportTelemetry
    @ObservationIgnored private let actions: any ExportActions
    @ObservationIgnored private let clipboard: any ExportClipboard
    @ObservationIgnored private let originProvider: any ExportURLOriginProviding
    @ObservationIgnored private let dates: any ExportDateFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ExportSource,
        telemetry: any ExportTelemetry = OSLogExportTelemetry(),
        actions: any ExportActions = OSLogExportActions(),
        clipboard: any ExportClipboard = SystemExportClipboard(),
        originProvider: any ExportURLOriginProviding = DefaultExportURLOrigin(),
        dates: any ExportDateFormatting = DefaultExportDateFormatting(),
        localize: @escaping (String, String) -> String = ExportStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.actions = actions
        self.clipboard = clipboard
        self.originProvider = originProvider
        self.dates = dates
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// The dialog container's VoiceOver label.
    public var accessibilityLabel: String {
        ExportAccessibility.dialogLabel(localize: localize)
    }

    /// The exported dashboard's display name, or an empty string before it resolves.
    public var name: String {
        dashboard?.name ?? ""
    }

    /// The exported dashboard's icon glyph (web `dashboard.icon ?? '📊'`).
    public var icon: String {
        dashboard?.icon ?? DashboardExportDescriptor.defaultIcon
    }

    /// The summary block's combined VoiceOver label (name + widget tally + size).
    public var summaryAccessibilityLabel: String {
        ExportAccessibility.summaryLabel(name: name, widgetCount: widgetCountText, size: jsonSizeText)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ExportSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the dashboard + freshness (the error-state retry / the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands (web `CopyButton` / `handleDownload` / `onClose`)

    /// Copies the pretty export JSON to the clipboard (web "Copy to Clipboard" `CopyButton`).
    public func copyJSON() {
        guard dashboard != nil else { return }
        clipboard.copy(dashboardJSON)
    }

    /// Copies the share URL to the clipboard (web "Copy Shareable URL" `CopyButton`). A no-op when the
    /// URL is over-length, mirroring the web `disabled={shareUrlTooLong}` guard.
    public func copyShareURL() {
        guard dashboard != nil, !shareURLTooLong else { return }
        clipboard.copy(shareURL)
    }

    /// Hands the JSON file off for download, then closes (web `handleDownload`: `onDownload()` +
    /// `onClose()`). A no-op when no dashboard is resolved.
    public func requestDownload() {
        guard let dashboard else { return }
        let request = ExportDownloadRequest(fileName: "\(dashboard.name).json", json: dashboardJSON)
        actions.download(request)
        didFinish = true
    }

    /// Closes without exporting (web `onClose`). Drives dismissal through `didFinish`.
    public func close() {
        didFinish = true
    }

    // MARK: Snapshot application

    private func apply(_ update: ExportUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        dashboard = update.dashboard
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Recomputes the resolved phase + the derived export projections from the current dashboard + status.
    private func recompute() {
        let hasDashboard = dashboard != nil
        phase = ExportProjection.phase(status: loadStatus, hasDashboard: hasDashboard)
        inlineErrorMessage = ExportProjection.inlineFailure(status: loadStatus, hasDashboard: hasDashboard)
        guard let dashboard else {
            resetProjections()
            return
        }
        dashboardJSON = ExportProjection.prettyJSON(for: dashboard)
        jsonSizeText = ExportProjection.formatByteSize(dashboardJSON.utf8.count)
        shareURL = ExportProjection.shareURL(for: dashboard, origin: originProvider.origin())
        shareURLTooLong = ExportProjection.isShareURLTooLong(shareURL)
        shareWarningMessage = shareURLTooLong ? overlengthMessage(for: shareURL) : nil
        widgetCountText = widgetCountCopy(dashboard.widgets.count)
        updatedText = updatedCopy(dashboard.updatedAt)
        miniGrid = ExportProjection.miniGrid(for: dashboard)
    }

    /// Clears the derived projections when no dashboard is resolved (loading / empty / error).
    private func resetProjections() {
        dashboardJSON = ""
        jsonSizeText = ""
        shareURL = ""
        shareURLTooLong = false
        shareWarningMessage = nil
        widgetCountText = ""
        updatedText = ""
        miniGrid = ExportMiniGrid(
            columns: ExportProjection.gridColumns,
            rows: ExportProjection.fallbackRows,
            aspectRatio: 1,
            cells: []
        )
    }

    /// The widget-count badge copy (web `t('export.widgetCount', '{{count}} widgets', { count })`).
    private func widgetCountCopy(_ count: Int) -> String {
        localize("export.widgetCount", "{{count}} widgets")
            .replacingOccurrences(of: "{{count}}", with: "\(count)")
    }

    /// The "Updated {date}" copy (web `t('export.updated', 'Updated {{date}}', { date })`).
    private func updatedCopy(_ date: Date) -> String {
        localize("export.updated", "Updated {{date}}")
            .replacingOccurrences(of: "{{date}}", with: dates.format(date))
    }

    /// The over-length warning copy (web `t('export.urlTooLong', '…({{size}} chars)…', { size })`).
    private func overlengthMessage(for url: String) -> String {
        localize(
            "export.urlTooLong",
            "Layout too large for URL sharing ({{size}} chars). Use clipboard or file export instead."
        )
        .replacingOccurrences(of: "{{size}}", with: "\(url.count)")
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached dashboard on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: ExportConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
