//
//  InboxBody.Store.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The `@Observable` view-model for the inbox surface — the native owner of the
//  filter + view state, the bulk selection, the resolved render phase, and the
//  mutation / toast / announce flows the web `InboxBody.tsx` orchestrates.
//  Subscribes to an `InboxSource` (P1/S8) and exposes the data SwiftUI switches
//  over. Selection, filter, and action handlers live in extensions to keep the
//  type body small. No networking — the source is the only data ingress.
//

import Foundation
import Observation

@MainActor
@Observable
public final class InboxBodyModel {
    /// The panel's list render branch (web skeletons / error / empty / list).
    public enum ListPhase: Equatable {
        case loading
        case error(String)
        case empty
        case content
    }

    public private(set) var filters: InboxFilters
    public private(set) var selection: Set<Int> = []
    public private(set) var flatStatus: InboxLoadStatus = .loading
    public private(set) var groupStatus: InboxLoadStatus = .loading
    public private(set) var rows: [InboxNotification] = []
    public private(set) var groups: [InboxGroup] = []
    public private(set) var rules: [InboxRule] = []
    public private(set) var vehicles: [InboxVehicle] = []
    public private(set) var connection: InboxConnection = .live
    public private(set) var updatedAt: Date?

    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let source: any InboxSource
    @ObservationIgnored private let telemetry: any InboxTelemetry
    @ObservationIgnored let toast: any InboxToastPresenting
    @ObservationIgnored let announcer: any InboxAnnouncing
    @ObservationIgnored let preferences: any InboxPreferences
    @ObservationIgnored let actions: any InboxActionsPerforming
    @ObservationIgnored let navigate: @MainActor (String) -> Void
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoMarkOpen = false
    @ObservationIgnored private var didAutoRefreshStale = false

    public init(
        source: any InboxSource,
        archived: Bool = false,
        telemetry: any InboxTelemetry = OSLogInboxTelemetry(),
        toast: any InboxToastPresenting = OSLogInboxPresenter(),
        announcer: any InboxAnnouncing = OSLogInboxPresenter(),
        preferences: any InboxPreferences = DefaultInboxPreferences(),
        actions: any InboxActionsPerforming,
        navigate: @escaping @MainActor (String) -> Void = { _ in },
        localize: @escaping (String, String) -> String = InboxStrings.string,
        calendar: Calendar = .current,
        locale: Locale = .current
    ) {
        filters = InboxFilters(archived: archived)
        self.source = source
        self.telemetry = telemetry
        self.toast = toast
        self.announcer = announcer
        self.preferences = preferences
        self.actions = actions
        self.navigate = navigate
        self.localize = localize
        self.calendar = calendar
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived state

    /// Web `isGrouped = view === 'grouped' && !archived`.
    public var isGrouped: Bool {
        filters.isGrouped
    }

    /// Web `groupByDay(rows)` — the flat list's Today / Yesterday / dated buckets.
    public var dayGroups: [InboxDayGroup] {
        InboxProjection.groupByDay(rows, relativeTo: Date(), calendar: calendar, locale: locale)
    }

    /// Web `rows.map(r => r.id)` — the ids the select-all checkbox spans.
    public var visibleIds: [Int] {
        InboxProjection.visibleIds(rows)
    }

    /// Web `unreadCount`.
    public var unreadCount: Int {
        InboxProjection.unreadCount(rows)
    }

    /// Web `allVisibleSelected = masterState(visibleIds) === 'all'`.
    public var allVisibleSelected: Bool {
        InboxProjection.allVisibleSelected(visibleIds, selected: selection)
    }

    /// The visible-item count the header label renders (groups vs rows).
    public var displayCount: Int {
        isGrouped ? groups.count : rows.count
    }

    /// Whether the active query resolved with no content (web `grouped.length === 0`).
    public var isCurrentlyEmpty: Bool {
        isGrouped ? groups.isEmpty : dayGroups.isEmpty
    }

    /// The bulk-action set for the current tab (web `bulkActions` useMemo).
    public var bulkActions: [InboxBulkAction] {
        InboxProjection.bulkActions(archived: filters.archived)
    }

    /// The resolved list render branch (web skeleton / error / empty / list ladder).
    public var listPhase: ListPhase {
        switch isGrouped ? groupStatus : flatStatus {
        case .loading: .loading
        case let .failed(message): .error(message)
        case .loaded, .empty: isCurrentlyEmpty ? .empty : .content
        }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: InboxDiagnostics.surface)
        source.setFilters(filters)
        source.start()
    }

    /// Stops observing the upstream notification feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of the active query (cached rows stay visible).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: InboxUpdate) {
        flatStatus = update.flatStatus
        groupStatus = update.groupStatus
        rows = update.rows
        groups = update.groups
        rules = update.rules
        vehicles = update.vehicles
        connection = update.connection
        updatedAt = update.updatedAt
        autoMarkOnOpenIfNeeded()
        autoRefreshIfStale()
    }

    /// Web auto-mark-read-on-open effect: inbox tab, flat view, pref-enabled, once,
    /// after the first non-loading load — marks every visible unread row read.
    private func autoMarkOnOpenIfNeeded() {
        guard !filters.archived, !isGrouped, !didAutoMarkOpen else { return }
        guard flatStatus != .loading, preferences.markOnOpen else { return }
        let unread = InboxProjection.unreadIds(rows)
        guard !unread.isEmpty else { return }
        didAutoMarkOpen = true
        actions.markRead(unread)
    }

    /// Prompt "stale chip + auto-refresh": one guarded refresh on entering stale,
    /// reset once fully live so a later stale episode re-triggers exactly once.
    private func autoRefreshIfStale() {
        switch connection {
        case .stale:
            guard !didAutoRefreshStale else { return }
            didAutoRefreshStale = true
            source.refresh()
        case .live:
            didAutoRefreshStale = false
        case .offline:
            break
        }
    }
}

// MARK: - Selection (web `useBulkSelection`)

public extension InboxBodyModel {
    /// Web `toggleSelected(id, on)`.
    func toggleSelected(_ id: Int, _ isOn: Bool) {
        if isOn { selection.insert(id) } else { selection.remove(id) }
    }

    func isSelected(_ id: Int) -> Bool {
        selection.contains(id)
    }

    /// Web `selectAllVisible()`.
    func selectAllVisible() {
        selection.formUnion(visibleIds)
    }

    /// Web `clearSelection()`.
    func clearSelection() {
        selection.removeAll()
    }

    /// Web header checkbox: select-all when unchecked, clear when checked.
    func toggleSelectAllVisible(_ isOn: Bool) {
        if isOn { selectAllVisible() } else { clearSelection() }
    }
}

// MARK: - Filters + view (web URL params + `useUrlBatch`)

public extension InboxBodyModel {
    /// Web `setView` — toggling the grouped/flat view does NOT clear selection
    /// (the web selection-clear effect keys on the query filters, not the view).
    func setView(_ view: InboxViewMode) {
        guard filters.view != view else { return }
        filters.view = view
        source.setFilters(filters)
    }

    /// Web `read` URL param — a query filter, so it clears selection.
    func setReadFilter(_ read: InboxReadFilter) {
        applyQueryChange { $0.read = read }
    }

    /// Web AI "Apply categories as filter" hand-off — narrows the rule_id filter.
    func applyAICategories(_ ruleIds: [Int]) {
        applyQueryChange { $0.ruleIds = ruleIds }
    }

    /// Clears every narrowing filter (keeps the tab + view).
    func clearAllFilters() {
        applyQueryChange {
            $0.severity = []
            $0.vehicleIds = []
            $0.ruleIds = []
            $0.search = ""
            $0.from = ""
            $0.to = ""
            $0.read = .all
        }
    }

    func removeSeverity(_ severity: InboxSeverity) {
        applyQueryChange { $0.severity.removeAll { $0 == severity } }
    }

    func removeVehicle(_ vehicleId: Int) {
        applyQueryChange { $0.vehicleIds.removeAll { $0 == vehicleId } }
    }

    func removeRule(_ ruleId: Int) {
        applyQueryChange { $0.ruleIds.removeAll { $0 == ruleId } }
    }

    func clearSearch() {
        applyQueryChange { $0.search = "" }
    }

    /// Applies a query-filter mutation: re-issues the active query and clears
    /// selection (web `useEffect(() => clearSelection(), [filters])`).
    internal func applyQueryChange(_ mutate: (inout InboxFilters) -> Void) {
        var next = filters
        mutate(&next)
        guard next != filters else { return }
        filters = next
        clearSelection()
        source.setFilters(next)
    }
}
