//
//  BatteryHealthSection.Model.swift
//  TeslaSync — P4 feature view · 0072 · BatteryHealthSection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the weekly-digest Battery Health section. The view binds through
//  `BatteryHealthModel`; no networking lives in the view. The web component is a
//  presentational leaf fed `metrics` by the parent `useWeeklyDigest` hook, so the
//  native source carries the coalesced digest query snapshot (loading / fetching /
//  error / metrics + the freshness + connectivity flags the P4 states contract
//  requires) that flows down from that parent query.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5),
/// which is consent-gated and redacted there.
public protocol BatteryHealthTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogBatteryHealthTelemetry: BatteryHealthTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (parent `useWeeklyDigest` query state)

/// One coalesced snapshot of the parent digest query — the native mirror of the
/// fields the section depends on (`isLoading`, the combined `error`, the computed
/// `metrics`) plus the `isStale` / `isOffline` freshness + connectivity flags the
/// production state-holder derives from the TanStack query meta + network
/// reachability (the P4 stale / offline states). The view never touches HTTP — it
/// reacts to this struct.
public struct BatteryHealthInput: Sendable, Equatable {
    public var isLoading: Bool
    public var isFetching: Bool
    public var errorMessage: String?
    public var metrics: BatteryHealthMetrics?
    public var isStale: Bool
    public var isOffline: Bool

    public init(
        isLoading: Bool = false,
        isFetching: Bool = false,
        errorMessage: String? = nil,
        metrics: BatteryHealthMetrics? = nil,
        isStale: Bool = false,
        isOffline: Bool = false
    ) {
        self.isLoading = isLoading
        self.isFetching = isFetching
        self.errorMessage = errorMessage
        self.metrics = metrics
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

// MARK: - Resolved state (render branches + P4 overlays)

/// The resolved, view-ready state — the section's render branches plus the freshness
/// / connectivity overlays the data + empty branches carry (the stale chip + the
/// offline chip).
public struct BatteryHealthResolved: Sendable, Equatable {
    /// The mutually-exclusive primary branches. The web leaf only renders data, but
    /// the P4 surface contract requires the parent's loading / error / empty branches
    /// to be reproduced on the surface itself.
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        case empty
        case data
    }

    public let phase: Phase
    public let pills: [BatteryPillProjection]
    public let stats: [MiniStatProjection]
    public let isFetching: Bool
    public let isStale: Bool
    public let isOffline: Bool

    public init(
        phase: Phase,
        pills: [BatteryPillProjection],
        stats: [MiniStatProjection],
        isFetching: Bool,
        isStale: Bool,
        isOffline: Bool
    ) {
        self.phase = phase
        self.pills = pills
        self.stats = stats
        self.isFetching = isFetching
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

/// Pure projection from the query snapshot to the resolved view-state. `error`
/// deliberately takes precedence over cached metrics (a refetch failure shows the
/// error box, not stale tiles). The section is "empty" when there are no charging
/// sessions to report battery health from (web parent `!hasData`). The stale /
/// offline flags only annotate the data + empty branches — they are overlays, not
/// phases, and only once there is content to annotate. Unit tested across every branch.
public enum BatteryHealthProjection {
    public static func resolve(_ input: BatteryHealthInput) -> BatteryHealthResolved {
        let pills = input.metrics.map(BatteryHealthTiles.pills) ?? []
        let stats = input.metrics.map(BatteryHealthTiles.stats) ?? []
        let hasContent = input.metrics != nil
        let isStale = hasContent && input.isStale
        let isOffline = hasContent && input.isOffline

        let phase: BatteryHealthResolved.Phase = if input.isLoading {
            .loading
        } else if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else if (input.metrics?.chargingSessionCount ?? 0) == 0 {
            .empty
        } else {
            .data
        }

        return BatteryHealthResolved(
            phase: phase,
            pills: pills,
            stats: stats,
            isFetching: input.isFetching,
            isStale: isStale,
            isOffline: isOffline
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared state-holder / TanStack-parity digest query layer; previews and tests use
/// `InMemoryBatteryHealthSource`. `refresh()` maps to the hook's `refetch`. The view
/// never talks to the network directly.
@MainActor
public protocol BatteryHealthSource: AnyObject {
    var onUpdate: (@MainActor (BatteryHealthInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The section's observable view-model. Subscribes to a `BatteryHealthSource`,
/// recomputes the resolved projection, and exposes a render `Phase` (plus the pills /
/// stats + freshness flags) for SwiftUI to switch over.
@MainActor
@Observable
public final class BatteryHealthModel {
    public private(set) var phase: BatteryHealthResolved.Phase = .loading
    public private(set) var pills: [BatteryPillProjection] = []
    public private(set) var stats: [MiniStatProjection] = []
    public private(set) var isFetching = false
    public private(set) var isStale = false
    public private(set) var isOffline = false

    @ObservationIgnored private let source: any BatteryHealthSource
    @ObservationIgnored private let telemetry: any BatteryHealthTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any BatteryHealthSource,
        telemetry: any BatteryHealthTelemetry = OSLogBatteryHealthTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BatteryHealthSection.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-fetches the digest (wired to the error-state retry affordance).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: BatteryHealthInput) {
        let resolved = BatteryHealthProjection.resolve(input)
        phase = resolved.phase
        pills = resolved.pills
        stats = resolved.stats
        isFetching = resolved.isFetching
        isStale = resolved.isStale
        isOffline = resolved.isOffline
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryBatteryHealthSource: BatteryHealthSource {
    public var onUpdate: (@MainActor (BatteryHealthInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BatteryHealthInput?

    public init(initial: BatteryHealthInput? = nil) {
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
    public func push(_ input: BatteryHealthInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "BatteryHealthSection" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time. The parity keys
/// reuse the web `analytics.weeklyDigest.*` namespace verbatim.
public enum BHStrings {
    public static let table = "BatteryHealthSection"

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
