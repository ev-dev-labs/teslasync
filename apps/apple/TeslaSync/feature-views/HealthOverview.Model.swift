//
//  HealthOverview.Model.swift
//  TeslaSync — P4 feature view · 0155 · HealthOverview (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for
//  the Drivetrain Health "overview" summary surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/HealthOverview.tsx (a status banner shown only
//  when the drivetrain is not healthy, plus a summary card with a status icon, a headline, the
//  "Motor State: …" line, a status badge, and the animated health-score percent). The web leaf
//  is fed `overallHealth` / `healthScore` / `motorStatus`; the native surface owns the full query
//  lifecycle through this seam (loading / loaded / empty / failure) plus live-stream freshness
//  (ADR-013 stale / offline).
//
//  Vendor-agnostic and SwiftUI-free (Foundation + Observation + OSLog only) so the model + its
//  projection compile and run on a plain host and are pinned by unit tests; the SwiftUI chrome
//  layers on top in HealthOverview.swift / HealthOverview.Views.swift / HealthOverview.States.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol HealthOverviewTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogHealthOverviewTelemetry: HealthOverviewTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's drivetrain-health query, mirroring the shared
/// `LoadableState` cases the web parent projects from its hooks (loading skeleton / resolved
/// data / empty / failure).
public enum HealthOverviewLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner
/// so cached values are clearly labeled while reconnecting / offline.
public enum HealthOverviewConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The overall drivetrain condition (web union `'good' | 'warning' | 'critical'`). All of the
/// surface's branches (the status banner, the headline, the status icon, the badge text, and the
/// score tint) derive from this single value, exactly as in the web leaf. The status → token tint
/// + SF Symbol mapping lives in HealthOverview.Views.swift so this enum stays SwiftUI-free.
public enum HealthOverviewHealthStatus: String, Sendable, Equatable, CaseIterable {
    case good
    case warning
    case critical

    /// Whether the drivetrain is healthy (web `overallHealth === 'good'`). Gates the banner and
    /// selects the check vs. warning status icon.
    public var isHealthy: Bool {
        self == .good
    }

    /// The headline shown in the summary card (web ternary on `overallHealth`).
    public var headline: HealthOverviewLabel {
        switch self {
        case .good: HealthOverviewLabel(key: "drivetrain.healthGood", fallback: "Drivetrain Healthy")
        case .warning: HealthOverviewLabel(key: "drivetrain.healthWarn", fallback: "Drivetrain Running Warm")
        case .critical: HealthOverviewLabel(key: "drivetrain.healthCrit", fallback: "Drivetrain Overheating")
        }
    }

    /// The status badge text. The web renders `t('drivetrain.health.${overallHealth}',
    /// overallHealth.toUpperCase())`, so the localized key carries the uppercased enum as its
    /// English fallback.
    public var badgeLabel: HealthOverviewLabel {
        HealthOverviewLabel(key: "drivetrain.health.\(rawValue)", fallback: rawValue.uppercased())
    }

    /// The status banner shown only when the drivetrain is not healthy (web `overallHealth !==
    /// 'good'`). `nil` for `.good`, reproducing the web conditional render.
    public var alert: HealthOverviewAlert? {
        switch self {
        case .good:
            nil
        case .warning:
            HealthOverviewAlert(
                status: .warning,
                title: HealthOverviewLabel(
                    key: "drivetrain.alert.warningTitle",
                    fallback: "Elevated Temperatures Detected"
                ),
                message: HealthOverviewLabel(
                    key: "drivetrain.alert.warningMsg",
                    fallback: "Drivetrain temperatures are above normal operating range. "
                        + "Monitor closely and consider reducing load."
                )
            )
        case .critical:
            HealthOverviewAlert(
                status: .critical,
                title: HealthOverviewLabel(
                    key: "drivetrain.alert.criticalTitle",
                    fallback: "Critical Temperature Warning"
                ),
                message: HealthOverviewLabel(
                    key: "drivetrain.alert.criticalMsg",
                    fallback: "One or more drivetrain components are operating at critically high "
                        + "temperatures. Immediate attention is recommended."
                )
            )
        }
    }

    /// Resolves a status from the web union string, defaulting to `.good` for any unrecognized
    /// value (the optimistic default the web score map implies).
    public static func from(raw: String) -> HealthOverviewHealthStatus {
        HealthOverviewHealthStatus(rawValue: raw) ?? .good
    }
}

/// The drivetrain-health payload this surface consumes — the native mirror of the web
/// `HealthOverview` props (`overallHealth` / `healthScore` / `motorStatus`).
public struct HealthOverviewInput: Sendable, Equatable {
    public var overallHealth: HealthOverviewHealthStatus
    public var healthScore: Double
    public var motorStatus: String

    public init(
        overallHealth: HealthOverviewHealthStatus,
        healthScore: Double,
        motorStatus: String
    ) {
        self.overallHealth = overallHealth
        self.healthScore = healthScore
        self.motorStatus = motorStatus
    }
}

/// One coalesced snapshot pushed by a `HealthOverviewSource`: the drivetrain-health payload + the
/// locale used to group the score number, plus their load/connection status. The model turns this
/// into the projection.
public struct HealthOverviewUpdate: Sendable, Equatable {
    public var status: HealthOverviewLoadStatus
    public var connection: HealthOverviewConnection
    public var isFetching: Bool
    public var data: HealthOverviewInput?
    public var localeIdentifier: String
    public var updatedAt: Date?

    public init(
        status: HealthOverviewLoadStatus = .loading,
        connection: HealthOverviewConnection = .live,
        isFetching: Bool = false,
        data: HealthOverviewInput? = nil,
        localeIdentifier: String = "en_US",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.data = data
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (the drivetrain-health + settings stores); previews and tests use
/// `InMemoryHealthOverviewSource`. The view never talks to the network directly.
@MainActor
public protocol HealthOverviewSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (HealthOverviewUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `HealthOverviewSource`, recomputes the
/// `HealthOverviewProjection` via `HealthOverviewProjector`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class HealthOverviewModel {
    /// The mutually-exclusive render branches (loading skeleton / resolved summary / empty /
    /// failure).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: HealthOverviewConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: HealthOverviewProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any HealthOverviewSource
    @ObservationIgnored private let telemetry: any HealthOverviewTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any HealthOverviewSource,
        telemetry: any HealthOverviewTelemetry = OSLogHealthOverviewTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: HealthOverviewSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (the cached summary stays visible). Wired to the retry affordance
    /// and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: HealthOverviewUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        projection = update.data.map {
            HealthOverviewProjector.project(data: $0, localeIdentifier: update.localeIdentifier)
        }
        phase = Self.resolvePhase(status: update.status, hasData: update.data != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached value without
    /// hammering an unreachable backend.
    private func handleAutoRefresh(for connection: HealthOverviewConnection) {
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
    /// fetch; the empty state shows when the source resolves no drivetrain payload; whenever a
    /// payload is known the summary renders (cached values stay visible behind a refresh /
    /// transient failure so an offline or stale pod still shows the last-known card).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: HealthOverviewLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryHealthOverviewSource: HealthOverviewSource {
    public var onUpdate: (@MainActor (HealthOverviewUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: HealthOverviewUpdate?

    public init(initial: HealthOverviewUpdate? = nil) {
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
    public func push(_ update: HealthOverviewUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile
/// and test without SwiftUI. `HealthOverview` re-exposes it as `surfaceSlug`.
public enum HealthOverviewSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "HealthOverview"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the per-surface "HealthOverview" table (folded into the app
/// `Localizable.xcstrings` at integration time). `string` is Foundation-only so the adapter can
/// use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum HealthOverviewStrings {
    public static let table = "HealthOverview"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
