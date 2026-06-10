//
//  SignalConfigModal.Model.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `SignalConfigModal` owns the editable
//  draft (`signals`), the search query, the master interval, and the expanded-category set in local
//  state, derives the filtered + grouped list and the selection counts via `useMemo`, mutates the
//  draft through the per-signal / per-category / master / preset updaters, and on submit projects the
//  selected rows into the `{ name, interval }` payload. The native surface reproduces that whole
//  lifecycle here: a `SignalConfigSource` pushes the catalog + initial selection + default interval +
//  freshness, and the model owns the draft (rebuilt only when the catalog's signal set changes, so a
//  freshness flip preserves edits), the resolved phase, every mutator, the submit / cancel seams, the
//  stale auto-refresh, and the per-row / per-category display projection — emitting the P1/S11
//  `view.opened` event once on first appearance. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `SignalConfigSource`, holds the editable
/// draft + the search / master-interval / expanded-set UI state, exposes the resolved phase, the
/// filtered + grouped list, the selection counts + footer summary, and drives the per-signal /
/// per-category / master / preset mutators plus the submit / cancel seams.
@MainActor
@Observable
public final class SignalConfigModel {
    // Load + freshness (from the source)
    public private(set) var loadStatus: SignalConfigLoadStatus = .loading
    public private(set) var connection: SignalConfigConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Resolved render state
    public private(set) var phase: SignalConfigPhase = .loading
    public private(set) var inlineErrorMessage: String?

    // Editable draft + UI state (web local state)
    public private(set) var rows: [SignalConfigRow] = []
    public private(set) var search = ""
    public private(set) var globalInterval = SignalConfigCatalog.defaultIntervalValue
    public private(set) var expandedCategories: Set<String> = []

    @ObservationIgnored private let source: any SignalConfigSource
    @ObservationIgnored private let telemetry: any SignalConfigTelemetry
    @ObservationIgnored private let actions: any SignalConfigActions
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var builtSignature: [String]?
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SignalConfigSource,
        telemetry: any SignalConfigTelemetry = OSLogSignalConfigTelemetry(),
        actions: any SignalConfigActions = OSLogSignalConfigActions(),
        localize: @escaping (String, String) -> String = SignalConfigStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.actions = actions
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (web `useMemo`)

    /// The search-filtered draft (web `filtered`).
    public var filteredRows: [SignalConfigRow] {
        SignalConfigProjection.filter(rows: rows, search: search)
    }

    /// The category-grouped, search-filtered list (web `grouped`).
    public var groups: [SignalConfigGroup] {
        SignalConfigProjection.group(rows: filteredRows)
    }

    /// The number of selected rows (web `selectedCount`).
    public var selectedCount: Int {
        SignalConfigProjection.selectedCount(rows)
    }

    /// The total number of rows (web `totalCount`).
    public var totalCount: Int {
        rows.count
    }

    /// Whether every row is selected (web `allSelected`).
    public var allSelected: Bool {
        SignalConfigProjection.allSelected(rows)
    }

    /// Whether Subscribe is enabled (web `disabled={selectedCount === 0}` inverse).
    public var canSubmit: Bool {
        SignalConfigProjection.canSubmit(rows)
    }

    /// The footer summary counts (web footer line).
    public var summary: SignalConfigSummary {
        SignalConfigProjection.summary(rows)
    }

    /// Whether the search query hid every row (the in-list "no matches" empty, distinct from an
    /// empty catalog). Only meaningful in the populated phase.
    public var isSearchEmpty: Bool {
        !rows.isEmpty && filteredRows.isEmpty
    }

    /// The dialog container's VoiceOver label.
    public var accessibilityLabel: String {
        SignalConfigAccessibility.dialogLabel(localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalConfigSurface.slug)
        source.start()
    }

    /// Stops observing the upstream catalog feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the catalog query (the error-state retry / the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Per-signal / per-category / master / preset mutators

    /// Toggles one signal's selection (web `updateSignal(name, { selected })`).
    public func toggleSignal(_ name: String) {
        guard let current = rows.first(where: { $0.name == name }) else { return }
        rows = SignalConfigProjection.updating(rows: rows, name: name, selected: !current.selected)
    }

    /// Sets one signal's cadence (web `updateSignal(name, { interval })`).
    public func setSignalInterval(_ name: String, interval: Int) {
        rows = SignalConfigProjection.updating(rows: rows, name: name, interval: interval)
    }

    /// Selects or deselects every signal (web `toggleAll`).
    public func toggleAll() {
        rows = SignalConfigProjection.togglingAll(rows: rows, selected: !allSelected)
    }

    /// Sets the global cadence and applies it to every signal (web `setMasterIntervalAll`).
    public func setGlobalInterval(_ interval: Int) {
        globalInterval = interval
        rows = SignalConfigProjection.settingAllInterval(rows: rows, interval: interval)
    }

    /// Toggles a whole category (web `toggleCategory`).
    public func toggleCategory(_ category: String) {
        rows = SignalConfigProjection.togglingCategory(rows: rows, category: category)
    }

    /// Sets the cadence for every signal in a category (web `setCategoryInterval`).
    public func setCategoryInterval(_ category: String, interval: Int) {
        rows = SignalConfigProjection.settingCategoryInterval(rows: rows, category: category, interval: interval)
    }

    /// Applies a one-tap preset to the whole draft (web `applyPreset`).
    public func applyPreset(_ preset: SignalConfigPreset) {
        rows = preset.apply(to: rows)
    }

    /// Updates the search query (web `setSearch`).
    public func setSearch(_ text: String) {
        search = text
    }

    /// Expands or collapses a category section (web `setExpandedCats`).
    public func toggleExpanded(_ category: String) {
        if expandedCategories.contains(category) {
            expandedCategories.remove(category)
        } else {
            expandedCategories.insert(category)
        }
    }

    /// Whether a category section is expanded (web `expandedCats.has(category)`).
    public func isExpanded(_ category: String) -> Bool {
        expandedCategories.contains(category)
    }

    // MARK: Commands (web `handleSubmit` / `onClose`)

    /// Commits the selected subscriptions (web `onSubmit(selected)` then `onClose()`), guarded so a
    /// zero-selection submit is a no-op (web disabled button).
    public func submit() {
        guard canSubmit else { return }
        actions.subscribe(SignalConfigProjection.submitPayload(rows))
    }

    /// Cancels without committing (web `onClose()`).
    public func cancel() {
        actions.cancel()
    }

    // MARK: Display projection

    /// The short unit label for a cadence (web `INTERVAL_OPTIONS[i].label`, e.g. `10s`).
    public func intervalLabel(_ value: Int) -> String {
        SignalConfigCatalog.interval(for: value).label
    }

    /// A category header's tri-state (web `allCatSelected` / `someCatSelected`).
    public func categoryState(_ category: String) -> SignalConfigCategoryState {
        SignalConfigProjection.categoryState(rows: rows, category: category)
    }

    /// One signal row's VoiceOver label.
    public func rowAccessibilityLabel(_ row: SignalConfigRow) -> String {
        SignalConfigAccessibility.rowLabel(
            name: row.name,
            selected: row.selected,
            intervalLabel: intervalLabel(row.interval),
            localize: localize
        )
    }

    /// A category header's VoiceOver label.
    public func categoryAccessibilityLabel(_ group: SignalConfigGroup) -> String {
        let tally = SignalConfigProjection.categoryTally(rows: group.rows)
        return SignalConfigAccessibility.categoryLabel(
            category: group.category,
            state: SignalConfigProjection.categoryState(rows: rows, category: group.category),
            selected: tally.selected,
            total: tally.total,
            localize: localize
        )
    }

    /// A preset button's VoiceOver label (name + description hint).
    public func presetAccessibilityLabel(_ preset: SignalConfigPreset) -> String {
        SignalConfigAccessibility.presetLabel(
            name: localize(preset.nameKey, preset.nameFallback),
            detail: localize(preset.descKey, preset.descFallback)
        )
    }

    // MARK: Snapshot application

    private func apply(_ update: SignalConfigUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        rebuildDraftIfNeeded(for: update)
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Rebuilds the editable draft only when the catalog's signal set changes (web `useState`
    /// initializer runs once per mount), so a pure freshness flip preserves the operator's edits. On
    /// a (re)build the master interval + expanded set are seeded from the snapshot's defaults.
    private func rebuildDraftIfNeeded(for update: SignalConfigUpdate) {
        let signature = update.catalogSignature
        guard !signature.isEmpty else { return }
        guard signature != builtSignature else { return }
        builtSignature = signature
        rows = SignalConfigProjection.buildRows(
            catalog: update.catalog,
            initialSelected: update.initialSelected,
            initialInterval: update.initialInterval
        )
        globalInterval = update.initialInterval
        expandedCategories = Set(update.catalog.map(\.category))
    }

    /// Recomputes the resolved body phase + inline-error envelope from the current draft + status.
    private func recompute() {
        let hasRows = !rows.isEmpty
        phase = SignalConfigProjection.phase(status: loadStatus, hasRows: hasRows)
        inlineErrorMessage = SignalConfigProjection.inlineFailure(status: loadStatus, hasRows: hasRows)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached catalog on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: SignalConfigConnection) {
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
