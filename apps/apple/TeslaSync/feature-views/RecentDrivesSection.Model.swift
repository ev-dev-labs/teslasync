//
//  RecentDrivesSection.Model.swift
//  TeslaSync — P4 feature view · 0297 · RecentDrivesSection (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `RecentDrivesSection` is
//  presentational — it receives `drives` from the parent and renders a `DataTable` with a
//  sortable Distance column + pagination, plus a "View all" link and an `EmptyState`. The
//  native surface reproduces that whole lifecycle here: a `RecentDrivesSource` pushes the
//  resolved rows + display preferences + load / freshness status, and the model owns the sort,
//  the current page, and the resolved `RecentDrivesPhase` for SwiftUI to switch over. No
//  networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `RecentDrivesSource`, holds the latest
/// rows + preferences + freshness, owns the Distance sort + the current page, exposes the
/// resolved render phase + the paged display rows, drives the "View all" navigation seam, and
/// emits the P1/S11 `view.opened` event once on first appearance.
@MainActor
@Observable
public final class RecentDrivesModel {
    // Load + freshness (from the source)
    public private(set) var phase: RecentDrivesPhase = .loading
    public private(set) var connection: RecentDrivesConnection = .live
    public private(set) var items: [RecentDriveItem] = []
    public private(set) var formatting = RecentDrivesFormatting()
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The query failure message kept while cached rows remain on screen, so the content branch
    /// can surface the inline error above the table (web reload-failure-with-cached-data).
    public private(set) var loadFailure: String?

    // UI state (web `DataTable` local sort + page)
    public private(set) var sort: RecentDrivesSort = .unsorted
    public private(set) var page = 1

    @ObservationIgnored private let source: any RecentDrivesSource
    @ObservationIgnored private let telemetry: any RecentDrivesTelemetry
    @ObservationIgnored private let navigator: any RecentDrivesNavigator
    @ObservationIgnored let dates: any RecentDrivesDateFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any RecentDrivesSource,
        telemetry: any RecentDrivesTelemetry = OSLogRecentDrivesTelemetry(),
        navigator: any RecentDrivesNavigator = OSLogRecentDrivesNavigator(),
        dates: any RecentDrivesDateFormatting = DefaultRecentDrivesDateFormatting(),
        localize: @escaping (String, String) -> String = RecentDrivesStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.navigator = navigator
        self.dates = dates
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (sort + pagination + inline error + a11y)

    /// The rows ordered for the current sort (web sorted `DataTable` body).
    public var sortedItems: [RecentDriveItem] {
        RecentDrivesProjection.sorted(items, by: sort)
    }

    /// The rows on the current page (web `DataTable` `paginatedData`).
    public var pagedItems: [RecentDriveItem] {
        RecentDrivesProjection.page(sortedItems, page: page)
    }

    /// The current page's cell strings, ready for the row views.
    public var displayRows: [RecentDriveDisplay] {
        pagedItems.map(display(for:))
    }

    /// The number of pages at the web default page size.
    public var pageCount: Int {
        RecentDrivesProjection.pageCount(total: items.count)
    }

    /// Whether the pagination bar shows (web pagination renders only past one page).
    public var hasPagination: Bool {
        items.count > RecentDrivesSurface.pageSize
    }

    /// Whether the "previous page" affordance is enabled.
    public var canGoToPreviousPage: Bool {
        page > 1
    }

    /// Whether the "next page" affordance is enabled.
    public var canGoToNextPage: Bool {
        page < pageCount
    }

    /// The inline reload error shown above the populated table (web cached-rows-with-failure),
    /// present only while rows are on screen despite a failed reload.
    public var inlineErrorMessage: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// The VoiceOver summary for the section.
    public var accessibilitySummary: String {
        RecentDrivesAccessibility.sectionSummary(count: items.count, localize: localize)
    }

    /// Builds one row's four cell strings through the projection + the bound date facade.
    public func display(for item: RecentDriveItem) -> RecentDriveDisplay {
        RecentDrivesProjection.display(for: item, formatting: formatting) { dates.dateTime($0) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RecentDrivesSurface.slug)
        source.start()
    }

    /// Stops observing the upstream drives feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Sort + pagination (web `DataTable` local UI state)

    /// Toggles the Distance sort the way tapping the column header does (web `onSort`), and
    /// returns to the first page so the new ordering is visible from the top.
    public func toggleDistanceSort() {
        sort = sort.toggled()
        page = 1
    }

    /// Jumps to a one-based page, clamped into range.
    public func goToPage(_ target: Int) {
        page = RecentDrivesProjection.clampPage(target, total: items.count)
    }

    /// Advances one page (web pagination "next"), clamped.
    public func nextPage() {
        goToPage(page + 1)
    }

    /// Steps back one page (web pagination "previous"), clamped.
    public func previousPage() {
        goToPage(page - 1)
    }

    // MARK: View all (web `<Link to="/drives">`)

    /// Routes to the full drives list through the navigation seam.
    public func viewAll() {
        navigator.openAllDrives()
    }

    // MARK: Snapshot application

    private func apply(_ update: RecentDrivesUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        items = update.items
        formatting = update.formatting
        loadFailure = Self.failureMessage(update.status)
        phase = RecentDrivesProjection.resolvePhase(status: update.status, rowCount: items.count)
        page = RecentDrivesProjection.clampPage(page, total: items.count)
        handleAutoRefresh(for: update.connection)
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: RecentDrivesLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so
    /// a later stale episode re-triggers exactly once. Offline keeps the cached rows on screen
    /// and does not refetch.
    private func handleAutoRefresh(for connection: RecentDrivesConnection) {
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
