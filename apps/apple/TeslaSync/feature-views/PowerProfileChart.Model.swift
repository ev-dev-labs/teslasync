//
//  PowerProfileChart.Model.swift
//  TeslaSync — P4 feature view · 0146 · PowerProfileChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Power Profile" driving surface. The view binds through
//  `PowerProfileChartModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/drive-detail/PowerProfileChart.tsx — the per-sample drive
//  power / regeneration trace over time.
//
//  The web component receives `chartData` + `stats` as props from `DriveDetailPage`
//  (which owns the `useDrive` query + the `useDriveDetailData` projection) and reads
//  `useSyncedCursor` / `useSyncedReferenceLineX` for the shared hover cursor. The native
//  surface reproduces that whole lifecycle through a `PowerProfileSource` so every
//  prompt-required state (loading / empty / error / stale / offline / content) renders
//  here, and the synced cursor lives in the model (P1/S8) so a parent coordinator can
//  mirror it across sibling drive charts.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016), which
/// is consent-gated and redacted there.
public protocol PowerProfileTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogPowerProfileTelemetry: PowerProfileTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "PowerProfileChart" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each
/// parallel surface prompt self-contained.
public enum PowerProfileStrings {
    public static let table = "PowerProfileChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `PowerProfileSource`: the trace samples + their load
/// status + the footer stats + the live-state connection + the last-update timestamp.
/// Mirrors the web inputs (`chartData` + `stats` props + the parent's query lifecycle)
/// collapsed into a single value. When `stats` is `nil` the model derives them from the
/// samples (web parent reducer parity).
public struct PowerProfileUpdate: Sendable, Equatable {
    public var status: PowerProfileLoadStatus
    public var samples: [PowerProfileSample]
    public var stats: PowerProfileStats?
    public var connection: PowerProfileConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: PowerProfileLoadStatus = .loading,
        samples: [PowerProfileSample] = [],
        stats: PowerProfileStats? = nil,
        connection: PowerProfileConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.samples = samples
        self.stats = stats
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the `useDrive` query + the `useDriveDetailData`
/// projection the web parent page reads. Previews + tests use `InMemoryPowerProfileSource`.
/// The view never talks to the network directly.
@MainActor
public protocol PowerProfileSource: AnyObject {
    var onUpdate: (@MainActor (PowerProfileUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `PowerProfileSource`, projects each
/// snapshot into the footer stats + a render `PowerProfilePhase` + freshness for SwiftUI to
/// switch over, owns the synced hover cursor (web `useSyncedReferenceLineX`), and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class PowerProfileChartModel {
    public private(set) var phase: PowerProfilePhase = .loading
    public private(set) var connection: PowerProfileConnection = .live
    public private(set) var samples: [PowerProfileSample] = []
    public private(set) var stats: PowerProfileStats = .zero
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The shared hover cursor sample index (web `useSyncedReferenceLineX`). The chart
    /// reads + writes it; a parent coordinator can mirror it across sibling charts.
    public var cursorIndex: Int?

    @ObservationIgnored private let source: any PowerProfileSource
    @ObservationIgnored private let telemetry: any PowerProfileTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any PowerProfileSource,
        telemetry: any PowerProfileTelemetry = OSLogPowerProfileTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The number of plotted trace samples (header summary / a11y).
    public var sampleCount: Int {
        samples.count
    }

    /// The display locale the footer + tooltip format with (test seam).
    public var formattingLocale: Locale {
        locale
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        PowerProfileAccessibility.chartSummary(samples: samples, localize: PowerProfileStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PowerProfileSurface.slug)
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

    private func apply(_ update: PowerProfileUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        samples = update.samples
        stats = update.stats ?? PowerProfileProjection.stats(from: update.samples)
        phase = PowerProfileProjection.resolvePhase(update.status, sampleCount: update.samples.count)
        clampCursor()
        handleAutoRefresh(for: update.connection)
    }

    /// Keeps the synced cursor within the current sample range after a snapshot.
    private func clampCursor() {
        guard let index = cursorIndex else { return }
        if samples.isEmpty {
            cursorIndex = nil
        } else if index >= samples.count {
            cursorIndex = samples.count - 1
        } else if index < 0 {
            cursorIndex = 0
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// trace on screen and does not refetch.
    private func handleAutoRefresh(for connection: PowerProfileConnection) {
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
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryPowerProfileSource: PowerProfileSource {
    public var onUpdate: (@MainActor (PowerProfileUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PowerProfileUpdate?

    public init(initial: PowerProfileUpdate? = nil) {
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
    public func push(_ update: PowerProfileUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension PowerProfileChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        PowerProfileSurface.slug
    }
}
