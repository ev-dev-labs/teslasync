//
//  SessionListSection.Model.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `SessionListSection` is
//  a controlled component — its parent owns `sessions`, the sort/filter/search state,
//  pagination, and the bulk-selection plumbing. The native surface reproduces that
//  whole lifecycle here: a `SessionListSource` pushes the resolved sessions + load /
//  freshness status, and the model owns the view-local control state (search, charger
//  filter, sort, pagination, selection), recomputing the filtered → sorted → paged
//  list through the pure projection core. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `SessionListSource`, holds
/// the latest sessions + freshness + the control state, exposes the resolved
/// `SessionListPhase` plus the derived list/chips/pagination for SwiftUI to switch
/// over, and emits the P1/S11 `view.opened` event once on first appearance.
@MainActor
@Observable
public final class SessionListModel {
    // Load + freshness (from the source)
    public private(set) var phase: SessionListPhase = .loading
    public private(set) var connection: SessionListConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var items: [SessionListItem] = []
    public private(set) var exportContext = SessionExportContext()

    // View-local control state (web parent state + setters)
    public var searchQuery = ""
    public private(set) var chargerFilter: SessionChargerFilter = .all
    public private(set) var sortKey: SessionSortKey = .date
    public private(set) var sortDescending = true
    public private(set) var selectedIDs: Set<Int> = []
    public private(set) var page = 1
    public private(set) var pageSize: Int

    @ObservationIgnored private let source: any SessionListSource
    @ObservationIgnored private let telemetry: any SessionListTelemetry
    @ObservationIgnored let formatting: any SessionListFormatting
    @ObservationIgnored let units: any SessionListUnits
    @ObservationIgnored private let exporter: any SessionListExporter
    @ObservationIgnored private let deleter: (any SessionListDeleter)?
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SessionListSource,
        telemetry: any SessionListTelemetry = OSLogSessionListTelemetry(),
        formatting: any SessionListFormatting = DefaultSessionListFormatting(),
        units: any SessionListUnits = DefaultSessionListUnits(),
        exporter: any SessionListExporter = OSLogSessionListExporter(),
        deleter: (any SessionListDeleter)? = nil,
        localize: @escaping (String, String) -> String = SessionListStrings.string,
        pageSize: Int = 10
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.units = units
        self.exporter = exporter
        self.deleter = deleter
        self.localize = localize
        self.pageSize = max(1, pageSize)
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived list (web `filteredSessions` + pagination)

    /// The full filtered + sorted list (web `filteredSessions`).
    public var filteredItems: [SessionListItem] {
        SessionListProjection.filterAndSort(
            items,
            filter: chargerFilter,
            sortKey: sortKey,
            descending: sortDescending,
            searchQuery: searchQuery
        )
    }

    /// The count of all sessions before filtering (web `sessions.length`).
    public var totalCount: Int {
        items.count
    }

    /// The count after filtering (web `filteredSessions.length`).
    public var filteredCount: Int {
        filteredItems.count
    }

    /// The page window over the filtered list.
    public var pageWindow: SessionPage {
        SessionPage(page: page, pageSize: pageSize, total: filteredCount)
    }

    /// The current page's rows (web server-side page, here client-side over filtered).
    public var pagedItems: [SessionListItem] {
        SessionPaginator.slice(filteredItems, page: page, pageSize: pageSize)
    }

    /// Whether the filtered list is empty while sessions exist — the web inner
    /// `filteredSessions.length === 0 ? <EmptyState noMatches>` branch.
    public var hasNoMatches: Bool {
        totalCount > 0 && filteredCount == 0
    }

    // MARK: Selection (web bulk-action plumbing)

    /// Whether the host wired bulk actions (web `onBulkDelete && …`).
    public var supportsBulkActions: Bool {
        deleter != nil
    }

    public var selectedCount: Int {
        selectedIDs.count
    }

    public var hasSelection: Bool {
        !selectedIDs.isEmpty
    }

    // MARK: Active-filter chips (web `ActiveFilterChips`)

    /// The active-filter chips (web search chip + charger chip), in the web order.
    public var activeFilterChips: [SessionFilterChip] {
        var chips: [SessionFilterChip] = []
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            chips.append(SessionFilterChip(
                kind: .search,
                label: localize("charging.sessions.filterLabel.search", "Search"),
                value: trimmed
            ))
        }
        if chargerFilter != .all {
            chips.append(SessionFilterChip(
                kind: .charger,
                label: localize("charging.sessions.filterLabel.charger", "Charger"),
                value: localize(chargerFilter.localizationKey, chargerFilter.fallback)
            ))
        }
        return chips
    }

    /// The VoiceOver summary for the section header.
    public var accessibilitySummary: String {
        SessionListAccessibility.sectionSummary(count: filteredCount, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SessionListSurface.slug)
        source.start()
    }

    /// Stops observing the upstream sessions feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Control intents (web setters)

    public func setSearchQuery(_ query: String) {
        searchQuery = query
        page = 1
    }

    public func setChargerFilter(_ filter: SessionChargerFilter) {
        chargerFilter = filter
        page = 1
    }

    /// Web `handleSortClick`: re-tapping the active key flips direction, otherwise
    /// selects the new key (keeping the page, since the list size is unchanged).
    public func selectSort(_ key: SessionSortKey) {
        if sortKey == key {
            sortDescending.toggle()
        } else {
            sortKey = key
            sortDescending = true
        }
    }

    /// Clears both the search and the charger filter (web `onClearAll`).
    public func clearAllFilters() {
        searchQuery = ""
        chargerFilter = .all
        page = 1
    }

    public func removeChip(_ chip: SessionFilterChip) {
        switch chip.kind {
        case .search: setSearchQuery("")
        case .charger: setChargerFilter(.all)
        }
    }

    // MARK: Selection intents

    public func toggleSelection(id: Int, on: Bool) {
        if on { selectedIDs.insert(id) } else { selectedIDs.remove(id) }
    }

    public func clearSelection() {
        selectedIDs.removeAll()
    }

    /// Deletes the selected sessions (web `onBulkDelete`), then clears the selection.
    /// No-op when the host did not wire a deleter.
    public func deleteSelected() async {
        guard let deleter, !selectedIDs.isEmpty else { return }
        let ids = Array(selectedIDs).sorted()
        await deleter.delete(ids: ids)
        clearSelection()
    }

    /// The confirm-dialog title with the pluralized noun (web `bulk.deleteConfirmTitle`).
    public var deleteConfirmTitle: String {
        let count = selectedCount
        let noun = count == 1
            ? localize("bulk.noun.session_one", "charging session")
            : localize("bulk.noun.session_other", "charging sessions")
        let template = localize("bulk.deleteConfirmTitle", "Delete {{count}} {{noun}}?")
        return template
            .replacingOccurrences(of: "{{count}}", with: "\(count)")
            .replacingOccurrences(of: "{{noun}}", with: noun)
    }

    public var deleteConfirmMessage: String {
        localize("bulk.deleteConfirmDescription", "This cannot be undone.")
    }

    // MARK: Pagination intents

    public func setPage(_ value: Int) {
        page = min(max(1, value), pageWindow.pageCount)
    }

    public func nextPage() {
        setPage(page + 1)
    }

    public func previousPage() {
        setPage(page - 1)
    }

    public func setPageSize(_ size: Int) {
        pageSize = max(1, size)
        page = 1
    }

    // MARK: Export intents (web download links)

    public func export(_ format: SessionListExportFormat) {
        let request = SessionListExport.path(format: format, context: exportContext)
        exporter.export(format: format, request: request)
    }

    // MARK: Snapshot application

    private func apply(_ update: SessionListUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        exportContext = update.exportContext
        items = update.items
        phase = SessionListProjection.resolvePhase(update.status, totalCount: items.count)
        pruneSelection()
        clampPage()
        handleAutoRefresh(for: update.connection)
    }

    /// Drops any selected ids that are no longer present after a refresh.
    private func pruneSelection() {
        let present = Set(items.map(\.id))
        selectedIDs.formIntersection(present)
    }

    /// Keeps the current page within bounds when the filtered count shrinks.
    private func clampPage() {
        page = pageWindow.clampedPage
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached list on screen and does not refetch.
    private func handleAutoRefresh(for connection: SessionListConnection) {
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
