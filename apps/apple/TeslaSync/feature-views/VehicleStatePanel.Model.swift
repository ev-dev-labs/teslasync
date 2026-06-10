//
//  VehicleStatePanel.Model.swift
//  TeslaSync — P4 feature view · 0287 · VehicleStatePanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the Vehicle State telemetry panel. The view binds through
//  `VehicleStateModel`; no networking lives in the view. The web source
//  (VehicleStatePanel.tsx) is a pure presentational leaf fed a `live` snapshot + an
//  `sseConnected` flag by its parent (the live-telemetry grid), so the input snapshot
//  here carries that reading (plus the `useUnits` preferences and the parent's loading /
//  error / connectivity state) rather than issuing HTTP itself.
//
//  States: the web leaf renders its rows unconditionally. On top of that, this surface
//  honours the P4 leaf contract (the same one the sibling PowertrainPanel/0283 ships): a
//  `phase` (loading / empty / error / data) fed by the parent's query state, and an
//  orthogonal `connection` axis (live / stale / offline) — the native generalisation of
//  the web `sseConnected` "Live" chip — surfaced as a freshness chip + banner with a
//  one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol VehicleStateTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogVehicleStateTelemetry: VehicleStateTelemetry {
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
/// header chip + banner, and the native generalisation of the web `sseConnected` "Live"
/// indicator. `live` shows the "Live" chip and hides the banner; `stale` / `offline`
/// show the banner.
public enum VehicleStateConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props + `useUnits` + parent lifecycle)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web `live`
/// prop and the `useUnits` preferences, plus the parent surface's lifecycle
/// (`isLoading`, an error message, and connectivity). A `nil` reading is the absent-data
/// empty branch.
public struct VehicleStatePanelInput: Sendable, Equatable {
    public var reading: VehicleStateReading?
    public var units: VehicleStateUnits
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: VehicleStateConnection

    public init(
        reading: VehicleStateReading? = nil,
        units: VehicleStateUnits = .metric,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VehicleStateConnection = .live
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
public struct VehicleStateResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Initial fetch (web parent `isLoading`) → skeleton chrome.
        case loading
        /// Resolved with no live reading → friendly empty state, never a blank box.
        case empty
        /// Parent query failure → retry affordance (web `QueryError` peer).
        case error(String)
        /// A reading resolved → the full panel body (the three row sections).
        case data(VehicleStateProjection)
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web render branches plus the P4 leaf contract. Unit tested across loading /
/// empty / error / data.
public enum VehicleStateProjector {
    public static func resolve(_ input: VehicleStatePanelInput) -> VehicleStateResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return VehicleStateResolved(phase: .error(message))
        }
        // Initial fetch (web parent `isLoading`) → skeleton.
        guard !input.isLoading else {
            return VehicleStateResolved(phase: .loading)
        }
        // Absent live data → friendly empty.
        guard let reading = input.reading else {
            return VehicleStateResolved(phase: .empty)
        }
        return VehicleStateResolved(
            phase: .data(VehicleStateProjection.make(reading: reading, units: input.units))
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the live
/// signal feed (the SSE `live` bag + `sseConnected` + `useUnits`); previews and tests
/// use `InMemoryVehicleStateSource`. The view never talks to the network.
@MainActor
public protocol VehicleStateSource: AnyObject {
    var onUpdate: (@MainActor (VehicleStatePanelInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `VehicleStateSource`, recomputes
/// the resolved projection, exposes a render `phase` + the `connection` axis, and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class VehicleStateModel {
    public private(set) var resolved: VehicleStateResolved =
        VehicleStateProjector.resolve(VehicleStatePanelInput(isLoading: true))
    public private(set) var connection: VehicleStateConnection = .live

    public var phase: VehicleStateResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any VehicleStateSource
    @ObservationIgnored private let telemetry: any VehicleStateTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any VehicleStateSource,
        telemetry: any VehicleStateTelemetry = OSLogVehicleStateTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleStatePanel.surfaceSlug)
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

    private func apply(_ input: VehicleStatePanelInput) {
        resolved = VehicleStateProjector.resolve(input)
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
public final class InMemoryVehicleStateSource: VehicleStateSource {
    public var onUpdate: (@MainActor (VehicleStatePanelInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleStatePanelInput?

    public init(initial: VehicleStatePanelInput? = nil) {
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
    public func push(_ input: VehicleStatePanelInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "VehicleStatePanel" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum VehicleStateStrings {
    public static let table = "VehicleStatePanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `VehicleStateValue`: a `localized` case through the facade, a `literal`
    /// case verbatim. The single place the row value becomes display text.
    public static func resolve(_ value: VehicleStateValue) -> String {
        switch value {
        case let .localized(key, fallback): string(key, fallback)
        case let .literal(text): text
        }
    }
}
