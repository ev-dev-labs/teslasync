//
//  MarkerCluster.Model.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the marker-clustering surface. The view binds through
//  `MarkerClusterModel`; no networking lives in the view. It keeps the web data contract (the
//  `points` prop fed via `useMap`'s host): a source pushes the coalesced point snapshot + feed phase
//  + connectivity, the model projects it through `MarkerClusterProjection`, owns the active cluster
//  colour mode (the web default-palette vs `getClusterColor` choice) and the selected marker (web
//  `onMarkerClick`), emits `view.opened` once, and auto-refreshes once on the stale edge.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; production injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol MarkerClusterTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogMarkerClusterTelemetry: MarkerClusterTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Point snapshot (web `points` prop + the P4 connectivity axis)

/// One coalesced snapshot of the surface's data inputs — the native mirror of the web `points` prop
/// (and the parent query that produced it) plus the P4 connectivity axis. `points == nil` means "no
/// fresh data in this snapshot" (an offline tick keeps the last-known markers, web cache-then-network
/// behaviour); an explicit empty array is a resolved-but-empty feed. The model projects it on apply.
public struct MarkerClusterInput: Sendable, Equatable {
    public var connection: MarkerClusterConnection
    public var phase: MarkerClusterLoadPhase
    public var points: [MarkerClusterPoint]?

    public init(
        connection: MarkerClusterConnection = .live,
        phase: MarkerClusterLoadPhase = .loaded,
        points: [MarkerClusterPoint]? = nil
    ) {
        self.connection = connection
        self.phase = phase
        self.points = points
    }
}

// MARK: - Source seam (P1/S8 layer)

/// The seam the model binds through for the point feed + its refetch + the P4 connectivity axis (web
/// parent `useQuery` / `refetch` that supplies `points`). Production implements this over the API
/// hook (`LiveMarkerClusterSource`); previews + tests use `InMemoryMarkerClusterSource`. The surface
/// owns no networking — it forwards to the source.
@MainActor
public protocol MarkerClusterSource: AnyObject {
    var onUpdate: (@MainActor (MarkerClusterInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production source. Holds the host-provided snapshot + a refetch closure (web `refetch`),
/// re-emitting the snapshot on `start` / `refresh`. The host re-creates the source (or pushes through
/// its own hook) as the query result changes.
@MainActor
public final class LiveMarkerClusterSource: MarkerClusterSource {
    public var onUpdate: (@MainActor (MarkerClusterInput) -> Void)?

    private let input: MarkerClusterInput
    private let onRefresh: @MainActor () -> Void

    public init(input: MarkerClusterInput, onRefresh: @escaping @MainActor () -> Void = {}) {
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
public final class InMemoryMarkerClusterSource: MarkerClusterSource {
    public var onUpdate: (@MainActor (MarkerClusterInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MarkerClusterInput?

    public init(initial: MarkerClusterInput? = nil) {
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
    public func push(_ input: MarkerClusterInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds a `MarkerClusterSource`, projects the point snapshot
/// through `MarkerClusterProjection`, owns the active cluster colour mode (web `getClusterColor` vs
/// the default palette, switchable via the native control) and the selected marker (web
/// `onMarkerClick`), exposes the connectivity axis, emits `view.opened` once on first appear, and
/// auto-refreshes once on the stale edge. The last-known markers are retained across an offline
/// snapshot so the map keeps its points (web cache-then-network behaviour).
@MainActor
@Observable
public final class MarkerClusterModel {
    public private(set) var connection: MarkerClusterConnection = .live
    public private(set) var phase: MarkerClusterLoadPhase = .loading
    public private(set) var points: [MarkerClusterPoint] = []
    public private(set) var selectedPointID: String?
    public var colorMode: MarkerClusterColorMode

    public let content: MarkerClusterContent

    @ObservationIgnored private let source: any MarkerClusterSource
    @ObservationIgnored private let telemetry: any MarkerClusterTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastConnection: MarkerClusterConnection = .live

    public init(
        content: MarkerClusterContent,
        source: any MarkerClusterSource,
        telemetry: any MarkerClusterTelemetry = OSLogMarkerClusterTelemetry()
    ) {
        self.content = content
        colorMode = content.colorMode
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// The resolved, view-ready state (the view renders this). Reflects the live colour mode the user
    /// can switch.
    public var resolved: MarkerClusterResolved {
        var effective = content
        effective.colorMode = colorMode
        return MarkerClusterProjection.resolve(
            points: points,
            content: effective,
            phase: phase,
            connection: connection
        )
    }

    /// The currently selected marker, if any (web `onMarkerClick` target → native callout source).
    public var selectedPoint: MarkerClusterPoint? {
        guard let selectedPointID else { return nil }
        return points.first { $0.id == selectedPointID }
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

    /// Re-requests the point feed (freshness chip + stale/offline recovery → web `refetch`).
    public func refresh() {
        source.refresh()
    }

    // MARK: Actions

    /// Switches the active cluster colour mode (web default palette vs `getClusterColor`). The
    /// switcher forwards here.
    public func setColorMode(_ mode: MarkerClusterColorMode) {
        colorMode = mode
    }

    /// Selects a marker (web `onMarkerClick`) so the surface can show its callout.
    public func select(_ point: MarkerClusterPoint) {
        selectedPointID = point.id
    }

    /// Clears the current marker selection (callout dismissed / map tapped).
    public func clearSelection() {
        selectedPointID = nil
    }

    // MARK: Private

    private func apply(_ input: MarkerClusterInput) {
        let previous = lastConnection
        connection = input.connection
        lastConnection = input.connection
        phase = input.phase
        // Retain the last-known markers when a snapshot carries none (offline → keep cached points).
        if let points = input.points {
            self.points = points
            // Drop a selection that no longer exists in the fresh feed.
            if let selectedPointID, !points.contains(where: { $0.id == selectedPointID }) {
                self.selectedPointID = nil
            }
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
        telemetry.viewOpened(surface: MarkerClusterMeta.surfaceSlug)
    }
}

// MARK: - Localisation facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the views hold no hardcoded
/// literals. Keys live in the per-surface "MarkerCluster" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum MarkerClusterStrings {
    public static let table = "MarkerCluster"

    public static let string: MarkerClusterResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
