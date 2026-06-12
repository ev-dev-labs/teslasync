//
//  Layout.Model.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The observable state-holder (P1/S8) for the app shell. The web `Layout` composes its sidebar style
//  preference, the `useQuery` badge feeds (vehicles / alerts / stale sessions), the auth mode, the current
//  route, and the localStorage-backed pinned/recent/expanded stores into a navigation tree. The native peer
//  keeps that contract — the host's current shell state arrives through ``LayoutSource`` snapshots and a
//  chosen destination routes back out through the host-supplied `onSelect` closure (the native peer of the
//  web `<NavLink to>` navigation) — while the holder owns the interactive pin/recent/expanded state, derives
//  the view-ready ``LayoutProjection`` from ``LayoutNavCatalog`` via the pure ``LayoutProjector``, drives the
//  P4 leaf phases + the freshness axis (stale auto-refresh once / offline keeps the cached chrome), and emits
//  `view.opened` exactly once.
//

import Foundation
import Observation

@MainActor
@Observable
public final class LayoutModel {
    public private(set) var pathname: String = "/"
    public private(set) var sidebarStyle: LayoutSidebarStyle = .linear
    public private(set) var vehicleCount = 0
    public private(set) var unreadAlerts = 0
    public private(set) var staleCount = 0
    public private(set) var isForwardAuth = false
    public private(set) var pinnedPaths: [String] = LayoutNavLimits.defaultPinnedPaths
    public private(set) var recentPaths: [String] = []
    public private(set) var expandedSections: Set<String> = ["Home"]
    public private(set) var phase: LayoutPhase = .loading
    public private(set) var connection: LayoutConnection = .live

    @ObservationIgnored private let catalog: [LayoutNavSection]
    @ObservationIgnored private let source: any LayoutSource
    @ObservationIgnored private let onSelect: @MainActor (String) -> Void
    @ObservationIgnored private let telemetry: any LayoutTelemetry
    @ObservationIgnored let localize: LayoutResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefresh = false

    public init(
        source: any LayoutSource,
        catalog: [LayoutNavSection] = LayoutNavCatalog.sections,
        onSelect: @escaping @MainActor (String) -> Void = { _ in },
        telemetry: any LayoutTelemetry = OSLogLayoutTelemetry(),
        localize: @escaping LayoutResolve = LayoutStrings.string
    ) {
        self.source = source
        self.catalog = catalog
        self.onSelect = onSelect
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] snapshot in self?.ingest(snapshot) }
    }

    // MARK: Derived reads

    /// The resolved, view-ready navigation — a pure function of the catalog + the current shell state.
    public var projection: LayoutProjection {
        LayoutProjector.projection(catalog: catalog, state: navState)
    }

    /// The current dynamic inputs bundled for the pure projector.
    private var navState: LayoutNavState {
        LayoutNavState(
            pathname: pathname,
            vehicleCount: vehicleCount,
            isForwardAuth: isForwardAuth,
            pinnedPaths: pinnedPaths,
            recentPaths: recentPaths,
            expanded: expandedSections
        )
    }

    /// Whether the "Recently Used" sidebar group renders (web `SHOW_RECENTLY_USED_NAV`, off by default).
    public var showRecentlyUsed: Bool {
        LayoutNavLimits.showRecentlyUsed
    }

    /// Whether a section is currently expanded.
    public func isExpanded(_ title: String) -> Bool {
        expandedSections.contains(title)
    }

    /// The badge for a route, if any (web per-item count chips).
    public func badge(for to: String) -> LayoutNavBadge? {
        LayoutProjector.badge(for: to, unreadAlerts: unreadAlerts, vehicleCount: vehicleCount, staleCount: staleCount)
    }

    // MARK: Lifecycle

    /// Begins the surface, emits `view.opened` once, and starts the source. Idempotent across appear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: LayoutSurface.slug)
        }
        source.start()
    }

    /// Marks the surface inactive. The once-only `view.opened` contract is preserved.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the host's shell feeds (web refetch) — the error-state retry + the freshness chip refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Source ingestion

    /// Folds a pushed snapshot into the shell state + phase + connectivity. The active section is
    /// auto-expanded (web effect) and a stale read auto-refreshes once (reset when the source returns to
    /// live so a later stale episode re-triggers once).
    private func ingest(_ snapshot: LayoutSnapshot) {
        pathname = snapshot.pathname
        sidebarStyle = snapshot.sidebarStyle
        vehicleCount = snapshot.vehicleCount
        unreadAlerts = snapshot.unreadAlerts
        staleCount = snapshot.staleCount
        isForwardAuth = snapshot.isForwardAuth
        pinnedPaths = snapshot.pinnedPaths
        recentPaths = snapshot.recentPaths
        expandedSections = snapshot.expandedSections
        connection = snapshot.connection
        autoExpandActiveSection()
        applyPhase(snapshot)
        handleFreshness(snapshot.connection)
    }

    private func applyPhase(_ snapshot: LayoutSnapshot) {
        if snapshot.isLoading {
            phase = .loading
        } else if let message = snapshot.errorMessage {
            phase = .error(message)
        } else {
            phase = projection.isEmpty ? .empty : .content
        }
    }

    /// Web effect: the section owning the active route is always expanded.
    private func autoExpandActiveSection() {
        guard let title = LayoutProjector.findByPath(pathname, in: catalog)?.sectionTitle else { return }
        expandedSections.insert(title)
    }

    private func handleFreshness(_ connection: LayoutConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefresh else { return }
            didAutoRefresh = true
            source.refresh()
        case .live:
            didAutoRefresh = false
        case .offline:
            break
        }
    }

    // MARK: Interactions (web nav handlers)

    /// Commit a destination — the web `<NavLink to>` navigation. Records the visit into the recent list
    /// (web recent-path effect) and routes through the host's `onSelect`.
    public func select(_ to: String) {
        recentPaths = LayoutProjector.recordVisit(recentPaths, visiting: to, pinned: pinnedPaths)
        onSelect(to)
    }

    /// Pin a route (web `pinNavPath`): prepend, de-dup, cap; drop it from recents.
    public func pin(_ to: String) {
        pinnedPaths = LayoutProjector.pin(pinnedPaths, to)
        recentPaths = LayoutProjector.unpin(recentPaths, to)
    }

    /// Unpin a route (web `unpinNavPath`).
    public func unpin(_ to: String) {
        pinnedPaths = LayoutProjector.unpin(pinnedPaths, to)
    }

    /// Toggle the active-card pin for the active route (web active-card star button).
    public func toggleActivePin() {
        guard let to = projection.activeEntry?.item.to else { return }
        if projection.activeIsPinned { unpin(to) } else { pin(to) }
    }

    /// Toggle a section's expansion (web `toggleSection`): the active section never collapses.
    public func toggleSection(_ title: String) {
        expandedSections = LayoutProjector.toggledExpansion(
            expandedSections,
            title,
            activeTitle: projection.activeEntry?.sectionTitle
        )
    }

    /// Expand every visible section (web `expandAllSections`).
    public func expandAll() {
        expandedSections = Set(projection.sections.map(\.title))
    }

    /// Collapse every section (web `collapseAllSections`).
    public func collapseAll() {
        expandedSections = []
    }
}
