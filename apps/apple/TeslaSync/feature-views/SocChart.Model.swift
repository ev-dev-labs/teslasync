//
//  SocChart.Model.swift
//  TeslaSync — P4 feature view · 0148 · SocChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "SOC % Over Time" drive-detail surface. The view binds through
//  `SocChartModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/drive-detail/SocChart.tsx — the per-sample
//  state-of-charge area chart shown on the drive-detail page.
//
//  The web component receives `chartData` as a prop derived by the parent
//  (`useDriveDetailData`), and the parent owns the `isLoading` / error / freshness
//  lifecycle. The native surface reproduces that whole lifecycle through a
//  `SocChartSource` so every prompt-required state (loading / empty / error /
//  stale / offline / content) renders here. It also owns the shared cursor the web
//  drives via `useSyncedCursor` + `useSyncedReferenceLineX`, so chart selection and
//  any sibling-driven cursor flow through one observable seam.
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
public protocol SocChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSocChartTelemetry: SocChartTelemetry {
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
/// view holds no hardcoded literals. Keys live in the "SocChart" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time; the per-surface
/// table keeps each parallel surface prompt self-contained.
public enum SocChartStrings {
    public static let table = "SocChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `SocChartSource`: the drive-detail telemetry
/// readings + their load status + the live-state connection + the last-update
/// timestamp. The model turns the readings into the indexed area trace.
public struct SocChartUpdate: Sendable, Equatable {
    public var status: SocChartLoadStatus
    public var readings: [SocReading]
    public var connection: SocChartConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SocChartLoadStatus = .loading,
        readings: [SocReading] = [],
        connection: SocChartConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.readings = readings
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the drive-detail telemetry query the web
/// page reads and mapping it into `SocReading`s. Previews + tests use
/// `InMemorySocChartSource`. The view never talks to the network directly.
@MainActor
public protocol SocChartSource: AnyObject {
    var onUpdate: (@MainActor (SocChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `SocChartSource`, projects
/// each snapshot into the indexed SOC trace, exposes a render `SocChartPhase` +
/// freshness for SwiftUI to switch over, owns the shared cursor (web
/// `useSyncedCursor` / `useSyncedReferenceLineX`), and emits the `view.opened`
/// diagnostics event once on first appearance.
@MainActor
@Observable
public final class SocChartModel {
    public private(set) var phase: SocChartPhase = .loading
    public private(set) var connection: SocChartConnection = .live
    public private(set) var samples: [SocSample] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The shared cursor x-label — the native parity of the web `useSyncedCursor`
    /// `activeLabel` / `useSyncedReferenceLineX` `syncedX`. Driven by chart
    /// selection and settable by a parent so sibling drive-detail charts can share
    /// one cursor; `nil` hides the reference line.
    public var selectedTime: String?

    @ObservationIgnored private let source: any SocChartSource
    @ObservationIgnored private let telemetry: any SocChartTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SocChartSource,
        telemetry: any SocChartTelemetry = OSLogSocChartTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The locale used for number formatting (chart axis / tooltip / a11y).
    public var displayLocale: Locale {
        locale
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        SocChartAccessibility.chartSummary(samples: samples, localize: SocChartStrings.string, locale: locale)
    }

    /// Moves the shared cursor to a sample's time label — the native parity of the
    /// web `useSyncedCursor` `onMouseMove` writing the `activeLabel`. `nil` clears
    /// it (pointer left the plot).
    public func moveCursor(to time: String?) {
        selectedTime = time
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SocChartSurface.slug)
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

    private func apply(_ update: SocChartUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        samples = SocChartProjection.samples(from: update.readings)
        phase = SocChartProjection.resolvePhase(update.status, hasTrace: SocChartProjection.hasTrace(samples))
        // Drop a cursor that no longer maps to a sample after the data changed, so a
        // stale reference line never lingers (web clears the synced x on new data).
        if SocChartProjection.index(forTime: selectedTime, in: samples) == nil {
            selectedTime = nil
        }
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps
    /// the cached trace on screen and does not refetch.
    private func handleAutoRefresh(for connection: SocChartConnection) {
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
/// on `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySocChartSource: SocChartSource {
    public var onUpdate: (@MainActor (SocChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SocChartUpdate?

    public init(initial: SocChartUpdate? = nil) {
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
    public func push(_ update: SocChartUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension SocChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SocChartSurface.slug
    }
}
