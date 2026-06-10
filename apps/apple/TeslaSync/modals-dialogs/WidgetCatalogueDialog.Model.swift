//
//  WidgetCatalogueDialog.Model.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `WidgetCatalogueDialog` owns the search
//  query in local state, resets it whenever the dialog re-opens (`useEffect`), groups the static
//  `WIDGET_REGISTRY` by category, filters by a name / description / id / category-label search, badges
//  the widgets already on the dashboard ("Added"), and on pick calls `onAdd(widgetId)` then `onClose`.
//  The native surface reproduces that whole lifecycle here: a `WidgetCatalogueSource` pushes the
//  catalogue + the active-widget set + freshness, and the model owns the query, the grouped / filtered
//  sections, the counts, the resolved phase, the add / close seams, and the stale auto-refresh — emitting
//  the P1/S11 `view.opened` event once on first appearance. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `WidgetCatalogueSource`, holds the search query,
/// exposes the resolved phase + the filtered category sections + the counts, and drives the add / close
/// seams.
@MainActor
@Observable
public final class WidgetCatalogueModel {
    // Load + freshness (from the source)
    public private(set) var loadStatus: WidgetCatalogueLoadStatus = .loading
    public private(set) var connection: WidgetCatalogueConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// Catalogue + active set (from the source)
    public private(set) var activeWidgetIDs: [String] = []

    // Resolved render state
    public private(set) var phase: WidgetCataloguePhase = .loading
    public private(set) var inlineErrorMessage: String?
    public private(set) var groups: [WidgetCatalogueGroup] = []
    public private(set) var totalCount = 0
    public private(set) var addedCount = 0
    public private(set) var visibleCount = 0
    public private(set) var isSearchEmpty = false

    /// The search query (web local `query` state). Set through `setQuery` / `clearSearch`.
    public private(set) var query = ""

    @ObservationIgnored private let source: any WidgetCatalogueSource
    @ObservationIgnored private let telemetry: any WidgetCatalogueTelemetry
    @ObservationIgnored private let actions: any WidgetCatalogueActions
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var allGroups: [WidgetCatalogueGroup] = []
    @ObservationIgnored private var activeSet: Set<String> = []

    public init(
        source: any WidgetCatalogueSource,
        telemetry: any WidgetCatalogueTelemetry = OSLogWidgetCatalogueTelemetry(),
        actions: any WidgetCatalogueActions = OSLogWidgetCatalogueActions(),
        localize: @escaping (String, String) -> String = WidgetCatalogueStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.actions = actions
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived copy (web interpolated `t(…)` strings)

    /// Whether a search query is active (web `isFiltering`).
    public var isFiltering: Bool {
        WidgetCatalogueProjection.isFiltering(query)
    }

    /// The header subtitle (web `dashboard.catalogue.subtitle` with `{{added}}` / `{{total}}`).
    public var subtitleText: String {
        WidgetCatalogueStrings.interpolate(
            localize(
                "dashboard.catalogue.subtitle",
                "Pick a widget to add to your dashboard. {{added}} of {{total}} widgets are already on your layout."
            ),
            ["added": String(addedCount), "total": String(totalCount)]
        )
    }

    /// The live result tally shown while filtering (web `dashboard.catalogue.resultCount`).
    public var resultCountText: String {
        WidgetCatalogueStrings.interpolate(
            localize("dashboard.catalogue.resultCount", "{{count}} of {{total}} widgets match"),
            ["count": String(visibleCount), "total": String(totalCount)]
        )
    }

    /// The search-empty body line (web `dashboard.catalogue.emptyBody` with `{{total}}`).
    public var searchEmptyBodyText: String {
        WidgetCatalogueStrings.interpolate(
            localize(
                "dashboard.catalogue.emptyBody",
                "Try a different keyword, or clear the search to browse all {{total}} widgets."
            ),
            ["total": String(totalCount)]
        )
    }

    /// The dialog container's VoiceOver label.
    public var accessibilityLabel: String {
        WidgetCatalogueAccessibility.dialogLabel(localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WidgetCatalogueSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the active-widget-set query (the error-state retry / the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Search (web local `setQuery` + reset)

    /// Updates the search query and re-filters (web `setQuery`).
    public func setQuery(_ text: String) {
        query = text
        recomputeFilter()
    }

    /// Clears the search (web `onClick={() => setQuery('')}` on the empty-state action + on re-open).
    public func clearSearch() {
        setQuery("")
    }

    // MARK: Category label (web `t('dashboard.catalogue.category.<cat>')`)

    /// The localized category label used for both the section header and the topic search.
    public func categoryLabel(_ category: WidgetCatalogueCategory) -> String {
        localize(category.labelKey, category.fallbackLabel)
    }

    // MARK: Added state + add / close (web `handleAdd` / `onClose`)

    /// Whether a widget is already on the active dashboard (web `activeSet.has(widget.id)`).
    public func isAdded(_ id: String) -> Bool {
        activeSet.contains(id)
    }

    /// One entry's Add-button VoiceOver label.
    public func addAccessibilityLabel(_ entry: WidgetCatalogueEntry) -> String {
        WidgetCatalogueAccessibility.addLabel(name: entry.name, isAdded: isAdded(entry.id), localize: localize)
    }

    /// One catalogue row's container VoiceOver label.
    public func rowAccessibilityLabel(_ entry: WidgetCatalogueEntry) -> String {
        WidgetCatalogueAccessibility.rowLabel(
            name: entry.name,
            categoryLabel: categoryLabel(entry.category),
            isAdded: isAdded(entry.id),
            localize: localize
        )
    }

    /// Picks a widget (web `handleAdd`): a no-op when already added, otherwise commits the add and
    /// reports `true` so the view dismisses the sheet (web `onAdd` then `onClose`).
    @discardableResult
    public func add(_ id: String) -> Bool {
        guard WidgetCatalogueProjection.canAdd(id, in: activeSet) else { return false }
        actions.add(widgetID: id)
        return true
    }

    /// Records the close intent (web `onClose`); the view owns dismissal.
    public func close() {
        actions.close()
    }

    // MARK: Snapshot application

    private func apply(_ update: WidgetCatalogueUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        activeWidgetIDs = update.activeWidgetIDs
        activeSet = WidgetCatalogueProjection.activeSet(update.activeWidgetIDs)
        totalCount = update.entries.count
        addedCount = WidgetCatalogueProjection.addedCount(update.activeWidgetIDs)
        allGroups = WidgetCatalogueProjection.group(update.entries)
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Recomputes the resolved body phase, the inline-error envelope, and the filtered sections.
    private func recompute() {
        let hasEntries = totalCount > 0
        phase = WidgetCatalogueProjection.phase(status: loadStatus, hasEntries: hasEntries)
        inlineErrorMessage = WidgetCatalogueProjection.inlineFailure(status: loadStatus, hasEntries: hasEntries)
        recomputeFilter()
    }

    /// Re-applies the search filter to the grouped catalogue and refreshes the visible count + the
    /// search-empty flag (web `filteredEntries` / `visibleCount`).
    private func recomputeFilter() {
        groups = WidgetCatalogueProjection.filter(
            groups: allGroups,
            query: query,
            categoryLabel: { [weak self] category in self?.categoryLabel(category) ?? category.fallbackLabel }
        )
        visibleCount = WidgetCatalogueProjection.visibleCount(groups)
        isSearchEmpty = WidgetCatalogueProjection.isSearchEmpty(query: query, visibleCount: visibleCount)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached catalogue on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: WidgetCatalogueConnection) {
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
