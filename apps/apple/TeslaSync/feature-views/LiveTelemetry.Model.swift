//
//  LiveTelemetry.Model.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the live-telemetry section. The view binds through
//  `LiveTelemetryModel`; no networking lives in the view. The web source
//  (LiveTelemetry.tsx) is a pure presentational leaf fed six live snapshots + the
//  user's display units by the dashboard page, so the input snapshot here carries
//  those (plus the parent's loading / error / connectivity state) rather than issuing
//  HTTP itself.
//
//  States: the web leaf renders each panel as a skeleton until its snapshot arrives,
//  then swaps in the rows. On top of that per-panel behaviour this surface honours the
//  P4 leaf contract (the same one AcDcStatsPanel/0096 ships): a `phase`
//  (loading / empty / error / data) fed by the parent's query state, and an
//  orthogonal `connection` axis (live / stale / offline) surfaced as a freshness chip
//  + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol LiveTelemetryDiagnostics: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogLiveTelemetryDiagnostics: LiveTelemetryDiagnostics {
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
public enum LiveTelemetryConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the dashboard page)

/// One coalesced snapshot of the section's inputs — the native mirror of the web
/// props (the six telemetry objects + the three display-unit selections) plus the
/// parent surface's lifecycle (`isLoading`, an error message, and connectivity). The
/// telemetry values are the base-unit numbers the web component is fed; the units are
/// applied by the projection at the display boundary.
public struct LiveTelemetryInput: Sendable, Equatable {
    public var motor: MotorTelemetry?
    public var climate: ClimateTelemetry?
    public var security: LiveSecurityTelemetry?
    public var tire: LiveTirePressureTelemetry?
    public var media: MediaTelemetry?
    public var navigation: NavigationTelemetry?
    public var units: LiveTelemetryUnits
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: LiveTelemetryConnection

    public init(
        motor: MotorTelemetry? = nil,
        climate: ClimateTelemetry? = nil,
        security: LiveSecurityTelemetry? = nil,
        tire: LiveTirePressureTelemetry? = nil,
        media: MediaTelemetry? = nil,
        navigation: NavigationTelemetry? = nil,
        units: LiveTelemetryUnits = .metric,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: LiveTelemetryConnection = .live
    ) {
        self.motor = motor
        self.climate = climate
        self.security = security
        self.tire = tire
        self.media = media
        self.navigation = navigation
        self.units = units
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }

    /// Whether the snapshot carries no telemetry at all (every panel nil).
    public var isEmpty: Bool {
        motor == nil && climate == nil && security == nil
            && tire == nil && media == nil && navigation == nil
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the section's render
/// branches. `phase` selects the body; each per-panel projection is pre-computed (nil
/// ⇒ the panel renders its skeleton, the web `undefined` branch) so the view is a pure
/// function of this value.
public struct LiveTelemetryResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let drivetrain: DrivetrainProjection?
    public let climate: ClimateProjection?
    public let security: SecurityProjection?
    public let tire: TireProjection?
    public let media: MediaProjection?
    public let navigation: NavigationProjection?

    public init(
        phase: Phase,
        drivetrain: DrivetrainProjection? = nil,
        climate: ClimateProjection? = nil,
        security: SecurityProjection? = nil,
        tire: TireProjection? = nil,
        media: MediaProjection? = nil,
        navigation: NavigationProjection? = nil
    ) {
        self.phase = phase
        self.drivetrain = drivetrain
        self.climate = climate
        self.security = security
        self.tire = tire
        self.media = media
        self.navigation = navigation
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branches plus the P4 leaf contract. Unit tested
/// across loading / empty / error / data and the per-panel skeleton fallbacks.
public enum LiveTelemetryProjection {
    public static func resolve(_ input: LiveTelemetryInput, locale: Locale = .current) -> LiveTelemetryResolved {
        let phase = phase(for: input)
        return LiveTelemetryResolved(
            phase: phase,
            drivetrain: input.motor.map { LiveTelemetryProjections.drivetrain($0, units: input.units, locale: locale) },
            climate: input.climate.map { LiveTelemetryProjections.climate($0, units: input.units, locale: locale) },
            security: input.security.map(LiveTelemetryProjections.security),
            tire: input.tire.map { LiveTelemetryProjections.tire($0, units: input.units, locale: locale) },
            media: input.media.map(LiveTelemetryProjections.media),
            navigation: input.navigation.map {
                LiveTelemetryProjections.navigation($0, units: input.units, locale: locale)
            }
        )
    }

    /// The surface phase: a parent error wins, then the initial fetch, then an
    /// all-nil resolved snapshot (the friendly empty state), else the panel grid.
    private static func phase(for input: LiveTelemetryInput) -> LiveTelemetryResolved.Phase {
        if let message = input.errorMessage, !message.isEmpty {
            return .error(message)
        }
        if input.isLoading {
            return .loading
        }
        if input.isEmpty {
            return .empty
        }
        return .data
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// dashboard page's live-signal + units state holders; previews and tests use
/// `InMemoryLiveTelemetrySource`. The view never talks to the network directly.
@MainActor
public protocol LiveTelemetrySource: AnyObject {
    var onUpdate: (@MainActor (LiveTelemetryInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The section's observable view-model. Subscribes to a `LiveTelemetrySource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class LiveTelemetryModel {
    public private(set) var resolved: LiveTelemetryResolved =
        LiveTelemetryProjection.resolve(LiveTelemetryInput(isLoading: true))
    public private(set) var connection: LiveTelemetryConnection = .live

    public var phase: LiveTelemetryResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any LiveTelemetrySource
    @ObservationIgnored private let diagnostics: any LiveTelemetryDiagnostics
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false

    public init(
        source: any LiveTelemetrySource,
        diagnostics: any LiveTelemetryDiagnostics = OSLogLiveTelemetryDiagnostics(),
        locale: Locale = .current
    ) {
        self.source = source
        self.diagnostics = diagnostics
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        diagnostics.viewOpened(surface: LiveTelemetry.surfaceSlug)
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

    private func apply(_ input: LiveTelemetryInput) {
        resolved = LiveTelemetryProjection.resolve(input, locale: locale)
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
public final class InMemoryLiveTelemetrySource: LiveTelemetrySource {
    public var onUpdate: (@MainActor (LiveTelemetryInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveTelemetryInput?

    public init(initial: LiveTelemetryInput? = nil) {
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
    public func push(_ input: LiveTelemetryInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "LiveTelemetry" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum LiveTelemetryStrings {
    public static let table = "LiveTelemetry"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
