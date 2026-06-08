//
//  TemperatureSection.Model.swift
//  TeslaSync — P4 feature view · 0150 · TemperatureSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the drive-detail "Temperatures" surface. The view binds through
//  `TemperatureSectionModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/drive-detail/TemperatureSection.tsx.
//
//  The web component receives `chartData` + `stats` as props derived by the parent
//  drive-detail page (`useDriveDetailData`), and the parent owns the `isLoading` /
//  error / freshness lifecycle. The native surface reproduces that whole lifecycle
//  through a `TemperatureSectionSource` so every prompt-required state (loading /
//  empty / error / stale / offline / content) renders here. Each snapshot also
//  carries the display unit + locale the web `useUnits()` resolves, so the same
//  preference is honored at the native render boundary.
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
public protocol TempSectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogTempSectionTelemetry: TempSectionTelemetry {
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
/// holds no hardcoded literals. Keys live in the "TemperatureSection" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; the per-surface
/// table keeps each parallel surface prompt self-contained.
public enum TempSectionStrings {
    public static let table = "TemperatureSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `TemperatureSectionSource`: the SI telemetry
/// samples + their load status + the display unit / locale (web `useUnits()`) + the
/// live-state connection + the last-update timestamp.
public struct TempSectionUpdate: Sendable, Equatable {
    public var status: TempSectionLoadStatus
    public var samples: [TempSectionSample]
    public var unit: TempSectionUnit
    public var localeIdentifier: String
    public var connection: TempSectionConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: TempSectionLoadStatus = .loading,
        samples: [TempSectionSample] = [],
        unit: TempSectionUnit = .celsius,
        localeIdentifier: String = "en_US",
        connection: TempSectionConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.samples = samples
        self.unit = unit
        self.localeIdentifier = localeIdentifier
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the drive-detail query the web page reads
/// and mapping its telemetry into SI `TempSectionSample`s alongside the resolved unit
/// preference. Previews + tests use `InMemoryTempSectionSource`. The view never talks
/// to the network directly.
@MainActor
public protocol TemperatureSectionSource: AnyObject {
    var onUpdate: (@MainActor (TempSectionUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `TemperatureSectionSource`,
/// projects each snapshot into the converted, view-ready `TempSectionProjection`,
/// exposes a render `TempSectionPhase` + freshness for SwiftUI to switch over, and
/// emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class TemperatureSectionModel {
    public private(set) var phase: TempSectionPhase = .loading
    public private(set) var connection: TempSectionConnection = .live
    public private(set) var projection: TempSectionProjection = .empty
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var localeIdentifier = "en_US"

    @ObservationIgnored private let source: any TemperatureSectionSource
    @ObservationIgnored private let telemetry: any TempSectionTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TemperatureSectionSource,
        telemetry: any TempSectionTelemetry = OSLogTempSectionTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The locale used for tile / tooltip / a11y number formatting.
    public var displayLocale: Locale {
        Locale(identifier: localeIdentifier)
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        TempSectionAccessibility.chartSummary(
            projection: projection,
            localize: TempSectionStrings.string,
            localeIdentifier: localeIdentifier
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TempSectionSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: TempSectionUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        localeIdentifier = update.localeIdentifier
        projection = TempSectionProjector.project(samples: update.samples, unit: update.unit)
        phase = TempSectionProjector.resolvePhase(update.status, hasContent: projection.hasContent)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached trace on screen and does not refetch.
    private func handleAutoRefresh(for connection: TempSectionConnection) {
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

// MARK: - Empty projection (loading default)

public extension TempSectionProjection {
    /// The zero-value projection the model holds before any snapshot resolves (no
    /// points, no series) — drives the loading skeleton until data arrives.
    static var empty: TempSectionProjection {
        TempSectionProjection(
            points: [],
            presentSeries: [],
            averages: [:],
            climate: nil,
            avgFan: nil,
            maxFan: nil,
            unitSymbol: TempSectionUnit.celsius.symbol
        )
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryTempSectionSource: TemperatureSectionSource {
    public var onUpdate: (@MainActor (TempSectionUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TempSectionUpdate?

    public init(initial: TempSectionUpdate? = nil) {
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
    public func push(_ update: TempSectionUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension TemperatureSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        TempSectionSurface.slug
    }
}
