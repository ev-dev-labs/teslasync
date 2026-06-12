//
//  MapTileLayer.Model.swift
//  TeslaSync — P4 shared surface · 0185 · MapTileLayer (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the map base-layer surface. The view binds through `MapTileLayerModel`;
//  no networking lives in the view. It keeps the web data contract (`useQuery(['map-config'])` +
//  `useMap`): a source pushes the coalesced map-config snapshot + load phase + connectivity, the
//  model projects it through `MapTileLayerProjection`, owns the active style (the web `style` prop,
//  switchable natively), emits `view.opened` once, and auto-refreshes once on the stale edge.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; production injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol MapTileLayerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogMapTileLayerTelemetry: MapTileLayerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Map-config snapshot (web `useQuery` slice + the P4 connectivity axis)

/// One coalesced snapshot of the surface's data inputs — the native mirror of the
/// `useQuery(['map-config'])` result (the config + its status) plus the P4 connectivity axis. The
/// model projects it on apply.
public struct MapTileLayerInput: Sendable, Equatable {
    public var connection: MapTileLayerConnection
    public var phase: MapTileLayerLoadPhase
    public var config: MapTileLayerConfigRow?

    public init(
        connection: MapTileLayerConnection = .live,
        phase: MapTileLayerLoadPhase = .loaded,
        config: MapTileLayerConfigRow? = nil
    ) {
        self.connection = connection
        self.phase = phase
        self.config = config
    }
}

// MARK: - Source seam (P1/S8 layer)

/// The seam the model binds through for the map-config data + its refetch + the P4 connectivity
/// axis (web `useQuery(['map-config'])` / `refetch`). Production implements this over the API hook
/// (`LiveMapTileLayerSource`); previews + tests use `InMemoryMapTileLayerSource`. The surface owns
/// no networking — it forwards to the source.
@MainActor
public protocol MapTileLayerSource: AnyObject {
    var onUpdate: (@MainActor (MapTileLayerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production source. Holds the host-provided snapshot + a refetch closure (web `refetch`),
/// re-emitting the snapshot on `start` / `refresh`. The host re-creates the source (or pushes
/// through its own hook) as the query result changes.
@MainActor
public final class LiveMapTileLayerSource: MapTileLayerSource {
    public var onUpdate: (@MainActor (MapTileLayerInput) -> Void)?

    private let input: MapTileLayerInput
    private let onRefresh: @MainActor () -> Void

    public init(input: MapTileLayerInput, onRefresh: @escaping @MainActor () -> Void = {}) {
        self.input = input
        self.onRefresh = onRefresh
    }

    public func start() {
        onUpdate?(input)
    }

    public func stop() {}

    public func refresh() {
        onRefresh()
        onUpdate?(input)
    }
}

/// In-memory source for previews + unit/UI tests. Seeds an optional snapshot on `start()`, lets a
/// test push further snapshots, and records every start/stop/refresh so the contract is asserted.
@MainActor
public final class InMemoryMapTileLayerSource: MapTileLayerSource {
    public var onUpdate: (@MainActor (MapTileLayerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MapTileLayerInput?

    public init(initial: MapTileLayerInput? = nil) {
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
    public func push(_ input: MapTileLayerInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds a `MapTileLayerSource`, projects the config snapshot
/// through `MapTileLayerProjection`, owns the active base-map style (the web `style` prop, switchable
/// via the native picker), exposes the connectivity axis, emits `view.opened` once on first appear,
/// and auto-refreshes once on the stale edge. The last-known config is retained across an offline
/// snapshot so the map keeps its tiles (web cache-then-network behaviour).
@MainActor
@Observable
public final class MapTileLayerModel {
    public private(set) var connection: MapTileLayerConnection = .live
    public private(set) var phase: MapTileLayerLoadPhase = .loading
    public private(set) var config: MapTileLayerConfigRow?
    public var style: MapTileLayerStyle

    public let content: MapTileLayerContent

    @ObservationIgnored private let source: any MapTileLayerSource
    @ObservationIgnored private let telemetry: any MapTileLayerTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastConnection: MapTileLayerConnection = .live

    public init(
        content: MapTileLayerContent,
        source: any MapTileLayerSource,
        telemetry: any MapTileLayerTelemetry = OSLogMapTileLayerTelemetry()
    ) {
        self.content = content
        style = content.style
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// The resolved, view-ready state (the view renders this).
    public var resolved: MapTileLayerResolved {
        MapTileLayerProjection.resolve(
            style: style,
            config: config,
            phase: phase,
            connection: connection
        )
    }

    // MARK: Lifecycle

    /// Begins observing the source and emits `view.opened` once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        source.start()
        emitOpenOnce()
    }

    /// Stops observing the source.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the map config (freshness chip + stale/offline recovery → web `refetch`).
    public func refresh() {
        source.refresh()
    }

    // MARK: Actions (web `style` prop, switchable natively)

    /// Switches the active base-map style (web `tiles[style]`). The picker forwards here.
    public func setStyle(_ style: MapTileLayerStyle) {
        self.style = style
    }

    // MARK: Private

    private func apply(_ input: MapTileLayerInput) {
        let previous = lastConnection
        connection = input.connection
        lastConnection = input.connection
        phase = input.phase
        // Retain the last-known config when a snapshot carries none (offline → keep cached tiles).
        if let config = input.config {
            self.config = config
        }
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch); offline never
        // auto-refreshes (there is no connection to re-fetch over).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func emitOpenOnce() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: MapTileLayerMeta.surfaceSlug)
    }
}

// MARK: - Localisation facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the views hold no hardcoded
/// literals. Keys live in the per-surface "MapTileLayer" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum MapTileLayerStrings {
    public static let table = "MapTileLayer"

    public static let string: MapTileLayerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
