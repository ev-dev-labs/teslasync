//
//  DrivingTips.Model.swift
//  TeslaSync — P4 feature view · 0168 · DrivingTips (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the
//  i18n facade (P1/S10) for the Driving Tips surface. The view binds through
//  `DrivingTipsModel`; no networking lives in the view.
//
//  The web source (DrivingTips.tsx) is a pure presentational leaf fed a computed
//  `motorStats` + `throttleStyle` by its parent (the /driving dynamics page). The
//  native input snapshot therefore carries that view-model plus the parent's lifecycle
//  (loading / error / live-state) rather than issuing HTTP itself.
//
//  States — the web leaf's own branch is data-driven (it always renders the panel and,
//  when `motorStats` is null, a single "Drive your vehicle…" recommendation). On top of
//  that this surface honours the P4 leaf contract (the same one
//  MotorEfficiencyInsights/0171 ships): a `phase` (loading / empty / error / data) fed
//  by the parent's query state, and an orthogonal `connection` axis (live / stale /
//  offline) surfaced as a freshness chip + banner with a one-shot auto-refresh on the
//  stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol DrivingTipsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogDrivingTipsTelemetry: DrivingTipsTelemetry {
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
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum DrivingTipsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the /driving page)

/// One coalesced snapshot of the surface's inputs — the native mirror of the web props
/// (`motorStats`, `throttleStyle`) plus the parent surface's lifecycle (`isLoading`, an
/// error message, and connectivity). The metrics are the parent's already-computed
/// presentation values, carried verbatim.
public struct DrivingTipsInput: Sendable, Equatable {
    public var metrics: DrivingTipsMetrics?
    public var throttleStyle: DrivingThrottleStyle?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: DrivingTipsConnection

    public init(
        metrics: DrivingTipsMetrics? = nil,
        throttleStyle: DrivingThrottleStyle? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: DrivingTipsConnection = .live
    ) {
        self.metrics = metrics
        self.throttleStyle = throttleStyle
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branch + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the component's render branch.
/// `phase` selects the body; the recommendation list and the shared row icon are
/// pre-computed so the view is a pure function of this value.
public struct DrivingTipsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let tips: [DrivingTip]
    public let icon: DrivingTipIcon

    public init(phase: Phase, tips: [DrivingTip], icon: DrivingTipIcon) {
        self.phase = phase
        self.tips = tips
        self.icon = icon
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web component's render branch plus the P4 leaf contract. Unit tested across
/// loading / empty / error / data and the derived recommendation list + row icon.
public enum DrivingTipsProjection {
    public static func resolve(_ input: DrivingTipsInput) -> DrivingTipsResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return DrivingTipsResolved(phase: .error(message), tips: [], icon: .caution)
        }
        // Initial fetch (web parent `isLoading`) before any stats resolve.
        guard !input.isLoading else {
            return DrivingTipsResolved(phase: .loading, tips: [], icon: .caution)
        }
        // Web `motorStats === null` keeps rendering the panel with the single
        // "Drive your vehicle…" recommendation — the P4 `empty` body.
        guard let metrics = input.metrics else {
            return DrivingTipsResolved(
                phase: .empty,
                tips: DrivingTipsCatalog.tips(for: nil),
                icon: DrivingTipIcon.from(throttleStyle: input.throttleStyle)
            )
        }
        // Web parent passes `throttleStyle`; fall back to `getThrottleStyle(avgPower)`
        // so the row icon is correct even if the source omits the prop.
        let style = input.throttleStyle ?? DrivingThrottle.style(forAveragePowerKW: metrics.averagePowerKW)
        return DrivingTipsResolved(
            phase: .data,
            tips: DrivingTipsCatalog.tips(for: metrics),
            icon: DrivingTipIcon.from(throttleStyle: style)
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// /driving page's resolved motor query; previews and tests use
/// `InMemoryDrivingTipsSource`. The view never talks to the network directly.
@MainActor
public protocol DrivingTipsSource: AnyObject {
    var onUpdate: (@MainActor (DrivingTipsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `DrivingTipsSource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class DrivingTipsModel {
    public private(set) var resolved: DrivingTipsResolved =
        DrivingTipsProjection.resolve(DrivingTipsInput(isLoading: true))
    public private(set) var connection: DrivingTipsConnection = .live

    public var phase: DrivingTipsResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any DrivingTipsSource
    @ObservationIgnored private let telemetry: any DrivingTipsTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DrivingTipsSource,
        telemetry: any DrivingTipsTelemetry = OSLogDrivingTipsTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// The locale used by the view's formatters (injected for deterministic tests).
    public var formattingLocale: Locale {
        locale
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DrivingTips.surfaceSlug)
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

    private func apply(_ input: DrivingTipsInput) {
        resolved = DrivingTipsProjection.resolve(input)
        connection = input.connection
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// recommendations on screen and does not refetch.
    private func handleAutoRefresh(for connection: DrivingTipsConnection) {
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
public final class InMemoryDrivingTipsSource: DrivingTipsSource {
    public var onUpdate: (@MainActor (DrivingTipsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DrivingTipsInput?

    public init(initial: DrivingTipsInput? = nil) {
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
    public func push(_ input: DrivingTipsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "DrivingTips" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each
/// parallel surface prompt self-contained.
public enum DrivingTipsStrings {
    public static let table = "DrivingTips"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
