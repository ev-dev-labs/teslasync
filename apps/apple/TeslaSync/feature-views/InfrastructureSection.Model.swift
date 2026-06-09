//
//  InfrastructureSection.Model.swift
//  TeslaSync — P4 feature view · 0248 · InfrastructureSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the system-status "Infrastructure" surface. The view binds through
//  `InfrastructureModel`; no networking lives in the view. SwiftUI parity of
//  features/system/components/status/InfrastructureSection.tsx.
//
//  The web component composes two interval-refetched reads — `getTelemetryStatus`
//  (2s) and `getExtendedHealth` (30s). The native source seam coalesces those into
//  one `InfraStatusUpdate` so every prompt-required state (loading / empty / error /
//  stale / offline / content) renders here. There is no manual refresh in the web
//  accordion; the only refresh paths are the error-state retry and the one-shot stale
//  auto-refresh (both silent), matching the web's auto-refetch behavior.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted.
public protocol InfrastructureTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogInfrastructureTelemetry: InfrastructureTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "InfrastructureSection" table
/// (mirroring the web `useTranslation()` `t('Infrastructure')`-style calls, where the
/// English label IS the key), folded into the app `Localizable.xcstrings` catalog at
/// integration time; the per-surface table keeps each parallel surface prompt
/// self-contained.
public enum InfrastructureStrings {
    public static let table = "InfrastructureSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `InfrastructureSource`: the two composed reads
/// (telemetry status, database pool) + the load status + the live-state connection +
/// the sync timestamp.
public struct InfraStatusUpdate: Sendable, Equatable {
    public var status: InfraLoadStatus
    /// The web `getTelemetryStatus()` result (`telemetry`).
    public var telemetry: InfraTelemetryDTO?
    /// The web `extHealth.database_pool` slice (`getExtendedHealth()`).
    public var pool: InfraDatabasePoolDTO?
    public var connection: InfraConnection
    public var updatedAt: Date?

    public init(
        status: InfraLoadStatus = .loading,
        telemetry: InfraTelemetryDTO? = nil,
        pool: InfraDatabasePoolDTO? = nil,
        connection: InfraConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.telemetry = telemetry
        self.pool = pool
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the `getTelemetryStatus` / `getExtendedHealth` reads
/// — and projects each emission to an `InfraStatusUpdate`. Previews + tests use
/// `InMemoryInfrastructureSource`. The view never talks to the network.
@MainActor
public protocol InfrastructureSource: AnyObject {
    var onUpdate: (@MainActor (InfraStatusUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the composed reads (the web auto-refetch). A fresh snapshot arrives via
    /// `onUpdate`. Wired to the error-state retry and the stale auto-refresh.
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to an `InfrastructureSource`,
/// projects each snapshot into the SSE-connection info, polling-engine info, and
/// database-pool tiles + a render `InfraPhase`, drives the error-state retry and the
/// one-shot stale auto-refresh, and emits the `view.opened` diagnostics event once on
/// first appearance. `@Observable` for fine-grained SwiftUI tracking.
@MainActor
@Observable
public final class InfrastructureModel {
    public private(set) var phase: InfraPhase = .loading
    public private(set) var connection: InfraConnection = .live
    public private(set) var sse: InfraSSEInfo = .init(
        connected: false,
        endpoint: InfrastructureDisplay.emDash,
        protocolName: InfrastructureDisplay.emDash,
        fallbackActive: false
    )
    public private(set) var polling: InfraPollingInfo = .init(
        active: false,
        mode: InfrastructureDisplay.unknownMode,
        speedup: InfrastructureDisplay.emDash,
        fleetTelemetryLatency: InfrastructureDisplay.emDash,
        fleetApiPolling: InfrastructureDisplay.emDash
    )
    /// The database-pool tiles, or `nil` when the source has no pool snapshot (web
    /// `{extHealth?.database_pool && …}` — the row is omitted, not blanked).
    public private(set) var poolStats: [InfraPoolStat]?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any InfrastructureSource
    @ObservationIgnored private let telemetry: any InfrastructureTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any InfrastructureSource,
        telemetry: any InfrastructureTelemetry = OSLogInfrastructureTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether the SSE / Fleet-Telemetry stream is connected (header badge + a11y).
    public var sseConnected: Bool {
        sse.connected
    }

    /// Whether the database-pool tiles have data to show.
    public var hasPool: Bool {
        poolStats != nil
    }

    /// Whether the surface has any content (a telemetry read or a database pool).
    public var hasContent: Bool {
        phase == .content
    }

    /// The combined VoiceOver summary for the section header.
    public var accessibilitySummary: String {
        InfrastructureAccessibility.sectionSummary(
            hasContent: hasContent,
            sseConnected: sseConnected,
            localize: InfrastructureStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: InfrastructureSurface.slug)
        source.start()
    }

    /// Stops observing the upstream reads.
    public func stop() {
        started = false
        source.stop()
    }

    /// The error-state retry (web `QueryError` refetch): a silent re-fetch — the bound
    /// source pushes a fresh snapshot via `onUpdate`.
    public func retry() {
        source.refresh()
    }

    private func apply(_ update: InfraStatusUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        sse = InfrastructureProjection.sseInfo(from: update.telemetry)
        polling = InfrastructureProjection.pollingInfo(from: update.telemetry)
        poolStats = InfrastructureProjection.poolStats(from: update.pool, locale: locale)
        phase = InfrastructureProjection.resolvePhase(
            update.status,
            hasTelemetry: update.telemetry != nil,
            hasPool: update.pool != nil
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached snapshot on screen and does not refetch. The auto-refresh is silent — the
    /// web has no toast on this surface.
    private func handleAutoRefresh(for connection: InfraConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()`, counts lifecycle calls, and optionally pushes a follow-up snapshot to
/// simulate the refetch driven by `refresh()`.
@MainActor
public final class InMemoryInfrastructureSource: InfrastructureSource {
    public var onUpdate: (@MainActor (InfraStatusUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    /// An optional snapshot pushed when `refresh()` runs (the web read refetch).
    public var refreshedUpdate: InfraStatusUpdate?

    private let initial: InfraStatusUpdate?

    public init(initial: InfraStatusUpdate? = nil, refreshedUpdate: InfraStatusUpdate? = nil) {
        self.initial = initial
        self.refreshedUpdate = refreshedUpdate
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
        if let refreshedUpdate { onUpdate?(refreshedUpdate) }
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: InfraStatusUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension InfrastructureSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        InfrastructureSurface.slug
    }
}
