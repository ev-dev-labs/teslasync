//
//  ChargingSessionCard.Model.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  The state-holder seams the view binds through: the surface identity + P1/S11
//  telemetry contract (`view.opened`), the P1/S8 source that pushes the resolved
//  session + selection + freshness, the `@Observable` view-model that resolves the
//  render phase and pre-computes the row projection, and the P1/S10 i18n facade
//  (web `useTranslation`). Previews/tests drive the model with the in-memory
//  source; production wires a source over the shared charging state holder. No
//  networking lives in the view.
//

import Foundation
import Observation

// MARK: - Surface identity

/// Stable, non-identifying identity for the `ChargingSessionCard` feature view.
/// The slug is emitted with the P1/S11 `view.opened` contract and is referenced by
/// both the view and its tests so the two never drift. Kept Foundation-side so the
/// model + tests build without a rendering host.
public enum ChargingSessionCardSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "ChargingSessionCard"

    /// Reports the surface becoming visible — the exact path the view runs on
    /// appear, factored out so it is unit-testable without a host.
    public static func reportOpen(to telemetry: any ChargingSessionCardTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - State-holder seam (P1/S8)

/// The load lifecycle for the session slice, mirroring the shared `LoadableState`
/// a production source projects from the charging `Resource<T>`.
public enum ChargingSessionCardStatus: Equatable, Sendable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013): `live`, `stale` (older than the freshness
/// window), `offline` (no connectivity — cached value shown). Drives the chip.
public enum ChargingSessionCardConnection: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a source: the resolved session (or `nil` when
/// empty), the optional anomaly callout, the selection + selectability flags, the
/// layout density, and the load/connection status. The model turns this into the
/// render phase.
public struct ChargingSessionCardUpdate: Equatable, Sendable {
    public var status: ChargingSessionCardStatus
    public var connection: ChargingSessionCardConnection
    public var session: ChargingSessionSummary?
    public var anomaly: ChargingAnomalyInfo?
    public var selected: Bool
    public var selectable: Bool
    public var density: ChargingSessionCardDensity
    public var updatedAt: Date?

    public init(
        status: ChargingSessionCardStatus = .loading,
        connection: ChargingSessionCardConnection = .live,
        session: ChargingSessionSummary? = nil,
        anomaly: ChargingAnomalyInfo? = nil,
        selected: Bool = false,
        selectable: Bool = false,
        density: ChargingSessionCardDensity = .comfortable,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.session = session
        self.anomaly = anomaly
        self.selected = selected
        self.selectable = selectable
        self.density = density
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared
/// P1/S8 charging state holder; previews/tests use the in-memory source. The view
/// never talks to the network directly.
@MainActor
public protocol ChargingSessionCardSource: AnyObject {
    var onUpdate: (@MainActor (ChargingSessionCardUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Toggles selection for the session (web `onToggleSelect(id, on)`).
    func toggleSelect(on: Bool)
    /// Opens the session detail (web `href={/charging/{id}}`).
    func open(id: Int)
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a source, holds the latest
/// session + freshness + selection, exposes a render `Phase`, and pre-computes the
/// row projection for SwiftUI to render.
@MainActor
@Observable
public final class ChargingSessionCardModel {
    /// The mutually-exclusive render branches. `loaded` renders the card; `empty`
    /// is a friendly no-session fallback; `loading` is the initial fetch; `error`
    /// is a hard failure with nothing cached to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case empty
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargingSessionCardConnection = .live
    public private(set) var session: ChargingSessionSummary?
    public private(set) var anomaly: ChargingAnomalyInfo?
    public private(set) var selected = false
    public private(set) var selectable = false
    public private(set) var density: ChargingSessionCardDensity = .comfortable
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargingSessionCardSource
    @ObservationIgnored private let telemetry: any ChargingSessionCardTelemetry
    @ObservationIgnored let formatting: any ChargingSessionCardFormatting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any ChargingSessionCardSource,
        telemetry: any ChargingSessionCardTelemetry = OSLogChargingSessionCardTelemetry(),
        formatting: any ChargingSessionCardFormatting = DefaultChargingSessionCardFormatting(),
        localize: @escaping (String, String) -> String = ChargingSessionCardStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The row projection (web memos), recomputed from the current session using
    /// the formatting facade's display-distance converter. `nil` until a session
    /// resolves.
    public var projection: ChargingSessionCardProjection? {
        guard let session else { return nil }
        return ChargingSessionCardProjection.make(session: session) { [formatting] kilometers in
            formatting.distanceDisplay(kilometers: kilometers)
        }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        ChargingSessionCardSurface.reportOpen(to: telemetry)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (any cached session stays visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    /// Toggles selection optimistically and forwards to the source (web `onToggleSelect`).
    public func toggleSelect(_ on: Bool) {
        selected = on
        source.toggleSelect(on: on)
    }

    /// Opens the session detail (web row `href`).
    public func open() {
        guard let session else { return }
        source.open(id: session.id)
    }

    private func apply(_ update: ChargingSessionCardUpdate) {
        connection = update.connection
        anomaly = update.anomaly
        selected = update.selected
        selectable = update.selectable
        density = update.density
        updatedAt = update.updatedAt
        if let payload = update.session {
            session = payload
        } else if update.status == .empty {
            session = nil
        }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. A cached session stays visible behind a refresh /
    /// failure (freshness reflected by the chip); the skeleton shows only on the
    /// initial fetch with no session yet; the empty state shows when the slice
    /// resolves to no session; the hard-error state only when a failure arrives
    /// with nothing cached to render.
    public static func resolvePhase(_ update: ChargingSessionCardUpdate) -> Phase {
        let hasSession = update.session != nil
        switch update.status {
        case .loading:
            return hasSession ? .loaded : .loading
        case .loaded:
            return hasSession ? .loaded : .empty
        case .empty:
            return .empty
        case let .failed(message):
            return hasSession ? .loaded : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryChargingSessionCardSource: ChargingSessionCardSource {
    public var onUpdate: (@MainActor (ChargingSessionCardUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var toggledTo: [Bool] = []
    public private(set) var openedIds: [Int] = []

    private let initial: ChargingSessionCardUpdate?

    public init(initial: ChargingSessionCardUpdate? = nil) {
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

    public func toggleSelect(on: Bool) {
        toggledTo.append(on)
    }

    public func open(id: Int) {
        openedIds.append(id)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: ChargingSessionCardUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ChargingSessionCard" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; kept
/// per-surface so each parallel prompt owns its own strings without editing the
/// shared catalog.
public enum ChargingSessionCardStrings {
    public static let table = "ChargingSessionCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
