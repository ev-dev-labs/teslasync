//
//  ServiceStatus.Model.swift
//  TeslaSync — P4 shared surface · 0104 · ServiceStatus (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the service-status surface. The view binds through `ServiceStatusModel`; no
//  networking lives in the view. The web pieces are driven by a `useQuery(fetchSystemStatus)` poll
//  (`refetchInterval: 60_000`) and the `navigator` online/offline status; the native model keeps
//  the same contract: a source emits the controlled system-status snapshot plus the parent's
//  loading / error / connectivity state, the model derives the resolved view-state over it, and a
//  60-second poller re-requests the snapshot (the native parity of the web `refetchInterval`).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ServiceStatusTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogServiceStatusTelemetry: ServiceStatusTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis + web `ServiceStatusBanner`)

/// The freshness of the bound status feed — the orthogonal connectivity axis. `live` hides the
/// banner + chip; `stale` shows the freshness chip and triggers a one-shot auto-refresh; `offline`
/// shows the web `ServiceStatusBanner` notice and keeps the last known dot value.
public enum ServiceStatusConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Subsystem entry (web `SystemStatus.{database,tesla_api,mqtt,worker}`)

/// One backend subsystem's health — a real field from the web `SystemStatus` contract
/// (`database` / `tesla_api` / `mqtt` / `worker`). Surfaced beneath the dot as a compact breakdown
/// so the native surface is informative in every state rather than a lone dot. The `level` reuses
/// the same `overall` taxonomy as the top-level dot.
public struct ServiceComponentStatus: Sendable, Equatable, Identifiable {
    public let id: String
    public let nameKey: String
    public let nameFallback: String
    public let status: String

    public init(id: String, nameKey: String, nameFallback: String, status: String) {
        self.id = id
        self.nameKey = nameKey
        self.nameFallback = nameFallback
        self.status = status
    }

    /// The subsystem's health level, derived with the same mapping as the top-level dot.
    public var level: SystemHealthLevel {
        SystemHealthLevel.forOverall(status)
    }
}

// MARK: - Status snapshot (web `SystemStatus`)

/// One coalesced snapshot of the backend `/system/status` payload — the `overall` rollup the dot
/// paints (web `data.overall`) plus the per-subsystem breakdown. The dot colour derives solely from
/// `overall` (web parity); the components enrich the native presentation + VoiceOver.
public struct SystemStatusSnapshot: Sendable, Equatable {
    public let overall: String
    public let components: [ServiceComponentStatus]

    public init(overall: String, components: [ServiceComponentStatus] = []) {
        self.overall = overall
        self.components = components
    }

    /// Whether the snapshot carries a usable rollup value (web `!data` guard, extended to a blank
    /// `overall`). A snapshot with no `overall` is treated as the P4 empty state.
    public var hasValue: Bool {
        !overall.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Builds a snapshot from the web `SystemStatus` subsystem fields, mapping each present
    /// subsystem to its surface-owned i18n key so callers (the app, previews, tests) never hardcode
    /// a string key. Pass the raw backend `status` strings; absent subsystems pass `nil`.
    public static func fromSystemStatus(
        overall: String,
        database: String? = nil,
        teslaApi: String? = nil,
        mqtt: String? = nil,
        worker: String? = nil
    ) -> SystemStatusSnapshot {
        var components: [ServiceComponentStatus] = []
        if let database {
            components.append(ServiceComponentStatus(
                id: "database", nameKey: "service.status.component.database",
                nameFallback: "Database", status: database
            ))
        }
        if let teslaApi {
            components.append(ServiceComponentStatus(
                id: "tesla_api", nameKey: "service.status.component.teslaApi",
                nameFallback: "Tesla API", status: teslaApi
            ))
        }
        if let mqtt {
            components.append(ServiceComponentStatus(
                id: "mqtt", nameKey: "service.status.component.mqtt",
                nameFallback: "MQTT", status: mqtt
            ))
        }
        if let worker {
            components.append(ServiceComponentStatus(
                id: "worker", nameKey: "service.status.component.worker",
                nameFallback: "Worker", status: worker
            ))
        }
        return SystemStatusSnapshot(overall: overall, components: components)
    }
}

// MARK: - Input snapshot (controlled status + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the controlled `SystemStatusSnapshot` (`nil`
/// until the first fetch resolves, the web `useQuery` `data === undefined`) plus the parent's
/// lifecycle (`isLoading`, an error message, and connectivity).
public struct ServiceStatusInput: Sendable, Equatable {
    public var status: SystemStatusSnapshot?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: ServiceStatusConnection

    public init(
        status: SystemStatusSnapshot? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ServiceStatusConnection = .live
    ) {
        self.status = status
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.data` phase — the fully-derived dot: the health level (web colour
/// ternary), the raw `overall` rollup, and the subsystem breakdown. A pure value so the view is a
/// function of it and snapshot tests assert it directly.
public struct ServiceStatusData: Sendable, Equatable {
    public let level: SystemHealthLevel
    public let overall: String
    public let components: [ServiceComponentStatus]

    public init(level: SystemHealthLevel, overall: String, components: [ServiceComponentStatus]) {
        self.level = level
        self.overall = overall
        self.components = components
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the data phase the derived `data`
/// payload is pre-computed so the view is a pure function of this value.
public struct ServiceStatusResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let data: ServiceStatusData?

    public init(phase: Phase, data: ServiceStatusData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `SystemHealthDot` render logic (`if (!data) return null`, the `overall` colour ternary) extended
/// to the P4 leaf contract. A usable snapshot always wins, so a cached dot survives a background
/// refetch error (the connectivity axis then reflects staleness); otherwise the surface resolves to
/// error → loading → empty. Unit tested across every branch.
public enum ServiceStatusProjection {
    public static func resolve(input: ServiceStatusInput) -> ServiceStatusResolved {
        // Has a usable rollup (web `data` present) → paint the dot, even during a background error.
        if let status = input.status, status.hasValue {
            let level = SystemHealthLevel.forOverall(status.overall)
            let data = ServiceStatusData(
                level: level,
                overall: status.overall,
                components: status.components
            )
            return ServiceStatusResolved(phase: .data, data: data)
        }
        // No usable value (web `!data`) → surface the leaf contract: error → loading → empty.
        if let message = input.errorMessage, !message.isEmpty {
            return ServiceStatusResolved(phase: .error(message), data: nil)
        }
        if input.isLoading {
            return ServiceStatusResolved(phase: .loading, data: nil)
        }
        return ServiceStatusResolved(phase: .empty, data: nil)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `ServiceStatusSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection`
/// axis, drives the 60-second refetch through the injected `ServiceStatusPoller` (web
/// `refetchInterval` parity), emits the `view.opened` diagnostics event once, and auto-refreshes a
/// single time when the feed transitions to stale.
@MainActor
@Observable
public final class ServiceStatusModel {
    public private(set) var resolved: ServiceStatusResolved = .init(phase: .loading, data: nil)
    public private(set) var connection: ServiceStatusConnection = .live

    public var phase: ServiceStatusResolved.Phase {
        resolved.phase
    }

    /// The polling cadence — the native parity of the web `refetchInterval: 60_000`.
    public static let refetchInterval: TimeInterval = 60

    @ObservationIgnored private let source: any ServiceStatusSource
    @ObservationIgnored private let poller: any ServiceStatusPoller
    @ObservationIgnored private let telemetry: any ServiceStatusTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ServiceStatusSource,
        poller: any ServiceStatusPoller = TimerServiceStatusPoller(),
        telemetry: any ServiceStatusTelemetry = OSLogServiceStatusTelemetry()
    ) {
        self.source = source
        self.poller = poller
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing, starts the 60-second poll, and emits the `view.opened` event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ServiceStatus.surfaceSlug)
        source.start()
        poller.start(interval: Self.refetchInterval) { [weak self] in self?.source.refresh() }
    }

    /// Stops the poll and the upstream subscription.
    public func stop() {
        started = false
        poller.stop()
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry + manual pull-to-refresh).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: ServiceStatusInput) {
        resolved = ServiceStatusProjection.resolve(input: input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web background re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "ServiceStatus" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum ServiceStatusStrings {
    public static let table = "ServiceStatus"

    public static let string: ServiceStatusResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
