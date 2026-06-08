//
//  ThermalLoadPanel.Model.swift
//  TeslaSync — P4 feature view · 0163 · ThermalLoadPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the thermal-load panel. The view binds through `ThermalLoadModel`; no
//  networking lives in the view. The web source (ThermalLoadPanel.tsx) is a pure
//  presentational leaf fed `sensors`, `peakPower`, `avgPowerMax`, and `stats` by its
//  parent (the Drivetrain Health page), so the input snapshot here carries that payload
//  (plus the parent's loading / error / connectivity state and the `useUnits` context)
//  rather than issuing HTTP itself.
//
//  States: the web leaf's own branches are data-driven (the per-sensor bars and the
//  `peakPower > 0` / `stats ?` inline-metric fallbacks). On top of those, this surface
//  honours the P4 leaf contract (the same one AcDcStatsPanel/0096 ships): a `phase`
//  (loading / empty / error / data) fed by the parent's query state, and an orthogonal
//  `connection` axis (live / stale / offline) surfaced as a freshness chip + banner
//  with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol ThermalLoadTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogThermalLoadTelemetry: ThermalLoadTelemetry {
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
public enum ThermalConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input payload (web props from the Drivetrain Health page)

/// The parent-computed inputs the web panel renders from: the temperature `sensors`
/// (built from the drivetrain-health reading), the already-kW `peakPower` /
/// `avgPower`, and the optional `DrivingStats`. Carried verbatim — the panel is a
/// presentational leaf and does not re-derive these (out of scope here).
public struct ThermalLoadPayload: Sendable, Equatable {
    public var sensors: [ThermalSensorReading]
    public var peakPower: Double
    public var avgPower: Double
    public var stats: ThermalLoadStats?

    public init(
        sensors: [ThermalSensorReading],
        peakPower: Double,
        avgPower: Double,
        stats: ThermalLoadStats?
    ) {
        self.sensors = sensors
        self.peakPower = peakPower
        self.avgPower = avgPower
        self.stats = stats
    }
}

/// One coalesced snapshot of the panel's inputs — the native mirror of the web props
/// (`payload`) plus the `useUnits` context and the parent surface's lifecycle
/// (`isLoading`, an error message, and connectivity). A `nil` payload is the
/// not-yet-loaded state (the parent's `health` is still resolving).
public struct ThermalLoadInput: Sendable, Equatable {
    public var payload: ThermalLoadPayload?
    public var units: ThermalUnitContext
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: ThermalConnection

    public init(
        payload: ThermalLoadPayload? = nil,
        units: ThermalUnitContext = ThermalUnitContext(),
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ThermalConnection = .live
    ) {
        self.payload = payload
        self.units = units
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render branches.
/// `phase` selects the body; the sensors, the kW power readouts, the stats, and the
/// unit context are pre-resolved so the view is a pure function of this value.
public struct ThermalLoadResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let sensors: [ThermalSensorReading]
    public let peakPower: Double
    public let avgPower: Double
    public let stats: ThermalLoadStats?
    public let units: ThermalUnitContext

    public init(
        phase: Phase,
        sensors: [ThermalSensorReading],
        peakPower: Double,
        avgPower: Double,
        stats: ThermalLoadStats?,
        units: ThermalUnitContext
    ) {
        self.phase = phase
        self.sensors = sensors
        self.peakPower = peakPower
        self.avgPower = avgPower
        self.stats = stats
        self.units = units
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web component's render branches plus the P4 leaf contract. Unit tested across
/// loading / empty / error / data.
public enum ThermalLoadProjection {
    public static func resolve(_ input: ThermalLoadInput) -> ThermalLoadResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return resolved(.error(message), input: input)
        }
        // Initial fetch (web parent `isLoading`) or no snapshot yet (`health` resolving).
        guard !input.isLoading, let payload = input.payload else {
            return resolved(.loading, input: input)
        }
        // The web panel only mounts when `health` exists, so an absent sensor set is the
        // friendly empty state rather than a blank surface.
        let phase: ThermalLoadResolved.Phase = payload.sensors.isEmpty ? .empty : .data
        return resolved(phase, input: input)
    }

    private static func resolved(
        _ phase: ThermalLoadResolved.Phase,
        input: ThermalLoadInput
    ) -> ThermalLoadResolved {
        let payload = input.payload
        return ThermalLoadResolved(
            phase: phase,
            sensors: payload?.sensors ?? [],
            peakPower: payload?.peakPower ?? 0,
            avgPower: payload?.avgPower ?? 0,
            stats: payload?.stats,
            units: input.units
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// Drivetrain Health page's resolved health / drives / stats queries and the `useUnits`
/// context; previews and tests use `InMemoryThermalLoadSource`. The view never talks to
/// the network directly.
@MainActor
public protocol ThermalLoadSource: AnyObject {
    var onUpdate: (@MainActor (ThermalLoadInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `ThermalLoadSource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class ThermalLoadModel {
    public private(set) var resolved: ThermalLoadResolved =
        ThermalLoadProjection.resolve(ThermalLoadInput(isLoading: true))
    public private(set) var connection: ThermalConnection = .live

    public var phase: ThermalLoadResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any ThermalLoadSource
    @ObservationIgnored private let telemetry: any ThermalLoadTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ThermalLoadSource,
        telemetry: any ThermalLoadTelemetry = OSLogThermalLoadTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ThermalLoadPanel.surfaceSlug)
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

    private func apply(_ input: ThermalLoadInput) {
        resolved = ThermalLoadProjection.resolve(input)
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
public final class InMemoryThermalLoadSource: ThermalLoadSource {
    public var onUpdate: (@MainActor (ThermalLoadInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ThermalLoadInput?

    public init(initial: ThermalLoadInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: ThermalLoadInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "ThermalLoadPanel" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum ThermalStrings {
    public static let table = "ThermalLoadPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
