//
//  EnergySummaryPanel.Model.swift
//  TeslaSync — P4 feature view · 0142 · EnergySummaryPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the drive energy-summary panel. The view binds through
//  `EnergySummaryModel`; no networking lives in the view. The web source
//  (EnergySummaryPanel.tsx) is a pure presentational leaf fed `drive` + `stats` props
//  by its parent (the Drive Detail page) and reads the distance preference from
//  `useUnits()`, so the input snapshot here carries those numbers + the measurement
//  system (plus the parent's loading / error / connectivity state) rather than issuing
//  HTTP itself.
//
//  States: the web leaf renders the six metric cells with per-cell em-dash fallbacks.
//  On top of those this surface honours the P4 leaf contract: a `phase`
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
public protocol EnergySummaryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogEnergySummaryTelemetry: EnergySummaryTelemetry {
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
public enum EnergySummaryConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the Drive Detail page)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web props
/// (`drive` + `stats` numbers via `EnergySummaryInputData`) and the distance
/// preference (web `useUnits().unitPrefs.distance`, here the shared
/// `MeasurementSystem`), plus the parent surface's lifecycle (`isLoading`, an error
/// message, and connectivity).
public struct EnergySummaryInput: Sendable, Equatable {
    public var data: EnergySummaryInputData?
    public var measurementSystem: MeasurementSystem
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: EnergySummaryConnection

    public init(
        data: EnergySummaryInputData? = nil,
        measurementSystem: MeasurementSystem = .metric,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: EnergySummaryConnection = .live
    ) {
        self.data = data
        self.measurementSystem = measurementSystem
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render branches.
/// `phase` selects the body; `metrics` is the pre-computed six-up grid (already
/// locale-formatted) so the view is a pure function of this value.
public struct EnergySummaryResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let metrics: [EnergySummaryMetric]
    public let distanceUnit: EnergySummaryDistanceUnit

    public init(phase: Phase, metrics: [EnergySummaryMetric], distanceUnit: EnergySummaryDistanceUnit) {
        self.phase = phase
        self.metrics = metrics
        self.distanceUnit = distanceUnit
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render plus the P4 leaf contract. Unit tested across
/// loading / empty / error / data and the distance-preference propagation.
public enum EnergySummaryProjection {
    public static func resolve(_ input: EnergySummaryInput, locale: Locale = .current) -> EnergySummaryResolved {
        let unit = EnergySummaryDistanceUnit(input.measurementSystem)
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return EnergySummaryResolved(phase: .error(message), metrics: [], distanceUnit: unit)
        }
        // Initial fetch (web parent `isLoading`) — keep the panel shape with skeletons.
        if input.isLoading {
            return EnergySummaryResolved(phase: .loading, metrics: [], distanceUnit: unit)
        }
        // Parent resolved but handed us no drive/stats snapshot → friendly empty state.
        guard let data = input.data else {
            return EnergySummaryResolved(phase: .empty, metrics: [], distanceUnit: unit)
        }
        let metrics = EnergySummaryMetricsBuilder.metrics(for: data, unit: unit, locale: locale)
        return EnergySummaryResolved(phase: .data, metrics: metrics, distanceUnit: unit)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the Drive
/// Detail page's resolved drive query + the settings measurement system; previews and
/// tests use `InMemoryEnergySummarySource`. The view never talks to the network.
@MainActor
public protocol EnergySummarySource: AnyObject {
    var onUpdate: (@MainActor (EnergySummaryInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to an `EnergySummarySource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class EnergySummaryModel {
    public private(set) var resolved: EnergySummaryResolved =
        EnergySummaryProjection.resolve(EnergySummaryInput(isLoading: true))
    public private(set) var connection: EnergySummaryConnection = .live

    public var phase: EnergySummaryResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any EnergySummarySource
    @ObservationIgnored private let telemetry: any EnergySummaryTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false

    public init(
        source: any EnergySummarySource,
        telemetry: any EnergySummaryTelemetry = OSLogEnergySummaryTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EnergySummaryPanel.surfaceSlug)
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

    private func apply(_ input: EnergySummaryInput) {
        resolved = EnergySummaryProjection.resolve(input, locale: locale)
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
public final class InMemoryEnergySummarySource: EnergySummarySource {
    public var onUpdate: (@MainActor (EnergySummaryInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EnergySummaryInput?

    public init(initial: EnergySummaryInput? = nil) {
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
    public func push(_ input: EnergySummaryInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "EnergySummaryPanel" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum EnergySummaryStrings {
    public static let table = "EnergySummaryPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
