//
//  SignalCatalogPanel.Model.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  The seams that keep the SwiftUI surface declarative:
//    • P1/S11 telemetry contract (`view.opened`),
//    • P1/S8 state-holder seam (`SignalCatalogPanelSource` → `…Model`),
//    • P1/S10 localization facade (`SignalCatalogPanelStrings`),
//    • the live search / filter-mode / sort-mode + optional chip selection state.
//
//  No networking lives here. The production source is wired over the shared live
//  signal store (web `useSignalGaps` polling `GET /signals/{id}/live` every 5 s) at
//  the composition root; previews and tests drive `InMemorySignalCatalogPanelSource`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted).
public protocol SignalCatalogPanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSignalCatalogPanelTelemetry: SignalCatalogPanelTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the snapshot, mirroring the shared `LoadableState`
/// cases the production source projects from the signal-gaps query `Resource<T>`.
public enum SignalCatalogPanelLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). The web binds
/// these from the 5 s poll's fetch state.
public enum SignalCatalogPanelConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SignalCatalogPanelSource`: the cached
/// signal entries (web `useSignalGaps` record), the load status, the live-stream
/// freshness, and the query's `dataUpdatedAt`. The model turns this into the
/// display projection.
public struct SignalCatalogPanelUpdate: Sendable, Equatable {
    public var status: SignalCatalogPanelLoadStatus
    public var connection: SignalCatalogPanelConnection
    public var entries: [SignalCatalogPanelEntry]
    public var updatedAt: Date?

    public init(
        status: SignalCatalogPanelLoadStatus = .loading,
        connection: SignalCatalogPanelConnection = .live,
        entries: [SignalCatalogPanelEntry] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.entries = entries
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 live signal store (web `useSignalGaps`); the view never performs
/// transport. Previews and tests use `InMemorySignalCatalogPanelSource`.
@MainActor
public protocol SignalCatalogPanelSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SignalCatalogPanelUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Optional chip selection (web `selection` prop)

/// Optional selection configuration — adds a leading checkbox column so a caller
/// can drive a chip-selection workflow (web `SignalCatalogSelectionProps`). `max`
/// caps the selection and disables further toggles once reached.
public struct SignalCatalogPanelSelectionConfig {
    public var selected: Set<String>
    public var max: Int?
    public var onToggle: (@MainActor (String) -> Void)?

    public init(selected: Set<String> = [], max: Int? = nil, onToggle: (@MainActor (String) -> Void)? = nil) {
        self.selected = selected
        self.max = max
        self.onToggle = onToggle
    }
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a `SignalCatalogPanelSource`,
/// recomputes the projection via `SignalCatalogPanelBuilder`, and owns the live
/// search + filter mode + sort mode (web `useState`) and the optional selection.
@MainActor
@Observable
public final class SignalCatalogPanelModel {
    /// The mutually-exclusive render branches.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SignalCatalogPanelConnection = .live
    public private(set) var projection: SignalCatalogPanelProjection = .empty
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    /// Live name search (web `search` state, bound to the search field).
    public var search: String = ""
    /// Active filter mode (web `filterMode` state).
    public private(set) var filterMode: SignalCatalogPanelFilterMode = .all
    /// Active sort mode (web `sortMode` state).
    public private(set) var sortMode: SignalCatalogPanelSortMode = .staleness

    /// Whether the checkbox column is shown (web `selection` provided).
    public let selectionEnabled: Bool
    public private(set) var selectedSignals: Set<String>
    private let selectionMax: Int?
    @ObservationIgnored private let onSelectionToggle: (@MainActor (String) -> Void)?

    @ObservationIgnored private let source: any SignalCatalogPanelSource
    @ObservationIgnored private let telemetry: any SignalCatalogPanelTelemetry
    @ObservationIgnored private let nowProvider: () -> Date
    @ObservationIgnored private var started = false

    public init(
        source: any SignalCatalogPanelSource,
        telemetry: any SignalCatalogPanelTelemetry = OSLogSignalCatalogPanelTelemetry(),
        selection: SignalCatalogPanelSelectionConfig? = nil,
        now: @escaping () -> Date = Date.init
    ) {
        self.source = source
        self.telemetry = telemetry
        nowProvider = now
        selectionEnabled = selection != nil
        selectedSignals = selection?.selected ?? []
        selectionMax = selection?.max
        onSelectionToggle = selection?.onToggle
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The summary counts the StatCards render (web `signals.length` etc.).
    public var summary: SignalCatalogPanelSummary {
        projection.summary
    }

    /// The searched + filtered + sorted rows to render (web `filtered` `useMemo`).
    public var displayedRows: [SignalCatalogPanelRow] {
        let filtered = SignalCatalogPanelBuilder.filter(projection.rows, search: search, mode: filterMode)
        return SignalCatalogPanelBuilder.sort(filtered, mode: sortMode)
    }

    /// Whether the catalog holds signals the active filters happen to hide — the
    /// web `signals.length > 0 && filtered.length === 0` (filtered-empty message).
    public var hasHiddenRows: Bool {
        projection.hasData && displayedRows.isEmpty
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalCatalogPanel.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached rows stay visible). Wired to retry / pull.
    public func refresh() {
        source.refresh()
    }

    /// Selects a filter mode (web `setFilterMode`).
    public func setFilterMode(_ mode: SignalCatalogPanelFilterMode) {
        filterMode = mode
    }

    /// Selects a sort mode (web `setSortMode`).
    public func setSortMode(_ mode: SignalCatalogPanelSortMode) {
        sortMode = mode
    }

    /// Whether a row is currently selected (web `selectedSet.has`).
    public func isSelected(_ name: String) -> Bool {
        selectedSignals.contains(name)
    }

    /// Whether the row's toggle is enabled — selected rows can always deselect; a
    /// `max` cap disables new selections once reached (web `disabled` logic).
    public func canToggleSelection(_ name: String) -> Bool {
        if selectedSignals.contains(name) { return true }
        guard let selectionMax else { return true }
        return selectedSignals.count < selectionMax
    }

    /// Toggles a row's selection, honoring the optional cap, then notifies the
    /// caller (web `selection.onToggle`).
    public func toggleSelection(_ name: String) {
        guard canToggleSelection(name) else { return }
        if selectedSignals.contains(name) {
            selectedSignals.remove(name)
        } else {
            selectedSignals.insert(name)
        }
        onSelectionToggle?(name)
    }

    private func apply(_ update: SignalCatalogPanelUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        isFetching = update.status == .loading
        projection = SignalCatalogPanelBuilder.buildProjection(from: update.entries, now: nowProvider())
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web shows the empty state only when no signal
    /// is cached and the fetch has settled; once any row exists the table renders
    /// and cached rows stay visible behind a refresh or error.
    static func resolvePhase(status: SignalCatalogPanelLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemorySignalCatalogPanelSource: SignalCatalogPanelSource {
    public var onUpdate: (@MainActor (SignalCatalogPanelUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalCatalogPanelUpdate?

    public init(initial: SignalCatalogPanelUpdate? = nil) {
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
    public func push(_ update: SignalCatalogPanelUpdate) {
        onUpdate?(update)
    }
}
