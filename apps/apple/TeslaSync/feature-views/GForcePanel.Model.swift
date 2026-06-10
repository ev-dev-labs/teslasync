//
//  GForcePanel.Model.swift
//  TeslaSync — P4 feature view · 0169 · GForcePanel (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the Acceleration G-Force surface. The view binds through
//  `GForcePanelModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/driving-dynamics/GForcePanel.tsx — the driving-dynamics
//  panel that shows the live lateral / longitudinal acceleration plus the combined
//  magnitude for the selected vehicle.
//
//  The web source is a thin presentational leaf fed by `useDriveDynamicsLatest`, reading the
//  two acceleration signals (`lateral_acceleration`, `longitudinal_acceleration`) off the
//  `/drive-dynamics/latest` projection and rendering the 3-up stat row (lateral / longitudinal /
//  combined magnitude) when either reading is present (`hasAny`), else its empty state. The native
//  surface owns the full live-query lifecycle through this seam, so the same data the web hook
//  resolves (loading / loaded / empty / failure) plus live-stream freshness (ADR-013 stale /
//  offline) all surface here.
//
//  Vendor-agnostic and SwiftUI-free (Foundation + Observation + OSLog only) so the model + the
//  projection it drives compile and run on a plain host and are pinned by unit tests; the SwiftUI
//  chrome layers on top in GForcePanel.swift / GForcePanel.Views.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol GForceTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogGForceTelemetry: GForceTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's drive-dynamics query, mirroring the shared `LoadableState`
/// cases the web parent projects from its `useDriveDynamicsLatest` hook (web `isLoading` skeleton /
/// resolved snapshot / `data === null` or both-empty accelerations → empty / failure).
public enum GForceLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so
/// cached readings are clearly labeled while reconnecting / offline.
public enum GForceConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The live acceleration reading this surface consumes — the exact subset of the web
/// `DriveDynamicsSnapshot` DTO that `GForcePanel` reads. Lateral acceleration is +ve to the right
/// (cornering) and longitudinal is +ve forward / -ve braking, both expressed in g (the units the
/// `/drive-dynamics/latest` projection emits). Both fields are optional so a partially-populated
/// snapshot projects exactly like the web `typeof === 'number'` guards, and `hasAny` reproduces the
/// web `hasAny` gate that chooses the stat row vs the empty state.
public struct GForceSnapshotInput: Sendable, Equatable {
    public var lateralAcceleration: Double?
    public var longitudinalAcceleration: Double?

    public init(
        lateralAcceleration: Double? = nil,
        longitudinalAcceleration: Double? = nil
    ) {
        self.lateralAcceleration = lateralAcceleration
        self.longitudinalAcceleration = longitudinalAcceleration
    }

    /// Web `hasAny = lateral != null || longitudinal != null` — the gate that decides whether the
    /// stat row renders or the empty state shows.
    public var hasAny: Bool {
        lateralAcceleration != nil || longitudinalAcceleration != nil
    }
}

/// The user's display preferences for this surface. `localeIdentifier` mirrors the global
/// number-format locale `fmtNumber` reads, so grouping + decimal separators match the user's
/// region. The web source formats every g value at a fixed two decimals (`fmtNumber(value, 2)`), so
/// precision is not a user preference here; the view never reads settings directly, the source
/// resolves the locale and pushes it with each snapshot.
public struct GForceUnitPrefs: Sendable, Equatable {
    public var localeIdentifier: String

    public init(localeIdentifier: String = "en_US") {
        self.localeIdentifier = localeIdentifier
    }
}

/// One coalesced snapshot pushed by a `GForceSource`: the live acceleration reading + display prefs
/// plus their load/connection status. The model turns this into the projection + phase.
public struct GForceUpdate: Sendable, Equatable {
    public var status: GForceLoadStatus
    public var connection: GForceConnection
    public var isFetching: Bool
    public var reading: GForceSnapshotInput?
    public var units: GForceUnitPrefs
    public var updatedAt: Date?

    public init(
        status: GForceLoadStatus = .loading,
        connection: GForceConnection = .live,
        isFetching: Bool = false,
        reading: GForceSnapshotInput? = nil,
        units: GForceUnitPrefs = GForceUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.reading = reading
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<DriveDynamicsSnapshot>>` from the KMP drive-dynamics
/// live store composed with the settings store for number formatting); previews and tests use
/// `InMemoryGForceSource`. The view never talks to the network directly.
@MainActor
public protocol GForceSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (GForceUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `GForceSource`, recomputes the
/// `GForceProjection` via `GForceProjector`, and exposes a render `Phase` + freshness for SwiftUI to
/// switch over.
@MainActor
@Observable
public final class GForcePanelModel {
    /// The mutually-exclusive render branches: the loading skeleton, the web body's empty branch
    /// (no acceleration signal present → "No G-force telemetry received yet"), a failure (native
    /// retry affordance), and the populated lateral / longitudinal / combined stat row (`hasAny`).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: GForceConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: GForceProjection?
    public private(set) var units = GForceUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any GForceSource
    @ObservationIgnored private let telemetry: any GForceTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any GForceSource,
        telemetry: any GForceTelemetry = OSLogGForceTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: GForcePanelSurface.slug)
        source.start()
    }

    /// Stops observing the upstream live feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached readings stay visible). Wired to the retry affordance and to the
    /// stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web stale-query self-refresh (prompt "stale chip + auto-refresh").
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: GForceUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.reading.map { GForceProjector.project(reading: $0, units: update.units) }
        phase = Self.resolvePhase(status: update.status, hasData: update.reading?.hasAny ?? false)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached reading without
    /// hammering an unreachable backend.
    private func handleAutoRefresh(for connection: GForceConnection) {
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

    /// Resolves the render phase. Mirroring the web shell + body: the skeleton shows only on the
    /// initial fetch; the empty state shows when no acceleration signal is present (web `hasAny`
    /// false); whenever a reading is known the stat row renders (cached values stay visible behind a
    /// refresh / transient failure so an offline or stale pod still shows the last-known readings).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: GForceLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryGForceSource: GForceSource {
    public var onUpdate: (@MainActor (GForceUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: GForceUpdate?

    public init(initial: GForceUpdate? = nil) {
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
    public func push(_ update: GForceUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI. `GForcePanel` re-exposes it as `surfaceSlug` for API parity with the other
/// surfaces.
public enum GForcePanelSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "GForcePanel"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "GForcePanel" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time; the per-surface table keeps each
/// parallel surface prompt owning its own strings without editing the shared catalog. `string` is
/// Foundation-only so the adapter's accessibility summary can use it; the SwiftUI `text(_:_:)`
/// helper lives in the view file.
public enum GForcePanelStrings {
    public static let table = "GForcePanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
