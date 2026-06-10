//
//  ServiceHealthSection.Model.swift
//  TeslaSync — P4 feature view · 0252 · ServiceHealthSection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the system-status "Service Health" surface. The view binds through
//  `ServiceHealthModel`; no networking lives in the view. The web source
//  (ServiceHealthSection.tsx) issues one 2-second polling `useQuery`
//  (`getTelemetryStatus`), so the input snapshot here carries the resolved telemetry
//  result plus the query's loading / error state rather than issuing HTTP itself
//  (the production app wires the source to the dev-tools client; previews / tests use
//  `InMemoryServiceHealthSource`).
//
//  States: the web branches are `isLoading` (a skeleton), `error` (a `QueryError`
//  with retry), `!data` (an `EmptyState`), and the populated metric-grid + vehicle
//  table. On top of those, this surface honours the P4 leaf contract: a render
//  `phase` (loading / content / empty / error) fed by the query state, and an
//  orthogonal `connection` axis (live / stale / offline) surfaced as a freshness
//  chip + banner with a one-shot auto-refresh on the stale transition (the web query
//  polls continuously; this is the native-idiomatic surfacing of feed health).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol ServiceHealthTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogServiceHealthTelemetry: ServiceHealthTelemetry {
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
/// the header chip + banner. `live` hides the banner; `stale` / `offline` show it
/// (the web query polls every 2 s; this is the native surfacing of feed health).
public enum ServiceHealthConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web `useQuery` result + query lifecycle)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web
/// `useQuery` result (`data`) plus the query lifecycle (`isLoading`, an error
/// message, and connectivity). `telemetry == nil` while `isLoading == false` and no
/// error is the web `!data` empty branch.
public struct ServiceHealthInput: Sendable, Equatable {
    public var telemetry: TelemetryStatusDTO?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: ServiceHealthConnection

    public init(
        telemetry: TelemetryStatusDTO? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ServiceHealthConnection = .live
    ) {
        self.telemetry = telemetry
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render
/// branches. `phase` selects the body; the enabled flag, mode, streaming tally, the
/// aggregate values, and the (possibly empty) vehicle list are pre-computed so the
/// view is a pure function of this value.
public struct ServiceHealthResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case content
        case empty
        case error(String)
    }

    public let phase: Phase
    public let enabled: Bool
    public let mode: String
    public let streamingCount: Int
    public let totalSignals: Double
    public let avgSignalsPerSecond: String
    public let vehicles: [ServiceVehicleRow]

    public init(
        phase: Phase,
        enabled: Bool = false,
        mode: String = "",
        streamingCount: Int = 0,
        totalSignals: Double = 0,
        avgSignalsPerSecond: String = "0",
        vehicles: [ServiceVehicleRow] = []
    ) {
        self.phase = phase
        self.enabled = enabled
        self.mode = mode
        self.streamingCount = streamingCount
        self.totalSignals = totalSignals
        self.avgSignalsPerSecond = avgSignalsPerSecond
        self.vehicles = vehicles
    }

    /// Whether the header badge cluster shows — the web `data ? <badges> : undefined`,
    /// i.e. whenever a populated snapshot is on screen (content, incl. stale/offline).
    public var showHeaderBadges: Bool {
        if case .content = phase { return true }
        return false
    }

    /// Whether the vehicle table has any rows (web `vehicles.length > 0`); when empty
    /// the table renders its inline "No vehicles connected" message, never hidden.
    public var hasVehicles: Bool {
        !vehicles.isEmpty
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branches plus the P4 leaf contract. Unit
/// tested across loading / error / empty / content and the streaming derivation.
public enum ServiceHealthProjection {
    public static func resolve(_ input: ServiceHealthInput) -> ServiceHealthResolved {
        // P4 contract: a query failure surfaces at the leaf as `error` (web `QueryError`).
        if let message = input.errorMessage, !message.isEmpty {
            return ServiceHealthResolved(phase: .error(message))
        }
        // Web `isLoading` → the skeleton chrome.
        if input.isLoading {
            return ServiceHealthResolved(phase: .loading)
        }
        // Web `!data` → the friendly empty state.
        guard let telemetry = input.telemetry else {
            return ServiceHealthResolved(phase: .empty)
        }
        return ServiceHealthResolved(
            phase: .content,
            enabled: telemetry.enabled,
            mode: telemetry.mode,
            streamingCount: ServiceHealthVehicles.activeCount(telemetry.vehicles),
            totalSignals: telemetry.aggregate?.totalSignalsReceived ?? 0,
            avgSignalsPerSecond: telemetry.aggregate?.avgSignalsPerSecond ?? "0",
            vehicles: ServiceHealthVehicles.rows(from: telemetry.vehicles)
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// dev-tools `getTelemetryStatus` poll; previews and tests use
/// `InMemoryServiceHealthSource`. The view never talks to the network directly.
@MainActor
public protocol ServiceHealthSource: AnyObject {
    var onUpdate: (@MainActor (ServiceHealthInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `ServiceHealthSource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class ServiceHealthModel {
    public private(set) var resolved: ServiceHealthResolved =
        ServiceHealthProjection.resolve(ServiceHealthInput(isLoading: true))
    public private(set) var connection: ServiceHealthConnection = .live

    public var phase: ServiceHealthResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any ServiceHealthSource
    @ObservationIgnored private let telemetry: any ServiceHealthTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any ServiceHealthSource,
        telemetry: any ServiceHealthTelemetry = OSLogServiceHealthTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ServiceHealthSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (error-state retry + manual refresh).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: ServiceHealthInput) {
        resolved = ServiceHealthProjection.resolve(input)
        handleAutoRefresh(for: input.connection)
        connection = input.connection
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached snapshot on screen and does not refetch. The auto-refresh is silent —
    /// the web has no toast on this surface.
    private func handleAutoRefresh(for connection: ServiceHealthConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial
/// snapshot on `start()`, counts lifecycle calls, and can push follow-up snapshots.
@MainActor
public final class InMemoryServiceHealthSource: ServiceHealthSource {
    public var onUpdate: (@MainActor (ServiceHealthInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ServiceHealthInput?

    public init(initial: ServiceHealthInput? = nil) {
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
    public func push(_ input: ServiceHealthInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "ServiceHealthSection" table
/// (mirroring the web `useTranslation()` `t('Service Health')`-style calls, where the
/// English label IS the key), folded into the app `Localizable.xcstrings` catalog at
/// integration time; the per-surface table keeps each parallel surface prompt
/// self-contained.
public enum ServiceHealthStrings {
    public static let table = "ServiceHealthSection"

    /// Resolved `String` for a key (web `t(key, fallback)`). The `LocalizedStringKey`
    /// convenience for shared components lives in `ServiceHealthSection.Views.swift`
    /// (the SwiftUI layer) so this state-holder file stays SwiftUI-free.
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
