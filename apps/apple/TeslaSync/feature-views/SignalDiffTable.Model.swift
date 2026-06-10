//
//  SignalDiffTable.Model.swift
//  TeslaSync — P4 feature view · 0268 · SignalDiffTable (Apple)
//
//  The seams that keep the SwiftUI surface declarative:
//    • P1/S11 telemetry contract (`view.opened`),
//    • P1/S8 state-holder seam (`SignalDiffTableSource` → `SignalDiffTableModel`),
//    • P1/S10 localization facade (`SignalDiffTableStrings`, in .Localization.swift),
//    • the testable accessibility summary (in .Localization.swift).
//
//  No networking lives here. The production source is wired over the shared
//  signal-diff query (web `useSignalDiffServer` polling `GET /signals/{id}/diff`)
//  plus the pinned-items store (web `usePinned`) at the composition root; previews
//  and tests drive `InMemorySignalDiffTableSource`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted).
public protocol SignalDiffTableTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSignalDiffTableTelemetry: SignalDiffTableTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the diff, mirroring the shared `LoadableState` cases the
/// production source projects from the diff query `Resource<T>`.
public enum SignalDiffTableLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). The web binds
/// these from the diff query's fetch state; the snapshot windows are point-in-time
/// so freshness is a feature-level chrome concern, not part of the web table.
public enum SignalDiffTableConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SignalDiffTableSource`: the diff entries
/// (web `SignalDiffServerResponse.data`), the host-applied pin set (web
/// `pinnedSignals`), whether the host has an active filter (web `filterActive`,
/// used only for the empty message), the load status, and the live-stream
/// freshness. The model turns this into the display projection.
public struct SignalDiffTableUpdate: Sendable, Equatable {
    public var status: SignalDiffTableLoadStatus
    public var connection: SignalDiffTableConnection
    public var entries: [SignalDiffEntry]
    public var pinned: Set<String>
    public var filterActive: Bool
    public var vehicleId: Int
    public var updatedAt: Date?

    public init(
        status: SignalDiffTableLoadStatus = .loading,
        connection: SignalDiffTableConnection = .live,
        entries: [SignalDiffEntry] = [],
        pinned: Set<String> = [],
        filterActive: Bool = false,
        vehicleId: Int = 0,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.entries = entries
        self.pinned = pinned
        self.filterActive = filterActive
        self.vehicleId = vehicleId
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 diff + pinned-items stores (web `useSignalDiffServer` + `usePinned`);
/// the view never performs transport. Previews and tests use
/// `InMemorySignalDiffTableSource`.
@MainActor
public protocol SignalDiffTableSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SignalDiffTableUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a `SignalDiffTableSource`,
/// recomputes the pinned-first projection via `SignalDiffTableBuilder`, and owns
/// the multi-selection (web `selectedSignals`), the optimistic pin set (web
/// `pinnedSignals` / `PinButton`), and the sortable columns (web sortable headers).
@MainActor
@Observable
public final class SignalDiffTableModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Defined here (Foundation)
    /// so it resolves for both the SwiftUI surface and the isolated adapter tests.
    public static let surfaceSlug = "SignalDiffTable"

    /// The mutually-exclusive render branches.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SignalDiffTableConnection = .live
    public private(set) var projection: SignalDiffTableProjection = .empty
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    /// The vehicle the diff belongs to (web `vehicleId`) — drives the pin context
    /// (`signal-diff:vehicle:N`) and the accessibility summary.
    public private(set) var vehicleId = 0
    /// Whether the host page has an active filter (web `filterActive`) — selects
    /// the empty message variant only.
    public private(set) var filterActive = false

    /// Multi-selection of signal names (web `selectedSignals`).
    public private(set) var selectedSignals: Set<String> = []
    /// Optimistic pin set (web `pinnedSignals`). Pinned rows float to the top.
    public private(set) var pinnedSignals: Set<String> = []

    /// Active sort column (web sortable header key).
    public private(set) var sortKey: SignalDiffSortKey = .name
    /// Active sort direction (web sortable header direction).
    public private(set) var sortDirection: SignalDiffSortDirection = .ascending

    @ObservationIgnored private var entries: [SignalDiffEntry] = []
    @ObservationIgnored private let source: any SignalDiffTableSource
    @ObservationIgnored private let telemetry: any SignalDiffTableTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false

    public init(
        source: any SignalDiffTableSource,
        telemetry: any SignalDiffTableTelemetry = OSLogSignalDiffTableTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The pinned-first, sorted rows to render (web `sortedRows`).
    public var displayedRows: [SignalDiffRow] {
        projection.rows
    }

    /// The pin context the production `PinButton` scopes pins to
    /// (`signal-diff:vehicle:N`).
    public var pinContext: String {
        "signal-diff:vehicle:\(vehicleId)"
    }

    /// The locale the view formats display-boundary numbers with (Δ cell), kept in
    /// sync with the locale the projection formatted the window values with.
    public var formattingLocale: Locale {
        locale
    }

    /// Whether a signal name is currently selected (web `selectedKeys.includes`).
    public func isSelected(_ name: String) -> Bool {
        selectedSignals.contains(name)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
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

    /// Toggles selection for a row — the web multi-select `onSelectionChange`.
    public func toggleSelection(_ name: String) {
        if selectedSignals.contains(name) {
            selectedSignals.remove(name)
        } else {
            selectedSignals.insert(name)
        }
    }

    /// Replaces the whole selection (web controlled `selectedKeys`).
    public func setSelection(_ names: Set<String>) {
        selectedSignals = names
    }

    /// Optimistically toggles the pin for a signal and re-floats it — the web
    /// `PinButton` toggle + `sortedRows` pin priority.
    public func togglePin(_ name: String) {
        if pinnedSignals.contains(name) {
            pinnedSignals.remove(name)
        } else {
            pinnedSignals.insert(name)
        }
        rebuildProjection()
    }

    /// Whether a signal is pinned (web `pinnedSignals.has`).
    public func isPinned(_ name: String) -> Bool {
        pinnedSignals.contains(name)
    }

    /// Toggles the sort for a column — re-tapping the active column flips
    /// direction, a new column starts ascending.
    public func toggleSort(_ key: SignalDiffSortKey) {
        if sortKey == key {
            sortDirection = sortDirection.toggled
        } else {
            sortKey = key
            sortDirection = .ascending
        }
        rebuildProjection()
    }

    private func apply(_ update: SignalDiffTableUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        isFetching = update.status == .loading
        vehicleId = update.vehicleId
        filterActive = update.filterActive
        pinnedSignals = update.pinned
        entries = update.entries
        selectedSignals = selectedSignals.intersection(Set(update.entries.map(\.name)))
        rebuildProjection()
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    private func rebuildProjection() {
        projection = SignalDiffTableBuilder.buildProjection(
            from: entries,
            pinned: pinnedSignals,
            sortKey: sortKey,
            direction: sortDirection,
            locale: locale
        )
    }

    /// Resolves the render phase. The web shows the empty state only when no row is
    /// present and the fetch has settled; once any row exists the table renders and
    /// cached rows stay visible behind a refresh or error.
    static func resolvePhase(status: SignalDiffTableLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemorySignalDiffTableSource: SignalDiffTableSource {
    public var onUpdate: (@MainActor (SignalDiffTableUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalDiffTableUpdate?

    public init(initial: SignalDiffTableUpdate? = nil) {
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
    public func push(_ update: SignalDiffTableUpdate) {
        onUpdate?(update)
    }
}
