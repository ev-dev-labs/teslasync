//
//  EnergyChargingPanel.Model.swift
//  TeslaSync — P4 feature view · 0279 · EnergyChargingPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the Energy & Charging telemetry panel. The view binds through
//  `EnergyChargingModel`; no networking lives in the view. The web source
//  (EnergyChargingPanel.tsx) is a pure presentational leaf fed a `chargingTelemetry`
//  prop by its parent (the live-telemetry grid), so the input snapshot here carries
//  that reading (plus the `useUnits` preferences and the parent's loading / error /
//  connectivity state) rather than issuing HTTP itself.
//
//  States: the web leaf's own branches are `chargingTelemetry ? <body> : <EmptyState>`.
//  On top of those, this surface honours the P4 leaf contract (the same one
//  AcDcStatsPanel/0096 ships): a `phase` (loading / empty / error / data) fed by the
//  parent's query state, and an orthogonal `connection` axis (live / stale / offline)
//  surfaced as a freshness chip + banner with a one-shot auto-refresh on the stale
//  transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol EnergyChargingTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogEnergyChargingTelemetry: EnergyChargingTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as
/// the header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum EnergyChargingConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props + `useUnits` + parent lifecycle)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web
/// `chargingTelemetry` prop and the `useUnits` preferences, plus the parent surface's
/// lifecycle (`isLoading`, an error message, and connectivity). A `nil` reading is the
/// web `!chargingTelemetry` empty branch.
public struct EnergyChargingInput: Sendable, Equatable {
    public var reading: EnergyChargingReading?
    public var units: EnergyChargingUnits
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: EnergyChargingConnection

    public init(
        reading: EnergyChargingReading? = nil,
        units: EnergyChargingUnits = .metric,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: EnergyChargingConnection = .live
    ) {
        self.reading = reading
        self.units = units
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render branches.
/// `phase` selects the body and carries the pre-computed projection for the data case,
/// so the view is a pure function of this value.
public struct EnergyChargingResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Initial fetch (web parent `isLoading`) → skeleton chrome.
        case loading
        /// Resolved with no telemetry (web `!chargingTelemetry`) → friendly empty.
        case empty
        /// Parent query failure → retry affordance (web `QueryError` peer).
        case error(String)
        /// A reading resolved → the full panel body.
        case data(EnergyChargingProjection)
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's `chargingTelemetry ? body : empty` branch plus the P4
/// leaf contract. Unit tested across loading / empty / error / data.
public enum EnergyChargingProjector {
    public static func resolve(_ input: EnergyChargingInput) -> EnergyChargingResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return EnergyChargingResolved(phase: .error(message))
        }
        // Initial fetch (web parent `isLoading`) → skeleton.
        guard !input.isLoading else {
            return EnergyChargingResolved(phase: .loading)
        }
        // Web empty branch: no telemetry to render.
        guard let reading = input.reading else {
            return EnergyChargingResolved(phase: .empty)
        }
        return EnergyChargingResolved(
            phase: .data(EnergyChargingProjection.make(reading: reading, units: input.units))
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the live
/// charging-telemetry feed (`useChargingTelemetryLatest` + `useUnits`); previews and
/// tests use `InMemoryEnergyChargingSource`. The view never talks to the network.
@MainActor
public protocol EnergyChargingSource: AnyObject {
    var onUpdate: (@MainActor (EnergyChargingInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to an `EnergyChargingSource`,
/// recomputes the resolved projection, exposes a render `phase` + the `connection`
/// axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class EnergyChargingModel {
    public private(set) var resolved: EnergyChargingResolved =
        EnergyChargingProjector.resolve(EnergyChargingInput(isLoading: true))
    public private(set) var connection: EnergyChargingConnection = .live

    public var phase: EnergyChargingResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any EnergyChargingSource
    @ObservationIgnored private let telemetry: any EnergyChargingTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any EnergyChargingSource,
        telemetry: any EnergyChargingTelemetry = OSLogEnergyChargingTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EnergyChargingPanel.surfaceSlug)
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

    private func apply(_ input: EnergyChargingInput) {
        resolved = EnergyChargingProjector.resolve(input)
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
public final class InMemoryEnergyChargingSource: EnergyChargingSource {
    public var onUpdate: (@MainActor (EnergyChargingInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EnergyChargingInput?

    public init(initial: EnergyChargingInput? = nil) {
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
    public func push(_ input: EnergyChargingInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "EnergyChargingPanel" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum EnergyChargingStrings {
    public static let table = "EnergyChargingPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
