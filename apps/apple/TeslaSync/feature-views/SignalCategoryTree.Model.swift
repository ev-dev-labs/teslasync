//
//  SignalCategoryTree.Model.swift
//  TeslaSync — P4 feature view · 0265 · SignalCategoryTree (Apple)
//
//  The seams that keep the SwiftUI surface declarative:
//    • P1/S11 telemetry contract (`view.opened`),
//    • P1/S8 state-holder seam (`SignalCategoryTreeSource` → `…Model`),
//    • the render-phase resolution + the search / expansion / selection state the
//      web parent owns (and URL-syncs) — owned here so the surface is complete.
//
//  No networking lives here. The production source is wired over the shared
//  available-signals query (web `useAvailableSignals` → `GET /signals/{id}/available`)
//  at the composition root; previews and tests drive `InMemorySignalCategoryTreeSource`.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (Foundation-only, shared by the view + telemetry)

/// The diagnostics surface identity. Kept Foundation-only (not on the SwiftUI
/// `SignalCategoryTree` view) so the telemetry contract is testable without
/// rendering — the view re-exposes it as `SignalCategoryTree.surfaceSlug`.
public enum SignalCategoryTreeSurface {
    /// P1/S11 `view.opened` slug for this surface.
    public static let slug = "SignalCategoryTree"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter forwarding to the
/// shared `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted).
public protocol SignalCategoryTreeTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSignalCategoryTreeTelemetry: SignalCategoryTreeTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the catalog, mirroring the shared `LoadableState` cases
/// the production source projects from the available-signals query `Resource<T>`.
public enum SignalCategoryTreeLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Catalog freshness (ADR-013). The catalog is a slow-moving query (web
/// `STALE_TIMES.SLOW`); `stale`/`offline` drive the freshness chip + cached banner.
public enum SignalCategoryTreeConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SignalCategoryTreeSource`: the available
/// descriptors (web `AvailableSignalsResponse.signals`), the load status, and the
/// freshness. The model turns this into the grouped projection + render phase.
public struct SignalCategoryTreeUpdate: Sendable, Equatable {
    public var status: SignalCategoryTreeLoadStatus
    public var connection: SignalCategoryTreeConnection
    public var descriptors: [SignalDescriptor]
    public var updatedAt: Date?

    public init(
        status: SignalCategoryTreeLoadStatus = .loading,
        connection: SignalCategoryTreeConnection = .live,
        descriptors: [SignalDescriptor] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.descriptors = descriptors
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 available-signals store (web `useAvailableSignals`); the view
/// never performs transport. Previews and tests use the in-memory source.
@MainActor
public protocol SignalCategoryTreeSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SignalCategoryTreeUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a `SignalCategoryTreeSource`,
/// rebuilds the grouped projection via `SignalCategoryTreeBuilder`, and owns the
/// search / expansion / selection state (web parent `useState`, URL-synced) the
/// tree renders.
@MainActor
@Observable
public final class SignalCategoryTreeModel {
    /// The mutually-exclusive render branches.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SignalCategoryTreeConnection = .live
    public private(set) var projection: SignalCategoryTreeProjection = .empty
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    /// Selected leaf (signal) ids (web `selectedSignals`). Owned here; a host page
    /// can mirror it for URL-sync.
    public private(set) var selectedSignals: Set<String> = []
    /// Live search needle (web `searchValue`), bound to the search field.
    public var searchText: String = ""
    /// Expanded category ids (web `expandedGroupIds`). Searching force-expands all.
    public private(set) var expandedGroups: Set<String> = []

    @ObservationIgnored private let source: any SignalCategoryTreeSource
    @ObservationIgnored private let telemetry: any SignalCategoryTreeTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var staleAutoRefreshArmed = true

    public init(
        source: any SignalCategoryTreeSource,
        telemetry: any SignalCategoryTreeTelemetry = OSLogSignalCategoryTreeTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived display state (web `filtered` / counts useMemos)

    /// The search-filtered groups to render (web `filtered`).
    public var filteredGroups: [SignalCategoryGroup] {
        SignalCategoryTreeBuilder.filter(projection.groups, query: searchText)
    }

    /// Whether a search needle is active (web `isSearching`).
    public var isSearching: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Every visible (filtered) leaf id (web `visibleLeafIds`).
    public var visibleLeafIDs: [String] {
        filteredGroups.flatMap(\.leafIDs)
    }

    /// The total catalog leaf count (web `totalLeafCount`).
    public var totalLeafCount: Int {
        projection.totalLeafCount
    }

    /// The count of selected signals (web `selectedIds.length`).
    public var selectedCount: Int {
        selectedSignals.count
    }

    /// The tri-state of the top select-all control over the visible leaves.
    public var selectAllState: SignalSelectionState {
        SignalCategorySelection.state(of: visibleLeafIDs, in: selectedSignals)
    }

    /// The select-all control's resolved label shape (web `selectAllLabel`).
    public var selectAllLabel: SignalCategorySelectAllLabel {
        SignalCategorySelectAllLabel.resolve(
            isSearching: isSearching,
            allVisibleSelected: selectAllState == .all,
            visibleCount: visibleLeafIDs.count
        )
    }

    /// Whether a category is expanded (web `isExpanded`: searching opens all).
    public func isExpanded(_ groupID: String) -> Bool {
        isSearching || expandedGroups.contains(groupID)
    }

    /// The tri-state of a (filtered) group's checkbox (web group `aria-checked`).
    public func selectionState(of group: SignalCategoryGroup) -> SignalSelectionState {
        SignalCategorySelection.state(of: group.leafIDs, in: selectedSignals)
    }

    /// How many of a (filtered) group's leaves are selected (web `groupSelectedCount`).
    public func selectedCount(in group: SignalCategoryGroup) -> Int {
        SignalCategorySelection.selectedCount(of: group.leafIDs, in: selectedSignals)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalCategoryTreeSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached groups stay visible). Wired to retry / pull.
    public func refresh() {
        source.refresh()
    }

    // MARK: Mutations (web TreeSelect callbacks)

    /// Toggles a single leaf's selection (web `toggleLeaf`).
    public func toggleLeaf(_ leafID: String) {
        selectedSignals = SignalCategorySelection.toggleLeaf(leafID, in: selectedSignals)
    }

    /// Toggles a (filtered) group's visible leaves as a unit (web `toggleGroup`).
    public func toggleGroup(_ groupID: String) {
        guard let group = filteredGroups.first(where: { $0.id == groupID }) else { return }
        selectedSignals = SignalCategorySelection.toggleAll(group.leafIDs, in: selectedSignals)
    }

    /// Toggles every visible leaf across all filtered groups (web `toggleAllVisible`).
    public func toggleAllVisible() {
        selectedSignals = SignalCategorySelection.toggleAll(visibleLeafIDs, in: selectedSignals)
    }

    /// Clears the whole selection (web `clearAll`).
    public func clearAllSelected() {
        selectedSignals = []
    }

    /// Expands / collapses a category (web `toggleExpanded`). A no-op while
    /// searching, where expansion is computed (everything open).
    public func toggleExpanded(_ groupID: String) {
        guard !isSearching else { return }
        if expandedGroups.contains(groupID) {
            expandedGroups.remove(groupID)
        } else {
            expandedGroups.insert(groupID)
        }
    }

    /// Replaces the search needle (web `onSearchChange`).
    public func setSearch(_ value: String) {
        searchText = value
    }

    // MARK: Snapshot application

    private func apply(_ update: SignalCategoryTreeUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        isFetching = update.status == .loading
        projection = SignalCategoryTreeBuilder.buildProjection(
            from: update.descriptors,
            localize: SignalCategoryTreeStrings.categoryLabel
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
        applyStaleAutoRefresh()
    }

    /// One guarded auto-refresh when the catalog goes stale (ADR-013): re-armed
    /// once it returns to live so a flapping connection does not spin requests.
    private func applyStaleAutoRefresh() {
        switch connection {
        case .stale where staleAutoRefreshArmed:
            staleAutoRefreshArmed = false
            source.refresh()
        case .live:
            staleAutoRefreshArmed = true
        default:
            break
        }
    }

    /// Resolves the render phase. The empty state shows only when the catalog is
    /// empty and the fetch has settled; once any group exists the tree renders and
    /// cached groups stay visible behind a refresh or error (web keeps the tree
    /// and surfaces the error inline; the native envelope adds a retry).
    static func resolvePhase(status: SignalCategoryTreeLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            hasData ? .content : .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySignalCategoryTreeSource: SignalCategoryTreeSource {
    public var onUpdate: (@MainActor (SignalCategoryTreeUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalCategoryTreeUpdate?

    public init(initial: SignalCategoryTreeUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: SignalCategoryTreeUpdate) {
        onUpdate?(update)
    }
}
