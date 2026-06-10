//
//  ChargingTelemetrySection.Model.swift
//  TeslaSync — P4 feature view · 0290 · ChargingTelemetrySection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the vehicle-detail "Charging Telemetry" section. The view binds
//  through `ChargingTelemetrySectionModel`; no networking lives in the view. The web
//  source (ChargingTelemetrySection.tsx) is a pure presentational leaf fed a
//  `chargingTelemetry` prop by its parent (the Vehicle Detail page) and reads the
//  display units from `useUnits()`, so the input snapshot here carries that telemetry
//  + the unit preferences (plus the parent's loading / error / connectivity state)
//  rather than issuing HTTP itself.
//
//  States: the web leaf is `chargingTelemetry ? grid : EmptyState`. On top of that
//  this surface honours the P4 leaf contract: a `phase` (loading / empty / error /
//  data) fed by the parent's query state, and an orthogonal `connection` axis
//  (live / stale / offline) surfaced as a freshness chip + banner with a one-shot
//  auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
///
/// Named `…Diagnostics` (not `…Telemetry`) to avoid both a stutter and a clash with
/// the unrelated `ChargingTelemetryTelemetry` seam owned by the dashboard widget.
public protocol ChargingTelemetrySectionDiagnostics: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogChargingTelemetrySectionDiagnostics: ChargingTelemetrySectionDiagnostics {
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
public enum ChargingTelemetrySectionConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the Vehicle Detail page)

/// One coalesced snapshot of the section's inputs — the native mirror of the web
/// `chargingTelemetry` prop + the display unit preferences (web `useUnits`), plus the
/// parent surface's lifecycle (`isLoading`, an error message, and connectivity).
public struct ChargingTelemetrySectionInput: Sendable, Equatable {
    public var data: ChargingTelemetrySectionData?
    public var prefs: ChargingTelemetrySectionUnitPrefs
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: ChargingTelemetrySectionConnection

    public init(
        data: ChargingTelemetrySectionData? = nil,
        prefs: ChargingTelemetrySectionUnitPrefs = .metric,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ChargingTelemetrySectionConnection = .live
    ) {
        self.data = data
        self.prefs = prefs
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// Vehicle Detail page's charging-telemetry query; previews and tests use
/// `InMemoryChargingTelemetrySectionSource`. The view never talks to the network
/// directly.
@MainActor
public protocol ChargingTelemetrySectionSource: AnyObject {
    var onUpdate: (@MainActor (ChargingTelemetrySectionInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (the header refresh + the error-state retry + the
    /// stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The section's observable view-model. Subscribes to a
/// `ChargingTelemetrySectionSource`, projects each snapshot into the eight formatted
/// metric tiles + a render `phase`, exposes the `connection` axis, emits the
/// `view.opened` diagnostics event once on first appearance, and auto-refreshes once
/// when the feed transitions to stale.
@MainActor
@Observable
public final class ChargingTelemetrySectionModel {
    public private(set) var phase: ChargingTelemetrySectionPhase = .loading
    public private(set) var metrics: [ChargingTelemetrySectionMetric] = []
    public private(set) var connection: ChargingTelemetrySectionConnection = .live

    @ObservationIgnored private let source: any ChargingTelemetrySectionSource
    @ObservationIgnored private let diagnostics: any ChargingTelemetrySectionDiagnostics
    @ObservationIgnored private var started = false

    public init(
        source: any ChargingTelemetrySectionSource,
        diagnostics: any ChargingTelemetrySectionDiagnostics = OSLogChargingTelemetrySectionDiagnostics()
    ) {
        self.source = source
        self.diagnostics = diagnostics
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// The combined VoiceOver summary for the section container.
    public var accessibilitySummary: String {
        ChargingTelemetrySectionAccessibility.sectionSummary(
            metrics: metrics,
            localize: ChargingTelemetrySectionStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        diagnostics.viewOpened(surface: ChargingTelemetrySectionSurface.slug)
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

    private func apply(_ input: ChargingTelemetrySectionInput) {
        phase = ChargingTelemetrySectionProjection.resolvePhase(
            isLoading: input.isLoading,
            errorMessage: input.errorMessage,
            hasData: input.data != nil
        )
        if let data = input.data {
            metrics = ChargingTelemetrySectionProjection.metrics(from: data, prefs: input.prefs)
        } else {
            metrics = []
        }
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch). Reset
        // implicitly: a later stale episode (after returning to live) re-fires once.
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot
/// on `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryChargingTelemetrySectionSource: ChargingTelemetrySectionSource {
    public var onUpdate: (@MainActor (ChargingTelemetrySectionInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargingTelemetrySectionInput?

    public init(initial: ChargingTelemetrySectionInput? = nil) {
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
    public func push(_ input: ChargingTelemetrySectionInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "ChargingTelemetrySection" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum ChargingTelemetrySectionStrings {
    public static let table = "ChargingTelemetrySection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
