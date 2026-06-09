//
//  TripLegList.Model.swift
//  TeslaSync — P4 feature view · 0177 · TripLegList (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the trip-planner route breakdown. The view binds through
//  `TripLegListModel`; no networking lives in the view. The web source
//  (TripLegList.tsx) is a pure presentational component fed `legs` + `chargeStops`
//  props by its parent (the Trip Planner page), so the input snapshot here carries
//  those collections plus the parent's loading / error / connectivity state rather
//  than issuing HTTP itself.
//
//  States: the web component's own branch is data-driven (empty list → EmptyState,
//  otherwise the leg cards). On top of that, this surface honours the P4 leaf
//  contract (the same one AchievementBadge/0051 ships): a `phase`
//  (loading / empty / error / data) fed by the parent's query state, and an
//  orthogonal `connection` axis (live / stale / offline) surfaced as a freshness chip
//  with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol TripLegListTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogTripLegListTelemetry: TripLegListTelemetry {
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
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum TripLegListConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the parent surface)

/// One coalesced snapshot of the route breakdown's inputs — the native mirror of the
/// web props (`legs`, `chargeStops`) plus the parent surface's lifecycle (`isLoading`,
/// an error message, and connectivity) and the resolved display config the two web
/// hooks expose. Carried raw + SI; the unit choice is applied by the projection.
public struct TripLegListInput: Sendable, Equatable {
    public var legs: [TripLegData]
    public var chargeStops: [TripChargeStopData]
    public var config: TripLegFormatConfig
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: TripLegListConnection

    public init(
        legs: [TripLegData] = [],
        chargeStops: [TripChargeStopData] = [],
        config: TripLegFormatConfig = TripLegFormatConfig(),
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TripLegListConnection = .live
    ) {
        self.legs = legs
        self.chargeStops = chargeStops
        self.config = config
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branch + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the component's render
/// branch. `phase` selects the body; for the data phase the interleaved leg + charge
/// stop rows are pre-built so the view is a pure function of this value.
public struct TripLegListResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let rows: [TripLegRow]

    public init(phase: Phase, rows: [TripLegRow]) {
        self.phase = phase
        self.rows = rows
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branch plus the P4 leaf contract. Unit tested
/// across loading / empty / error / data.
public enum TripLegListProjection {
    public static func resolve(_ input: TripLegListInput) -> TripLegListResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return TripLegListResolved(phase: .error(message), rows: [])
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return TripLegListResolved(phase: .loading, rows: [])
        }
        // Web `if (legItems.length === 0)` → the friendly empty state.
        guard !input.legs.isEmpty else {
            return TripLegListResolved(phase: .empty, rows: [])
        }
        let rows = TripLegRowBuilder.build(
            legs: input.legs,
            chargeStops: input.chargeStops,
            config: input.config
        )
        return TripLegListResolved(phase: .data, rows: rows)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// parent surface's resolved trip-plan query; previews and tests use
/// `InMemoryTripLegListSource`. The view never talks to the network directly.
@MainActor
public protocol TripLegListSource: AnyObject {
    var onUpdate: (@MainActor (TripLegListInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The route breakdown's observable view-model. Subscribes to a `TripLegListSource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved rows
/// and the `connection` axis, and auto-refreshes once when the feed transitions to
/// stale.
@MainActor
@Observable
public final class TripLegListModel {
    public private(set) var resolved: TripLegListResolved =
        TripLegListProjection.resolve(TripLegListInput(isLoading: true))
    public private(set) var connection: TripLegListConnection = .live

    public var phase: TripLegListResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any TripLegListSource
    @ObservationIgnored private let telemetry: any TripLegListTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any TripLegListSource,
        telemetry: any TripLegListTelemetry = OSLogTripLegListTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TripLegList.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: TripLegListInput) {
        resolved = TripLegListProjection.resolve(input)
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
public final class InMemoryTripLegListSource: TripLegListSource {
    public var onUpdate: (@MainActor (TripLegListInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TripLegListInput?

    public init(initial: TripLegListInput? = nil) {
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
    public func push(_ input: TripLegListInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "TripLegList" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only
/// so the adapter's accessibility summary can use it; the SwiftUI `text(_:_:)` /
/// `label(_:_:)` helpers live in the main view file.
public enum TripLegListStrings {
    public static let table = "TripLegList"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
