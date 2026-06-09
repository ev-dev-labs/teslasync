//
//  TeslaChargingSessionsMap.Model.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  The state-holder seams the map binds through: the surface identity + P1/S11
//  telemetry contract (`view.opened`), the P1/S8 source that pushes the resolved
//  session slice + freshness, the `@Observable` view-model that resolves the
//  render phase and memoises the projection, and the P1/S10 i18n facade (web
//  `useTranslation`). Previews/tests drive the model with the in-memory source;
//  production wires a source over the shared charging state holder. No networking
//  lives in the view.
//

import Foundation
import Observation

// MARK: - Surface identity

/// Stable, non-identifying identity for the `TeslaChargingSessionsMap` feature
/// view. The slug is emitted with the P1/S11 `view.opened` contract and is shared
/// by the view + its tests so the two never drift. Kept Foundation-side so the
/// model + tests build without a rendering host.
public enum TeslaChargingSessionsMapSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "TeslaChargingSessionsMap"

    /// Reports the surface becoming visible — the exact path the view runs on
    /// appear, factored out so it is unit-testable without a host.
    public static func reportOpen(to telemetry: any TeslaChargingSessionsMapTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - State-holder seam (P1/S8)

/// The load lifecycle for the session slice, mirroring the shared `LoadableState`
/// a production source projects from the charging `Resource<T>`.
public enum TeslaChargingSessionsMapStatus: Equatable, Sendable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013): `live`, `stale` (older than the freshness
/// window), `offline` (no connectivity — cached value shown). Drives the chip.
public enum TeslaChargingSessionsMapConnection: Equatable, Sendable {
    case live
    case stale
    case offline

    /// Whether the slice is a fresh live read.
    public var isLive: Bool {
        self == .live
    }
}

/// One coalesced snapshot pushed by a source: the resolved session slice and the
/// load/connection status. The model turns this into the render phase + projection.
public struct TeslaChargingSessionsMapUpdate: Equatable, Sendable {
    public var status: TeslaChargingSessionsMapStatus
    public var connection: TeslaChargingSessionsMapConnection
    public var sessions: [TeslaChargingSessionRecord]
    public var updatedAt: Date?

    public init(
        status: TeslaChargingSessionsMapStatus = .loading,
        connection: TeslaChargingSessionsMapConnection = .live,
        sessions: [TeslaChargingSessionRecord] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.sessions = sessions
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared
/// P1/S8 charging state holder (the `useCharging` slice); previews/tests use the
/// in-memory source. The view never talks to the network directly.
@MainActor
public protocol TeslaChargingSessionsMapSource: AnyObject {
    var onUpdate: (@MainActor (TeslaChargingSessionsMapUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a source, holds the latest
/// session slice + freshness, exposes a render `Phase`, and memoises the map
/// projection for SwiftUI to render.
@MainActor
@Observable
public final class TeslaChargingSessionsMapModel {
    /// The mutually-exclusive render branches. `loaded` renders the map; `empty`
    /// is a friendly no-plottable-session fallback; `loading` is the initial
    /// fetch; `error` is a hard failure with nothing cached to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case empty
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: TeslaChargingSessionsMapConnection = .live
    public private(set) var sessions: [TeslaChargingSessionRecord] = []
    public private(set) var projection = TeslaChargingSessionsMapProjection(
        markers: [],
        centerLatitude: TeslaChargingSessionsMapProjection.defaultCenterLatitude,
        centerLongitude: TeslaChargingSessionsMapProjection.defaultCenterLongitude
    )
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TeslaChargingSessionsMapSource
    @ObservationIgnored private let telemetry: any TeslaChargingSessionsMapTelemetry
    @ObservationIgnored let formatting: any TeslaChargingSessionsMapFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any TeslaChargingSessionsMapSource,
        telemetry: any TeslaChargingSessionsMapTelemetry = OSLogTeslaChargingSessionsMapTelemetry(),
        formatting: any TeslaChargingSessionsMapFormatting = DefaultTeslaChargingSessionsMapFormatting(),
        localize: @escaping (String, String) -> String = TeslaChargingSessionsMapStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        TeslaChargingSessionsMapSurface.reportOpen(to: telemetry)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (any cached sessions stay visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: TeslaChargingSessionsMapUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        switch update.status {
        case .loaded, .empty:
            sessions = update.sessions
        case .loading, .failed:
            if !update.sessions.isEmpty { sessions = update.sessions }
        }
        projection = TeslaChargingSessionsMapProjection.make(sessions: sessions)
        phase = Self.resolvePhase(status: update.status, hasMarkers: projection.hasPlottableMarkers)
    }

    /// Resolves the render phase. Cached markers stay visible behind a refresh /
    /// failure (freshness reflected by the chip); the skeleton shows only on the
    /// initial fetch with no markers yet; the empty state shows when the slice
    /// resolves with no plottable session; the hard-error state only when a
    /// failure arrives with nothing cached to render.
    public static func resolvePhase(status: TeslaChargingSessionsMapStatus, hasMarkers: Bool) -> Phase {
        switch status {
        case .loading:
            hasMarkers ? .loaded : .loading
        case .loaded:
            hasMarkers ? .loaded : .empty
        case .empty:
            .empty
        case let .failed(message):
            hasMarkers ? .loaded : .error(message)
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTeslaChargingSessionsMapSource: TeslaChargingSessionsMapSource {
    public var onUpdate: (@MainActor (TeslaChargingSessionsMapUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TeslaChargingSessionsMapUpdate?

    public init(initial: TeslaChargingSessionsMapUpdate? = nil) {
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
    public func push(_ update: TeslaChargingSessionsMapUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "TeslaChargingSessionsMap"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time; kept per-surface so each parallel prompt owns its own strings without
/// editing the shared catalog.
public enum TeslaChargingSessionsMapStrings {
    public static let table = "TeslaChargingSessionsMap"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
