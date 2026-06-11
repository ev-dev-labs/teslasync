//
//  KeyboardShortcutsModal.Model.swift
//  TeslaSync — P4 modal/dialog · 0006 · KeyboardShortcutsModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `KeyboardShortcutsModal` owns its own UI
//  state: the live `search` box (reset whenever the modal closes — the `useEffect` on `open`), the
//  persisted `mode` filter (read from / written to `sessionStorage`), and the memoized `filteredGroups`
//  derived from the registry snapshot + the current route + the search needle. The native surface
//  reproduces that whole lifecycle here: a `KBShortcutsSource` pushes the resolved registry snapshot +
//  route + freshness, and the model owns the resolved `KBShortcutsPhase`, the search + filter fields, the
//  derived groups, the filter persistence, and the dismissal seam. No store reads, persistence, or
//  navigation live in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `KBShortcutsSource`, holds the latest registry
/// snapshot + route + freshness, owns the live search + persisted filter, exposes the derived groups +
/// resolved render phase + the cheat-sheet copy, drives the dismiss seam, and emits the P1/S11
/// `view.opened` event once on first appearance.
@MainActor
@Observable
public final class KBShortcutsModel {
    // Load + freshness (from the source)
    public private(set) var phase: KBShortcutsPhase = .loading
    public private(set) var connection: KBShortcutsConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Registry snapshot + route (web `useAllShortcuts` + `useLocation`)
    public private(set) var entries: [KBShortcutEntry] = []
    public private(set) var pathname = "/"

    // UI fields (web `useState`)
    public private(set) var search = ""
    public private(set) var filter: KBShortcutsFilter = .all

    @ObservationIgnored private var status: KBShortcutsLoadStatus = .loading
    @ObservationIgnored private let source: any KBShortcutsSource
    @ObservationIgnored private let telemetry: any KBShortcutsTelemetry
    @ObservationIgnored private let controller: any KBShortcutsController
    @ObservationIgnored private let filterStore: any KBShortcutsFilterStore
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any KBShortcutsSource,
        telemetry: any KBShortcutsTelemetry = OSLogKBShortcutsTelemetry(),
        controller: any KBShortcutsController = OSLogKBShortcutsController(),
        filterStore: any KBShortcutsFilterStore = UserDefaultsKBShortcutsFilterStore(),
        localize: @escaping (String, String) -> String = KBShortcutsStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.controller = controller
        self.filterStore = filterStore
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived render data

    /// The filtered + grouped + sorted shortcuts the list renders (web `filteredGroups`).
    public var groups: [KBShortcutGroup] {
        KBShortcutsProjection.groups(from: entries, mode: filter, pathname: pathname, search: search)
    }

    // MARK: Lifecycle

    /// Begins observing, restores the persisted filter (web `readStoredFilter`), and emits the
    /// `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        filter = filterStore.load()
        telemetry.viewOpened(surface: KBShortcutsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream registry feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the registry snapshot (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Intents

    /// Updates the live search box (web `SearchInput onChange`).
    public func updateSearch(_ raw: String) {
        search = raw
        recomputePhase()
    }

    /// Selects a filter and persists it (web `handleFilter` → `writeStoredFilter`).
    public func setFilter(_ mode: KBShortcutsFilter) {
        guard mode != filter else { return }
        filter = mode
        filterStore.save(mode)
        recomputePhase()
    }

    /// Clears the search box (web `useEffect` reset when the modal closes); a no-op when already empty.
    public func resetSearch() {
        guard !search.isEmpty else { return }
        search = ""
        recomputePhase()
    }

    /// Dismisses the cheat sheet (web `onClose`).
    public func dismiss() {
        controller.dismiss()
    }

    // MARK: Snapshot application

    private func apply(_ update: KBShortcutsUpdate) {
        status = update.status
        entries = update.entries
        pathname = update.pathname
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        recomputePhase()
        handleAutoRefresh(for: update.connection)
    }

    /// Recomputes the render phase from the current status + snapshot + filtered groups.
    private func recomputePhase() {
        phase = KBShortcutsProjection.resolvePhase(
            status: status,
            hasEntries: !entries.isEmpty,
            hasVisibleGroups: !groups.isEmpty
        )
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached snapshot on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: KBShortcutsConnection) {
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

// MARK: - Derived copy + accessibility

public extension KBShortcutsModel {
    /// The modal title (web `t('shortcuts.title', …)`).
    var title: String {
        KBShortcutsProjection.title(localize: localize)
    }

    /// The search field prompt (web `t('shortcuts.search', …)`).
    var searchPrompt: String {
        KBShortcutsProjection.searchPrompt(localize: localize)
    }

    /// The empty-line message (web `t('shortcuts.empty', …)`).
    var emptyMessage: String {
        KBShortcutsProjection.emptyMessage(localize: localize)
    }

    /// The All / Global / This page options with their localized titles, in display order.
    var filterOptions: [(mode: KBShortcutsFilter, label: String)] {
        KBShortcutsFilter.allCases.map { mode in
            (mode, KBShortcutsProjection.filterLabel(mode, localize: localize))
        }
    }

    /// The label for a single filter mode.
    func filterLabel(_ mode: KBShortcutsFilter) -> String {
        KBShortcutsProjection.filterLabel(mode, localize: localize)
    }

    /// The dialog's VoiceOver summary.
    var accessibilitySummary: String {
        KBShortcutsAccessibility.summary(localize: localize)
    }

    /// The close affordance's VoiceOver label.
    var closeAccessibilityLabel: String {
        KBShortcutsAccessibility.closeLabel(localize: localize)
    }

    /// The filter control's VoiceOver label.
    var filterAccessibilityLabel: String {
        KBShortcutsAccessibility.filterLabel(localize: localize)
    }

    /// A shortcut row's VoiceOver label (description + spoken key combination).
    func rowAccessibilityLabel(_ entry: KBShortcutEntry) -> String {
        KBShortcutsAccessibility.rowLabel(description: entry.description, keys: entry.keys, localize: localize)
    }
}
