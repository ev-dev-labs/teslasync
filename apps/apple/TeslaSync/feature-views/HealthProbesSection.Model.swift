//
//  HealthProbesSection.Model.swift
//  TeslaSync — P4 feature view · 0244 · HealthProbesSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the system-status "Health Probes" surface. The view binds through
//  `HealthProbesModel`; no networking lives in the view. SwiftUI parity of
//  features/system/components/status/HealthProbesSection.tsx.
//
//  The web component runs ONE interval-refetched read — `getExtendedHealth` (30s).
//  The native source seam projects each emission to a `HealthProbesUpdate` so every
//  prompt-required state (loading / empty / error / stale / offline / content)
//  renders here. There is no manual refresh in the web accordion; the only refresh
//  paths are the error-state retry and the one-shot stale auto-refresh (both silent),
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
public protocol HealthProbesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogHealthProbesTelemetry: HealthProbesTelemetry {
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
/// holds no hardcoded literals. Keys live in the "HealthProbesSection" table
/// (mirroring the web `useTranslation()` `t('Health Probes')`-style calls, where the
/// English label IS the key), folded into the app `Localizable.xcstrings` catalog at
/// integration time; the per-surface table keeps each parallel surface prompt
/// self-contained.
public enum HealthProbesStrings {
    public static let table = "HealthProbesSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `HealthProbesSource`: the extended-health read
/// + the load status + the live-state connection + the sync timestamp.
public struct HealthProbesUpdate: Sendable, Equatable {
    public var status: HealthProbesLoadStatus
    /// The web `getExtendedHealth()` result (`data`).
    public var health: HealthProbesHealthDTO?
    public var connection: HealthProbesConnection
    public var updatedAt: Date?

    public init(
        status: HealthProbesLoadStatus = .loading,
        health: HealthProbesHealthDTO? = nil,
        connection: HealthProbesConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.health = health
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — running the `getExtendedHealth` read — and projects
/// each emission to a `HealthProbesUpdate`. Previews + tests use
/// `InMemoryHealthProbesSource`. The view never talks to the network.
@MainActor
public protocol HealthProbesSource: AnyObject {
    var onUpdate: (@MainActor (HealthProbesUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the read (the web auto-refetch). A fresh snapshot arrives via
    /// `onUpdate`. Wired to the error-state retry and the stale auto-refresh.
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `HealthProbesSource`,
/// projects each snapshot into the two probe cards + the header badges + a render
/// `HealthProbesPhase`, drives the error-state retry and the one-shot stale
/// auto-refresh, and emits the `view.opened` diagnostics event once on first
/// appearance. `@Observable` for fine-grained SwiftUI tracking.
@MainActor
@Observable
public final class HealthProbesModel {
    public private(set) var phase: HealthProbesPhase = .loading
    public private(set) var connection: HealthProbesConnection = .live
    /// The two probe cards (web body), or empty when there is no health snapshot.
    public private(set) var cards: [HealthProbeCard] = []
    /// The header Live / Ready badges (web `badges`), or empty when there is no data.
    public private(set) var headerBadges: [HealthProbeBadge] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any HealthProbesSource
    @ObservationIgnored private let telemetry: any HealthProbesTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var livenessStatus = HealthProbesDisplay.unknownStatus
    @ObservationIgnored private var readinessStatus = HealthProbesDisplay.unknownStatus

    public init(
        source: any HealthProbesSource,
        telemetry: any HealthProbesTelemetry = OSLogHealthProbesTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether the surface has a health snapshot to show.
    public var hasHealth: Bool {
        !cards.isEmpty
    }

    /// The combined VoiceOver summary for the section header.
    public var accessibilitySummary: String {
        HealthProbesAccessibility.sectionSummary(
            hasHealth: hasHealth,
            livenessStatus: livenessStatus,
            readinessStatus: readinessStatus,
            localize: HealthProbesStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: HealthProbesSurface.slug)
        source.start()
    }

    /// Stops observing the upstream read.
    public func stop() {
        started = false
        source.stop()
    }

    /// The error-state retry (web `QueryError` refetch): a silent re-fetch — the bound
    /// source pushes a fresh snapshot via `onUpdate`.
    public func retry() {
        source.refresh()
    }

    private func apply(_ update: HealthProbesUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        if let health = update.health {
            cards = [
                HealthProbesProjection.livenessCard(from: health, locale: locale),
                HealthProbesProjection.readinessCard(from: health, locale: locale)
            ]
            headerBadges = HealthProbesProjection.headerBadges(from: health)
            livenessStatus = health.status
            readinessStatus = health.database?.status ?? HealthProbesDisplay.unknownStatus
        } else {
            cards = []
            headerBadges = []
            livenessStatus = HealthProbesDisplay.unknownStatus
            readinessStatus = HealthProbesDisplay.unknownStatus
        }
        phase = HealthProbesProjection.resolvePhase(update.status, hasHealth: update.health != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached snapshot on screen and does not refetch. The auto-refresh is silent —
    /// the web has no toast on this surface.
    private func handleAutoRefresh(for connection: HealthProbesConnection) {
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
public final class InMemoryHealthProbesSource: HealthProbesSource {
    public var onUpdate: (@MainActor (HealthProbesUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    /// An optional snapshot pushed when `refresh()` runs (the web read refetch).
    public var refreshedUpdate: HealthProbesUpdate?

    private let initial: HealthProbesUpdate?

    public init(initial: HealthProbesUpdate? = nil, refreshedUpdate: HealthProbesUpdate? = nil) {
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
    public func push(_ update: HealthProbesUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension HealthProbesSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        HealthProbesSurface.slug
    }
}
