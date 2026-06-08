//
//  LifetimeSummary.Model.swift
//  TeslaSync — P4 feature view · 0114 · LifetimeSummary (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the cost-analysis Lifetime Summary section. The view binds through
//  `LifetimeSummaryModel`; no networking lives in the view. The web component is a
//  presentational leaf fed `coreStats` + `lifetimeMetrics` by the parent
//  `CostAnalysisPage` (`useCostAnalysisData`), so the native source carries the
//  coalesced query snapshot (loading / fetching / error / the two computed value types
//  + the freshness + connectivity flags the P4 states contract requires) that flows
//  down from that parent query.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5),
/// which is consent-gated and redacted there.
public protocol LifetimeSummaryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogLifetimeSummaryTelemetry: LifetimeSummaryTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (parent cost-analysis query state)

/// One coalesced snapshot of the parent cost-analysis query — the native mirror of the
/// fields the section depends on (`isLoading`, the query `error`, the computed
/// `coreStats` + `lifetimeMetrics`, and the `useFormatting` preferences) plus the
/// `isStale` / `isOffline` freshness + connectivity flags the production state-holder
/// derives from the TanStack query meta + network reachability (the P4 stale / offline
/// states). The view never touches HTTP — it reacts to this struct.
public struct LifetimeSummaryInput: Sendable, Equatable {
    public var isLoading: Bool
    public var isFetching: Bool
    public var errorMessage: String?
    public var coreStats: LifetimeCoreStats?
    public var metrics: LifetimeMetrics?
    public var formatting: LifetimeFormatting
    public var isStale: Bool
    public var isOffline: Bool

    public init(
        isLoading: Bool = false,
        isFetching: Bool = false,
        errorMessage: String? = nil,
        coreStats: LifetimeCoreStats? = nil,
        metrics: LifetimeMetrics? = nil,
        formatting: LifetimeFormatting = LifetimeFormatting(),
        isStale: Bool = false,
        isOffline: Bool = false
    ) {
        self.isLoading = isLoading
        self.isFetching = isFetching
        self.errorMessage = errorMessage
        self.coreStats = coreStats
        self.metrics = metrics
        self.formatting = formatting
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

// MARK: - Resolved state (render branches + P4 overlays)

/// The resolved, view-ready state — the section's render branches plus the freshness
/// / connectivity overlays the data branch carries (the stale chip + the offline chip).
public struct LifetimeSummaryResolved: Sendable, Equatable {
    /// The mutually-exclusive primary branches. The web leaf only renders data vs the
    /// "No data" fallback, but the P4 surface contract requires the parent's loading /
    /// error branches to be reproduced on the surface itself.
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        case empty
        case data
    }

    public let phase: Phase
    public let tiles: [LifetimeMetricProjection]
    public let isFetching: Bool
    public let isStale: Bool
    public let isOffline: Bool

    public init(
        phase: Phase,
        tiles: [LifetimeMetricProjection],
        isFetching: Bool,
        isStale: Bool,
        isOffline: Bool
    ) {
        self.phase = phase
        self.tiles = tiles
        self.isFetching = isFetching
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

/// Pure projection from the query snapshot to the resolved view-state. `error`
/// deliberately takes precedence over cached values (a refetch failure shows the error
/// box, not stale tiles). The section is "empty" when either value type is missing
/// (web `lifetimeMetrics && coreStats ? … : "No data"`). The stale / offline flags only
/// annotate the data branch — they are overlays, not phases, and only once there is
/// content to annotate. Unit tested across every branch.
public enum LifetimeSummaryProjection {
    public static func resolve(_ input: LifetimeSummaryInput) -> LifetimeSummaryResolved {
        let hasContent = input.coreStats != nil && input.metrics != nil
        let tiles: [LifetimeMetricProjection] = if let coreStats = input.coreStats, let metrics = input.metrics {
            LifetimeMetricsBuilder.tiles(coreStats: coreStats, metrics: metrics, formatting: input.formatting)
        } else {
            []
        }

        let phase: LifetimeSummaryResolved.Phase = if input.isLoading {
            .loading
        } else if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else if !hasContent {
            .empty
        } else {
            .data
        }

        return LifetimeSummaryResolved(
            phase: phase,
            tiles: tiles,
            isFetching: input.isFetching,
            isStale: hasContent && input.isStale,
            isOffline: hasContent && input.isOffline
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// state-holder / TanStack-parity cost-analysis query layer; previews and tests use
/// `InMemoryLifetimeSummarySource`. `refresh()` maps to the hook's `refetch`. The view
/// never talks to the network directly.
@MainActor
public protocol LifetimeSummarySource: AnyObject {
    var onUpdate: (@MainActor (LifetimeSummaryInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The section's observable view-model. Subscribes to a `LifetimeSummarySource`,
/// recomputes the resolved projection, and exposes a render `Phase` (plus the tiles +
/// freshness flags) for SwiftUI to switch over.
@MainActor
@Observable
public final class LifetimeSummaryModel {
    public private(set) var phase: LifetimeSummaryResolved.Phase = .loading
    public private(set) var tiles: [LifetimeMetricProjection] = []
    public private(set) var isFetching = false
    public private(set) var isStale = false
    public private(set) var isOffline = false

    @ObservationIgnored private let source: any LifetimeSummarySource
    @ObservationIgnored private let telemetry: any LifetimeSummaryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any LifetimeSummarySource,
        telemetry: any LifetimeSummaryTelemetry = OSLogLifetimeSummaryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LifetimeSummary.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-fetches the cost-analysis query (wired to the error-state retry affordance).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: LifetimeSummaryInput) {
        let resolved = LifetimeSummaryProjection.resolve(input)
        phase = resolved.phase
        tiles = resolved.tiles
        isFetching = resolved.isFetching
        isStale = resolved.isStale
        isOffline = resolved.isOffline
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryLifetimeSummarySource: LifetimeSummarySource {
    public var onUpdate: (@MainActor (LifetimeSummaryInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LifetimeSummaryInput?

    public init(initial: LifetimeSummaryInput? = nil) {
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
    public func push(_ input: LifetimeSummaryInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "LifetimeSummary" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time. The parity keys reuse
/// the web `costAnalysis.lifetime.*` namespace verbatim.
public enum LSStrings {
    public static let table = "LifetimeSummary"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a key then fills `{{name}}` tokens, mirroring the web
    /// `t(key, default, { name: value })` i18next interpolation. An unmatched token is
    /// left verbatim, exactly like the web test's `t` shim.
    public static func format(_ key: String, _ fallback: String, _ args: [String: String]) -> String {
        var out = string(key, fallback)
        for (name, value) in args {
            out = out.replacingOccurrences(of: "{{\(name)}}", with: value)
        }
        return out
    }
}
