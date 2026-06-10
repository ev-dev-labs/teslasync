//
//  PowertrainPanel.Model.swift
//  TeslaSync — P4 feature view · 0283 · PowertrainPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the Powertrain telemetry panel. The view binds through
//  `PowertrainModel`; no networking lives in the view. The web source
//  (PowertrainPanel.tsx) is a pure presentational leaf fed a `motorData` prop by its
//  parent (the live-telemetry grid), so the input snapshot here carries that reading
//  (plus the `useUnits` preferences and the parent's loading / error / connectivity
//  state) rather than issuing HTTP itself.
//
//  States: the web leaf's own branches are `motorData ? <body> : <EmptyState>`. On top
//  of those, this surface honours the P4 leaf contract (the same one the sibling
//  EnergyChargingPanel/0279 ships): a `phase` (loading / empty / error / data) fed by
//  the parent's query state, and an orthogonal `connection` axis (live / stale /
//  offline) surfaced as a freshness chip + banner with a one-shot auto-refresh on the
//  stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol PowertrainTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogPowertrainTelemetry: PowertrainTelemetry {
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
public enum PowertrainConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props + `useUnits` + parent lifecycle)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web
/// `motorData` prop and the `useUnits` preferences, plus the parent surface's
/// lifecycle (`isLoading`, an error message, and connectivity). A `nil` reading is the
/// web `!motorData` empty branch.
public struct PowertrainInput: Sendable, Equatable {
    public var reading: PowertrainReading?
    public var units: PowertrainUnits
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: PowertrainConnection

    public init(
        reading: PowertrainReading? = nil,
        units: PowertrainUnits = .metric,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: PowertrainConnection = .live
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
public struct PowertrainResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Initial fetch (web parent `isLoading`) → skeleton chrome.
        case loading
        /// Resolved with no telemetry (web `!motorData`) → friendly empty.
        case empty
        /// Parent query failure → retry affordance (web `QueryError` peer).
        case error(String)
        /// A reading resolved → the full panel body.
        case data(PowertrainProjection)
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's `motorData ? body : empty` branch plus the P4 leaf
/// contract. Unit tested across loading / empty / error / data.
public enum PowertrainProjector {
    public static func resolve(_ input: PowertrainInput) -> PowertrainResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return PowertrainResolved(phase: .error(message))
        }
        // Initial fetch (web parent `isLoading`) → skeleton.
        guard !input.isLoading else {
            return PowertrainResolved(phase: .loading)
        }
        // Web empty branch: no telemetry to render.
        guard let reading = input.reading else {
            return PowertrainResolved(phase: .empty)
        }
        return PowertrainResolved(
            phase: .data(PowertrainProjection.make(reading: reading, units: input.units))
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the live
/// motor-telemetry feed (`useMotorLatest` + `useUnits`); previews and tests use
/// `InMemoryPowertrainSource`. The view never talks to the network.
@MainActor
public protocol PowertrainSource: AnyObject {
    var onUpdate: (@MainActor (PowertrainInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `PowertrainSource`, recomputes
/// the resolved projection, exposes a render `phase` + the `connection` axis, and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class PowertrainModel {
    public private(set) var resolved: PowertrainResolved =
        PowertrainProjector.resolve(PowertrainInput(isLoading: true))
    public private(set) var connection: PowertrainConnection = .live

    public var phase: PowertrainResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any PowertrainSource
    @ObservationIgnored private let telemetry: any PowertrainTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any PowertrainSource,
        telemetry: any PowertrainTelemetry = OSLogPowertrainTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PowertrainPanel.surfaceSlug)
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

    private func apply(_ input: PowertrainInput) {
        resolved = PowertrainProjector.resolve(input)
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
public final class InMemoryPowertrainSource: PowertrainSource {
    public var onUpdate: (@MainActor (PowertrainInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PowertrainInput?

    public init(initial: PowertrainInput? = nil) {
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
    public func push(_ input: PowertrainInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "PowertrainPanel" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum PowertrainStrings {
    public static let table = "PowertrainPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
