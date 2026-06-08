//
//  ChargerSpecsPanel.Model.swift
//  TeslaSync — P4 feature view · 0098 · ChargerSpecsPanel (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for
//  the Charger Specs Breakdown surface. The view binds through `ChargerSpecsPanelModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/charging/components/charging-list/ChargerSpecsPanel.tsx — the panel that summarizes
//  the charging history grouped by voltage, phase, cable, and brand.
//
//  The web source is a pure presentational leaf fed `ChargerSpecsData | null` by its parent (the
//  charging list page, which computes it via `computeChargerSpecs`). The native surface owns the
//  full query lifecycle through this seam, so the same data the web parent's hook resolves
//  (loading / loaded / empty / failure) plus live-stream freshness (ADR-013 stale / offline) all
//  surface here.
//
//  Vendor-agnostic and SwiftUI-free so the model + projection compile and run on a plain host
//  (the surface view layers SwiftUI chrome on top in ChargerSpecsPanel.swift).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol ChargerSpecsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogChargerSpecsTelemetry: ChargerSpecsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's charging query, mirroring the shared `LoadableState`
/// cases the web parent projects (web `isLoading` skeleton / resolved data / empty / failure).
public enum ChargerSpecsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so
/// cached values are clearly labeled while reconnecting / offline.
public enum ChargerSpecsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChargerSpecsSource`: the cached breakdown + the display
/// prefs plus their load/connection status. The model turns this into the projection + render
/// phase.
public struct ChargerSpecsUpdate: Sendable, Equatable {
    public var status: ChargerSpecsLoadStatus
    public var connection: ChargerSpecsConnection
    public var isFetching: Bool
    public var specs: ChargerSpecsInput?
    public var prefs: ChargerSpecsUnitPrefs
    public var updatedAt: Date?

    public init(
        status: ChargerSpecsLoadStatus = .loading,
        connection: ChargerSpecsConnection = .live,
        isFetching: Bool = false,
        specs: ChargerSpecsInput? = nil,
        prefs: ChargerSpecsUnitPrefs = ChargerSpecsUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.specs = specs
        self.prefs = prefs
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (the KMP charging + settings stores); previews and tests use
/// `InMemoryChargerSpecsSource`. The view never talks to the network directly.
@MainActor
public protocol ChargerSpecsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChargerSpecsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `ChargerSpecsSource`, recomputes the
/// `ChargerSpecsProjection` via `ChargerSpecsProjector`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargerSpecsPanelModel {
    /// The mutually-exclusive render branches: the web shell's loading skeleton, the body's empty
    /// branch (`!hasData`), a failure (native retry affordance), and the populated grid
    /// (`hasData`).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargerSpecsConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: ChargerSpecsProjection?
    public private(set) var prefs = ChargerSpecsUnitPrefs()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargerSpecsSource
    @ObservationIgnored private let telemetry: any ChargerSpecsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ChargerSpecsSource,
        telemetry: any ChargerSpecsTelemetry = OSLogChargerSpecsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargerSpecsPanelSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached values stay visible). Wired to the retry affordance and to
    /// the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ChargerSpecsUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        prefs = update.prefs
        updatedAt = update.updatedAt
        let resolved = update.specs.map { ChargerSpecsProjector.project(specs: $0, prefs: update.prefs) }
        projection = resolved
        phase = Self.resolvePhase(status: update.status, hasData: resolved?.hasData ?? false)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached value without
    /// hammering an unreachable backend.
    private func handleAutoRefresh(for connection: ChargerSpecsConnection) {
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
    /// initial fetch; the empty state shows when no Voltage / Cable / Brand rows exist (web
    /// `!hasData`); whenever rows are known the grid renders (cached values stay visible behind
    /// refresh / transient failures so an offline or stale pod still shows the last-known specs).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: ChargerSpecsLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryChargerSpecsSource: ChargerSpecsSource {
    public var onUpdate: (@MainActor (ChargerSpecsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargerSpecsUpdate?

    public init(initial: ChargerSpecsUpdate? = nil) {
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
    public func push(_ update: ChargerSpecsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (kept SwiftUI-free for host-testable model)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile
/// and test without SwiftUI. `ChargerSpecsPanel` re-exposes it as `surfaceSlug` for API parity
/// with the other surfaces.
public enum ChargerSpecsPanelSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ChargerSpecsPanel"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so neither the projector
/// nor the views hold hardcoded literals. Keys live in the "ChargerSpecsPanel" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the
/// projector can use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum ChargerSpecsStrings {
    public static let table = "ChargerSpecsPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
