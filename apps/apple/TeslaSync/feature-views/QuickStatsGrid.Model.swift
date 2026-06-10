//
//  QuickStatsGrid.Model.swift
//  TeslaSync — P4 feature view · 0295 · QuickStatsGrid (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the vehicle-detail quick-stats grid. The view binds through
//  `QuickStatsModel`; no networking lives in the view. The web source
//  (QuickStatsGrid.tsx) is a presentational leaf fed a `state` + `status` prop by its
//  parent (the vehicle-detail page) and reads `useUnits`, so the input snapshot here
//  carries that vehicle state + status + the active unit preferences (plus the parent's
//  loading / error / connectivity state) rather than issuing HTTP itself.
//
//  States: the web leaf always renders its eight tiles from the `state` prop. On top of
//  that, this surface honours the P4 leaf contract (the same one AcDcStatsPanel/0096
//  ships): a `phase` (loading / empty / error / data) fed by the parent's query state,
//  and an orthogonal `connection` axis (live / stale / offline) surfaced as a freshness
//  chip + banner with a one-shot auto-refresh on the stale transition. Cached tiles stay
//  visible behind a refresh / failure / offline window (web parity — the parent keeps the
//  last good state) so the grid never blanks once it has data.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol QuickStatsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogQuickStatsTelemetry: QuickStatsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// banner + chip. `live` hides the banner; `stale` / `offline` show it.
public enum QuickStatsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the vehicle-detail page)

/// One coalesced snapshot of the grid's inputs — the native mirror of the web props
/// (`state`, `status`) plus the active unit preferences (web `useUnits`) and the parent
/// surface's lifecycle (`isLoading`, an error message, and connectivity).
public struct QuickStatsInput: Sendable, Equatable {
    public var state: QuickStatsVehicleState?
    public var status: String?
    public var isLoading: Bool
    public var errorMessage: String?
    public var units: UnitPreferences
    public var connection: QuickStatsConnection

    public init(
        state: QuickStatsVehicleState? = nil,
        status: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        units: UnitPreferences = .metric,
        connection: QuickStatsConnection = .live
    ) {
        self.state = state
        self.status = status
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.units = units
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the grid's render. `phase`
/// selects the body; `tiles` is the pre-projected eight-tile set so the view is a pure
/// function of this value.
public struct QuickStatsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let tiles: [QuickStatTileModel]

    public init(phase: Phase, tiles: [QuickStatTileModel]) {
        self.phase = phase
        self.tiles = tiles
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web component's render plus the P4 leaf contract. Unit tested across loading /
/// empty / error / data. Cached tiles stay visible: once a vehicle state is present the
/// grid renders `.data` even while refreshing / stale / offline; the loading / empty /
/// error phases only show when there is no state yet.
public enum QuickStatsProjection {
    public static func resolve(_ input: QuickStatsInput) -> QuickStatsResolved {
        if let state = input.state {
            let tiles = QuickStatsTiles.tiles(for: state, status: input.status, units: input.units)
            return QuickStatsResolved(phase: .data, tiles: tiles)
        }
        // No snapshot yet — pick the chrome phase from the parent's lifecycle flags.
        if let message = input.errorMessage, !message.isEmpty {
            return QuickStatsResolved(phase: .error(message), tiles: [])
        }
        if input.isLoading {
            return QuickStatsResolved(phase: .loading, tiles: [])
        }
        return QuickStatsResolved(phase: .empty, tiles: [])
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// vehicle-detail page's resolved vehicle-state query composed with the unit-preferences
/// holder (web `useUnits`); previews and tests use `InMemoryQuickStatsSource`. The view
/// never talks to the network directly.
@MainActor
public protocol QuickStatsSource: AnyObject {
    var onUpdate: (@MainActor (QuickStatsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The grid's observable view-model. Subscribes to a `QuickStatsSource`, recomputes the
/// resolved projection (re-projecting whenever the bound unit preferences change),
/// exposes a render `phase` + the resolved tiles, the resolved `status`, and the
/// `connection` axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class QuickStatsModel {
    public private(set) var resolved: QuickStatsResolved =
        QuickStatsProjection.resolve(QuickStatsInput(isLoading: true))
    public private(set) var connection: QuickStatsConnection = .live
    public private(set) var units: UnitPreferences = .metric
    public private(set) var status: String?

    public var phase: QuickStatsResolved.Phase {
        resolved.phase
    }

    public var tiles: [QuickStatTileModel] {
        resolved.tiles
    }

    @ObservationIgnored private let source: any QuickStatsSource
    @ObservationIgnored private let telemetry: any QuickStatsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any QuickStatsSource,
        telemetry: any QuickStatsTelemetry = OSLogQuickStatsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: QuickStatsGrid.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (banner refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: QuickStatsInput) {
        resolved = QuickStatsProjection.resolve(input)
        units = input.units
        status = input.status
        connection = input.connection
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline never auto-refreshes.
    private func handleAutoRefresh(for connection: QuickStatsConnection) {
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

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryQuickStatsSource: QuickStatsSource {
    public var onUpdate: (@MainActor (QuickStatsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: QuickStatsInput?

    public init(initial: QuickStatsInput? = nil) {
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
    public func push(_ input: QuickStatsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "QuickStatsGrid" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; they are kept in a per-surface
/// table so each parallel surface prompt owns its own strings without editing the shared
/// catalog.
public enum QuickStatsStrings {
    public static let table = "QuickStatsGrid"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
