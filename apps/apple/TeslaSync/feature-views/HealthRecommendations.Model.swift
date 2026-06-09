//
//  HealthRecommendations.Model.swift
//  TeslaSync — P4 feature view · 0156 · HealthRecommendations (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  Drivetrain Health "recommendations" surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/HealthRecommendations.tsx (a `GlassPanel` of
//  prioritized maintenance tips derived from `overallHealth`). The web leaf is fed `overallHealth`;
//  the native surface owns the full query lifecycle through this seam (loading / loaded / empty /
//  failure) plus live-stream freshness (ADR-013 stale / offline), so every state in the P4 contract
//  renders.
//
//  Vendor-agnostic and SwiftUI-free (Foundation + Observation + OSLog only) so the model + its
//  projection compile and run on a plain host and are pinned by unit tests; the SwiftUI chrome layers
//  on top in HealthRecommendations.swift / .Views.swift / .States.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol HealthRecommendationsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event (the slug is a
/// static, non-identifying constant).
public struct OSLogHealthRecommendationsTelemetry: HealthRecommendationsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's drivetrain-health query, mirroring the shared `LoadableState`
/// cases the web parent projects from its hooks (loading skeleton / resolved data / empty / failure).
public enum HealthRecommendationsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so
/// cached recommendations are clearly labeled while reconnecting / offline.
public enum HealthRecommendationsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The overall drivetrain condition (web union `'good' | 'warning' | 'critical'`). The whole
/// recommendation list derives from this single value, exactly as in the web leaf. The status → token
/// tint mapping lives in HealthRecommendations.Views.swift so this enum stays SwiftUI-free.
public enum HealthRecommendationsHealthStatus: String, Sendable, Equatable, CaseIterable {
    case good
    case warning
    case critical

    /// Whether the drivetrain is healthy (web `overallHealth === 'good'`) — i.e. only the baseline
    /// low-priority maintenance tips apply.
    public var isHealthy: Bool {
        self == .good
    }

    /// Resolves a status from the web union string, defaulting to `.good` for any unrecognized value
    /// (the optimistic default the web score map implies).
    public static func from(raw: String) -> HealthRecommendationsHealthStatus {
        HealthRecommendationsHealthStatus(rawValue: raw) ?? .good
    }
}

/// The drivetrain-health payload this surface consumes — the native mirror of the web
/// `HealthRecommendations` prop (`overallHealth`).
public struct HealthRecommendationsInput: Sendable, Equatable {
    public var overallHealth: HealthRecommendationsHealthStatus

    public init(overallHealth: HealthRecommendationsHealthStatus) {
        self.overallHealth = overallHealth
    }
}

/// One coalesced snapshot pushed by a `HealthRecommendationsSource`: the drivetrain-health payload
/// plus its load/connection status. The model turns this into the projection.
public struct HealthRecommendationsUpdate: Sendable, Equatable {
    public var status: HealthRecommendationsLoadStatus
    public var connection: HealthRecommendationsConnection
    public var isFetching: Bool
    public var data: HealthRecommendationsInput?
    public var updatedAt: Date?

    public init(
        status: HealthRecommendationsLoadStatus = .loading,
        connection: HealthRecommendationsConnection = .live,
        isFetching: Bool = false,
        data: HealthRecommendationsInput? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.data = data
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the drivetrain-health store); previews and tests use `InMemoryHealthRecommendationsSource`.
/// The view never talks to the network directly.
@MainActor
public protocol HealthRecommendationsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (HealthRecommendationsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `HealthRecommendationsSource`, recomputes the
/// `HealthRecommendationsProjection` via `HealthRecommendationsProjector`, and exposes a render
/// `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class HealthRecommendationsModel {
    /// The mutually-exclusive render branches (loading skeleton / resolved list / empty / failure).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: HealthRecommendationsConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: HealthRecommendationsProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any HealthRecommendationsSource
    @ObservationIgnored private let telemetry: any HealthRecommendationsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any HealthRecommendationsSource,
        telemetry: any HealthRecommendationsTelemetry = OSLogHealthRecommendationsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: HealthRecommendationsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (the cached list stays visible). Wired to the retry affordance and to
    /// the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: HealthRecommendationsUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        projection = update.data.map { HealthRecommendationsProjector.project(data: $0) }
        phase = Self.resolvePhase(status: update.status, hasData: update.data != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached list without hammering
    /// an unreachable backend.
    private func handleAutoRefresh(for connection: HealthRecommendationsConnection) {
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

    /// Resolves the render phase. Mirroring the web shell: the skeleton shows only on the initial
    /// fetch; the empty state shows when the source resolves no drivetrain payload; whenever a payload
    /// is known the list renders (cached values stay visible behind a refresh / transient failure so
    /// an offline or stale pod still shows the last-known recommendations).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        status: HealthRecommendationsLoadStatus,
        hasData: Bool
    ) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryHealthRecommendationsSource: HealthRecommendationsSource {
    public var onUpdate: (@MainActor (HealthRecommendationsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: HealthRecommendationsUpdate?

    public init(initial: HealthRecommendationsUpdate? = nil) {
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
    public func push(_ update: HealthRecommendationsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI. `HealthRecommendations` re-exposes it as `surfaceSlug`.
public enum HealthRecommendationsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "HealthRecommendations"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the per-surface "HealthRecommendations" table (folded into the
/// app `Localizable.xcstrings` at integration time). `string` is Foundation-only so the adapter can
/// use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum HealthRecommendationsStrings {
    public static let table = "HealthRecommendations"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
