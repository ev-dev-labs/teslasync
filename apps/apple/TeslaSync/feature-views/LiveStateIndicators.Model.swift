//
//  LiveStateIndicators.Model.swift
//  TeslaSync — P4 feature view · 0292 · LiveStateIndicators (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the live state indicators. The view binds through
//  `LiveStateIndicatorsModel`; no networking lives in the view. The web source
//  (LiveStateIndicators.tsx) is a pure presentational leaf fed a `state: VehicleState`
//  prop by its parent (VehicleDetailPage), so the input snapshot here carries that
//  reading (plus the `useUnits` preferences and the parent's loading / error /
//  connectivity state) rather than issuing HTTP itself.
//
//  States: the web leaf renders its five chips unconditionally; its parent owns the
//  `!state` skeleton and the `SectionErrorBoundary` failure. On top of that presentation
//  this surface honours the P4 leaf contract (the same one the sibling
//  VehicleStatePanel/0287 ships): a `phase` (loading / empty / error / data) fed by the
//  parent's query state, and an orthogonal `connection` axis (live / stale / offline)
//  surfaced as a freshness chip + banner with a one-shot auto-refresh on the stale
//  transition.
//
//  Deliberately SwiftUI-free (Foundation + Observation + OSLog only) so the whole state
//  machine is host-free unit-testable.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol LiveStateIndicatorsTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant; no payload, VIN,
/// or location is recorded.
public struct OSLogLiveStateIndicatorsTelemetry: LiveStateIndicatorsTelemetry {
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
/// freshness chip + banner. `live` hides the chrome (the web renders no freshness
/// affordance at all); `stale` / `offline` show the chip + banner over the last-known
/// badges.
public enum LiveStateIndicatorsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web prop + `useUnits` + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the native mirror of the web
/// `state: VehicleState` prop and the `useUnits` preferences, plus the parent surface's
/// lifecycle (`isLoading`, an error message, and connectivity). A `nil` reading is the
/// absent-data empty branch (web parent `!state`).
public struct LiveStateIndicatorsInput: Sendable, Equatable {
    public var reading: LiveStateReading?
    public var units: LiveStateUnits
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: LiveStateIndicatorsConnection

    public init(
        reading: LiveStateReading? = nil,
        units: LiveStateUnits = .metric,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: LiveStateIndicatorsConnection = .live
    ) {
        self.reading = reading
        self.units = units
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the surface's render branches.
/// `phase` selects the body and carries the pre-computed projection for the data case,
/// so the view is a pure function of this value.
public struct LiveStateResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Initial fetch (web parent `!state` while loading) → skeleton chips.
        case loading
        /// Resolved with no reading → friendly empty state, never a blank box.
        case empty
        /// Parent query failure → retry affordance (web `SectionErrorBoundary` peer).
        case error(String)
        /// A reading resolved → the full row of five badges.
        case data(LiveStateProjection)
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web render branches plus the P4 leaf contract. Unit tested across loading /
/// empty / error / data.
public enum LiveStateIndicatorsProjector {
    public static func resolve(_ input: LiveStateIndicatorsInput) -> LiveStateResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return LiveStateResolved(phase: .error(message))
        }
        // Initial fetch (web parent `!state` skeleton) → skeleton chips.
        guard !input.isLoading else {
            return LiveStateResolved(phase: .loading)
        }
        // Absent data → friendly empty (web parent renders the skeleton instead of the
        // chips; the native leaf shows a non-blank empty surface once resolved).
        guard let reading = input.reading else {
            return LiveStateResolved(phase: .empty)
        }
        return LiveStateResolved(
            phase: .data(LiveStateProjection.make(reading: reading, units: input.units))
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the live
/// signal feed (the SSE `state` snapshot + connectivity + `useUnits`); previews and
/// tests use `InMemoryLiveStateIndicatorsSource`. The view never talks to the network.
@MainActor
public protocol LiveStateIndicatorsSource: AnyObject {
    var onUpdate: (@MainActor (LiveStateIndicatorsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `LiveStateIndicatorsSource`,
/// recomputes the resolved projection, exposes a render `phase` + the `connection` axis,
/// and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class LiveStateIndicatorsModel {
    public private(set) var resolved: LiveStateResolved =
        LiveStateIndicatorsProjector.resolve(LiveStateIndicatorsInput(isLoading: true))
    public private(set) var connection: LiveStateIndicatorsConnection = .live

    public var phase: LiveStateResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any LiveStateIndicatorsSource
    @ObservationIgnored private let telemetry: any LiveStateIndicatorsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any LiveStateIndicatorsSource,
        telemetry: any LiveStateIndicatorsTelemetry = OSLogLiveStateIndicatorsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LiveStateIndicators.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (error retry + the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: LiveStateIndicatorsInput) {
        resolved = LiveStateIndicatorsProjector.resolve(input)
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
public final class InMemoryLiveStateIndicatorsSource: LiveStateIndicatorsSource {
    public var onUpdate: (@MainActor (LiveStateIndicatorsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveStateIndicatorsInput?

    public init(initial: LiveStateIndicatorsInput? = nil) {
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
    public func push(_ input: LiveStateIndicatorsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "LiveStateIndicators" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum LiveStateIndicatorsStrings {
    public static let table = "LiveStateIndicators"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `LiveStateValue`: a `localized` case through the facade, a `literal`
    /// case verbatim. The single place a badge part becomes display text.
    public static func resolve(_ value: LiveStateValue) -> String {
        switch value {
        case let .localized(key, fallback): string(key, fallback)
        case let .literal(text): text
        }
    }
}
