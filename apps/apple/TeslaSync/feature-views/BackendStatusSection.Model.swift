//
//  BackendStatusSection.Model.swift
//  TeslaSync — P4 feature view · 0239 · BackendStatusSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the system-status "Backend Status" surface. The view binds through
//  `BackendStatusModel`; no networking lives in the view. SwiftUI parity of
//  features/system/components/status/BackendStatusSection.tsx.
//
//  The web component composes three interval-refetched reads — `getExtendedHealth`
//  (30s), `useConnectionPool` (standard) and `getVersionInfo` (60s). The native
//  source seam coalesces those into one `BackendStatusUpdate` so every prompt-
//  required state (loading / empty / error / stale / offline / content) renders
//  here. There is no manual refresh in the web accordion; the only refresh paths
//  are the error-state retry and the one-shot stale auto-refresh (both silent),
//  matching the web's auto-refetch behavior rather than inventing a button.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol BackendStatusTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogBackendStatusTelemetry: BackendStatusTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "BackendStatusSection" table
/// (mirroring the web `useTranslation()` `t('Backend Status')`-style calls, where
/// the English label IS the key), folded into the app `Localizable.xcstrings`
/// catalog at integration time; the per-surface table keeps each parallel surface
/// prompt self-contained.
public enum BackendStatusStrings {
    public static let table = "BackendStatusSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `BackendStatusSource`: the three composed
/// reads (extended health, connection pool, version) + the load status + the
/// live-state connection + the sync timestamp.
public struct BackendStatusUpdate: Sendable, Equatable {
    public var status: BackendLoadStatus
    /// The web `getExtendedHealth()` result (`extHealth`).
    public var health: BackendHealthDTO?
    /// The web `useConnectionPool()` result (`pool`).
    public var pool: ConnectionPoolDTO?
    /// The web `getVersionInfo()` result (`version`).
    public var version: VersionDTO?
    public var connection: BackendConnection
    public var updatedAt: Date?

    public init(
        status: BackendLoadStatus = .loading,
        health: BackendHealthDTO? = nil,
        pool: ConnectionPoolDTO? = nil,
        version: VersionDTO? = nil,
        connection: BackendConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.health = health
        self.pool = pool
        self.version = version
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the `getExtendedHealth` /
/// `useConnectionPool` / `getVersionInfo` reads — and projects each emission to a
/// `BackendStatusUpdate`. Previews + tests use `InMemoryBackendStatusSource`. The
/// view never talks to the network.
@MainActor
public protocol BackendStatusSource: AnyObject {
    var onUpdate: (@MainActor (BackendStatusUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the composed reads (the web auto-refetch). A fresh snapshot arrives
    /// via `onUpdate`. Wired to the error-state retry and the stale auto-refresh.
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `BackendStatusSource`,
/// projects each snapshot into the component rows, connection-pool tiles, and
/// system-runtime key/values + a render `BackendPhase`, drives the error-state
/// retry and the one-shot stale auto-refresh, and emits the `view.opened`
/// diagnostics event once on first appearance. `@Observable` for fine-grained
/// SwiftUI tracking.
@MainActor
@Observable
public final class BackendStatusModel {
    public private(set) var phase: BackendPhase = .loading
    public private(set) var connection: BackendConnection = .live
    public private(set) var componentRows: [BackendComponentRow] = []
    /// The connection-pool tiles, or `nil` when the source has no pool snapshot
    /// (web `{pool && …}` — the section is omitted, not blanked).
    public private(set) var poolStats: [BackendPoolStat]?
    /// The system-runtime key/values, or `nil` when there is no runtime info
    /// (web `{(extHealth?.system || version) && …}`).
    public private(set) var runtimeRows: [BackendRuntimeRow]?
    /// The healthy-component tally (web `okCount`).
    public private(set) var okCount = 0
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BackendStatusSource
    @ObservationIgnored private let telemetry: any BackendStatusTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any BackendStatusSource,
        telemetry: any BackendStatusTelemetry = OSLogBackendStatusTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The total number of component rows (header tally denominator / a11y).
    public var componentCount: Int {
        componentRows.count
    }

    /// Whether the connection-pool section has data to show.
    public var hasPool: Bool {
        poolStats != nil
    }

    /// Whether the system-runtime section has data to show.
    public var hasRuntime: Bool {
        runtimeRows != nil
    }

    /// The combined VoiceOver summary for the section header.
    public var accessibilitySummary: String {
        BackendStatusAccessibility.sectionSummary(
            componentCount: componentCount,
            okCount: okCount,
            hasPool: hasPool,
            hasRuntime: hasRuntime,
            localize: BackendStatusStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BackendStatusSurface.slug)
        source.start()
    }

    /// Stops observing the upstream reads.
    public func stop() {
        started = false
        source.stop()
    }

    /// The error-state retry (web `QueryError` refetch): a silent re-fetch — the
    /// bound source pushes a fresh snapshot via `onUpdate`.
    public func retry() {
        source.refresh()
    }

    private func apply(_ update: BackendStatusUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt

        let rows = BackendStatusProjection.componentRows(from: update.health?.components ?? [])
        componentRows = rows
        okCount = BackendStatusProjection.okCount(rows)

        poolStats = update.pool.map { BackendStatusProjection.poolStats(from: $0, locale: locale) }

        let system = update.health?.system
        runtimeRows = BackendStatusProjection.hasRuntime(version: update.version, system: system)
            ? BackendStatusProjection.runtimeRows(version: update.version, system: system, locale: locale)
            : nil

        phase = BackendStatusProjection.resolvePhase(
            update.status,
            hasComponents: !rows.isEmpty,
            hasPool: poolStats != nil,
            hasRuntime: runtimeRows != nil
        )

        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps
    /// the cached snapshot on screen and does not refetch. The auto-refresh is
    /// silent — the web has no toast on this surface.
    private func handleAutoRefresh(for connection: BackendConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot
/// on `start()`, counts lifecycle calls, and optionally pushes a follow-up
/// snapshot to simulate the refetch driven by `refresh()`.
@MainActor
public final class InMemoryBackendStatusSource: BackendStatusSource {
    public var onUpdate: (@MainActor (BackendStatusUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    /// An optional snapshot pushed when `refresh()` runs (the web read refetch).
    public var refreshedUpdate: BackendStatusUpdate?

    private let initial: BackendStatusUpdate?

    public init(initial: BackendStatusUpdate? = nil, refreshedUpdate: BackendStatusUpdate? = nil) {
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
    public func push(_ update: BackendStatusUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension BackendStatusSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        BackendStatusSurface.slug
    }
}
