//
//  PedalUsage.Model.swift
//  TeslaSync — P4 feature view · 0173 · PedalUsage (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the Pedal Usage surface. The view binds through `PedalUsageModel`;
//  no networking lives in the view. SwiftUI parity of
//  features/driving/components/driving-dynamics/PedalUsage.tsx — the driving-dynamics
//  panel that shows the live throttle / brake pedal positions plus the brake-active
//  status for the selected vehicle.
//
//  The web source is a thin presentational leaf fed by `useDriveDynamicsLatest`, reading the
//  three pedal signals (`pedal_position`, `brake_pedal_position`, `brake_pedal_active`) off the
//  `/drive-dynamics/latest` projection and rendering the throttle / brake gauges + brake badge
//  when any one of them is present (`hasAny`), else its empty state. The native surface owns the
//  full live-query lifecycle through this seam, so the same data the web hook resolves (loading /
//  loaded / empty / failure) plus live-stream freshness (ADR-013 stale / offline) all surface
//  here.
//
//  Vendor-agnostic and SwiftUI-free (Foundation + Observation + OSLog only) so the model + the
//  projection it drives compile and run on a plain host and are pinned by unit tests; the SwiftUI
//  chrome layers on top in PedalUsage.swift / PedalUsage.Views.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol PedalTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogPedalTelemetry: PedalTelemetry {
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
/// resolved snapshot / `data === null` or all-empty pedals → empty / failure).
public enum PedalLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so
/// cached readings are clearly labeled while reconnecting / offline.
public enum PedalConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The live pedal reading this surface consumes — the exact subset of the web `DriveDynamicsSnapshot`
/// DTO that `PedalUsage` reads. Throttle + brake positions are percentages (0…100, the units the
/// `/drive-dynamics/latest` projection emits) and `brakePedalActive` is the depressed flag. Every
/// field is optional so a partially-populated snapshot projects exactly like the web `typeof === …`
/// guards, and `hasAny` reproduces the web `hasAny` gate that chooses gauges-vs-empty.
public struct PedalSnapshotInput: Sendable, Equatable {
    public var throttlePosition: Double?
    public var brakePedalPosition: Double?
    public var brakePedalActive: Bool?

    public init(
        throttlePosition: Double? = nil,
        brakePedalPosition: Double? = nil,
        brakePedalActive: Bool? = nil
    ) {
        self.throttlePosition = throttlePosition
        self.brakePedalPosition = brakePedalPosition
        self.brakePedalActive = brakePedalActive
    }

    /// Web `hasAny = throttle != null || brakePos != null || brakeActive != null` — the gate that
    /// decides whether the gauges render or the empty state shows.
    public var hasAny: Bool {
        throttlePosition != nil || brakePedalPosition != nil || brakePedalActive != nil
    }
}

/// The user's display preferences for this surface, mirroring the global number-format settings.
/// `precision` is the web `getGlobalPrecision()` default (2) the gauge `fmtNumber` calls fall back
/// to for non-integer readings; the view never reads settings directly, so the source resolves
/// these and pushes them with each snapshot.
public struct PedalUnitPrefs: Sendable, Equatable {
    public var localeIdentifier: String
    public var precision: Int

    public init(localeIdentifier: String = "en_US", precision: Int = 2) {
        self.localeIdentifier = localeIdentifier
        self.precision = precision
    }
}

/// One coalesced snapshot pushed by a `PedalSource`: the live pedal reading + display prefs plus
/// their load/connection status. The model turns this into the projection + phase.
public struct PedalUpdate: Sendable, Equatable {
    public var status: PedalLoadStatus
    public var connection: PedalConnection
    public var isFetching: Bool
    public var pedal: PedalSnapshotInput?
    public var units: PedalUnitPrefs
    public var updatedAt: Date?

    public init(
        status: PedalLoadStatus = .loading,
        connection: PedalConnection = .live,
        isFetching: Bool = false,
        pedal: PedalSnapshotInput? = nil,
        units: PedalUnitPrefs = PedalUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.pedal = pedal
        self.units = units
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<DriveDynamicsSnapshot>>` from the KMP drive-dynamics
/// live store composed with the settings store for number formatting); previews and tests use
/// `InMemoryPedalSource`. The view never talks to the network directly.
@MainActor
public protocol PedalSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (PedalUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `PedalSource`, recomputes the
/// `PedalProjection` via `PedalProjector`, and exposes a render `Phase` + freshness for SwiftUI to
/// switch over.
@MainActor
@Observable
public final class PedalUsageModel {
    /// The mutually-exclusive render branches: the loading skeleton, the web body's empty branch
    /// (no pedal signal present → "No pedal telemetry received yet"), a failure (native retry
    /// affordance), and the populated throttle / brake gauges + brake badge (`hasAny`).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: PedalConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: PedalProjection?
    public private(set) var units = PedalUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any PedalSource
    @ObservationIgnored private let telemetry: any PedalTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any PedalSource,
        telemetry: any PedalTelemetry = OSLogPedalTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PedalUsageSurface.slug)
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

    private func apply(_ update: PedalUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        units = update.units
        updatedAt = update.updatedAt
        projection = update.pedal.map { PedalProjector.project(pedal: $0, units: update.units) }
        phase = Self.resolvePhase(status: update.status, hasData: update.pedal?.hasAny ?? false)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached reading without
    /// hammering an unreachable backend.
    private func handleAutoRefresh(for connection: PedalConnection) {
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
    /// initial fetch; the empty state shows when no pedal signal is present (web `hasAny` false);
    /// whenever a reading is known the gauges render (cached values stay visible behind a refresh /
    /// transient failure so an offline or stale pod still shows the last-known readings).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the freshness/phase
    /// logic be unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: PedalLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryPedalSource: PedalSource {
    public var onUpdate: (@MainActor (PedalUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PedalUpdate?

    public init(initial: PedalUpdate? = nil) {
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
    public func push(_ update: PedalUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI. `PedalUsage` re-exposes it as `surfaceSlug` for API parity with the other
/// surfaces.
public enum PedalUsageSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "PedalUsage"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "PedalUsage" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time; the per-surface table keeps each
/// parallel surface prompt owning its own strings without editing the shared catalog. `string` is
/// Foundation-only so the adapter's accessibility summary can use it; the SwiftUI `text(_:_:)`
/// helper lives in the view file.
public enum PedalUsageStrings {
    public static let table = "PedalUsage"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
