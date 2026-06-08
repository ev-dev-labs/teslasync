//
//  CostSavingsPanel.Model.swift
//  TeslaSync — P4 feature view · 0136 · CostSavingsPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the drive-detail cost & savings panel. The view binds through
//  `CostSavingsModel`; no networking lives in the view. The web source
//  (CostSavingsPanel.tsx) is a pure presentational leaf fed `drive` + `stats`
//  props by the Drive Detail page and reads useSettings / useUnits / useFormatting,
//  so the input snapshot here carries the derived display config + the two SI
//  inputs (plus the parent's loading / error / connectivity state) rather than
//  issuing HTTP itself.
//
//  States: the web leaf's own branches are data-driven (the always-present Trip
//  Cost cell, the distance-gated Cost/unit cell, and the savings-gated gas trio).
//  On top of those this surface honours the P4 leaf contract (the same one
//  AcDcStatsPanel/0096 ships): a `phase` (loading / empty / error / data) fed by
//  the parent's query state, and an orthogonal `connection` axis (live / stale /
//  offline) surfaced as a freshness chip + banner with a one-shot auto-refresh on
//  the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol CostSavingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogCostSavingsTelemetry: CostSavingsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as
/// the header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum CostSavingsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props + parent lifecycle)

/// The coalesced inputs the panel renders from — the derived display config and the
/// two SI drive values, together the native mirror of the web `drive` + `stats`
/// props plus the three hooks. `nil` means "not resolved yet" (the parent is still
/// loading the drive detail).
public struct CostSavingsSnapshot: Sendable, Equatable {
    public var config: CostSavingsConfig
    public var inputs: CostSavingsInputs

    public init(config: CostSavingsConfig, inputs: CostSavingsInputs) {
        self.config = config
        self.inputs = inputs
    }
}

/// One coalesced snapshot of the panel's inputs — the resolved snapshot (config +
/// SI inputs) plus the parent surface's lifecycle (`isLoading`, an error message,
/// and connectivity). The snapshot values are SI / settings-derived and carried
/// verbatim from upstream; all unit choice happens in the Adapter at display time.
public struct CostSavingsInput: Sendable, Equatable {
    public var snapshot: CostSavingsSnapshot?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: CostSavingsConnection

    public init(
        snapshot: CostSavingsSnapshot? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: CostSavingsConnection = .live
    ) {
        self.snapshot = snapshot
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render
/// branches. `phase` selects the body; the ordered `tiles` are pre-computed so the
/// view is a pure function of this value.
public struct CostSavingsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let tiles: [CostSavingsTile]

    public init(phase: Phase, tiles: [CostSavingsTile]) {
        self.phase = phase
        self.tiles = tiles
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the component's render branches plus the P4 leaf contract. Unit tested
/// across loading / empty / error / data and the per-tile visibility branches.
public enum CostSavingsProjection {
    public static func resolve(_ input: CostSavingsInput) -> CostSavingsResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return CostSavingsResolved(phase: .error(message), tiles: [])
        }
        // Initial fetch (web parent `isLoading`) or no snapshot yet.
        guard !input.isLoading, let snapshot = input.snapshot else {
            return CostSavingsResolved(phase: .loading, tiles: [])
        }
        let tiles = CostSavingsTiles.build(config: snapshot.config, inputs: snapshot.inputs)
        // A degenerate drive (no energy and no distance) has no cost story to tell.
        guard !tiles.isEmpty else {
            return CostSavingsResolved(phase: .empty, tiles: [])
        }
        return CostSavingsResolved(phase: .data, tiles: tiles)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// Drive Detail page's resolved drive + stats + settings; previews and tests use
/// `InMemoryCostSavingsSource`. The view never talks to the network directly.
@MainActor
public protocol CostSavingsSource: AnyObject {
    var onUpdate: (@MainActor (CostSavingsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `CostSavingsSource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class CostSavingsModel {
    public private(set) var resolved: CostSavingsResolved =
        CostSavingsProjection.resolve(CostSavingsInput(isLoading: true))
    public private(set) var connection: CostSavingsConnection = .live

    public var phase: CostSavingsResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any CostSavingsSource
    @ObservationIgnored private let telemetry: any CostSavingsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any CostSavingsSource,
        telemetry: any CostSavingsTelemetry = OSLogCostSavingsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CostSavingsPanel.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: CostSavingsInput) {
        resolved = CostSavingsProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryCostSavingsSource: CostSavingsSource {
    public var onUpdate: (@MainActor (CostSavingsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CostSavingsInput?

    public init(initial: CostSavingsInput? = nil) {
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
    public func push(_ input: CostSavingsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "CostSavingsPanel" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum CostSavingsStrings {
    public static let table = "CostSavingsPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// A localized template resolved then interpolated with positional
    /// `String(format:)` arguments — the native equivalent of i18next's
    /// `t(key, { …interpolations })`. Used for the `Cost / {unit}` label and the
    /// `at {sym}{rate}/kWh` / `at {mpg} MPG` sub-labels.
    public static func format(
        _ key: String,
        _ fallback: String,
        _ arguments: [String],
        locale: Locale = .current
    ) -> String {
        let template = string(key, fallback)
        guard !arguments.isEmpty else { return template }
        return String(format: template, locale: locale, arguments: arguments.map { $0 as CVarArg })
    }
}
