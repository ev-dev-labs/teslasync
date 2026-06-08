//
//  DrivingSection.Model.swift
//  TeslaSync — P4 feature view · 0075 · DrivingSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  weekly-digest "Driving" section. The view binds through `DrivingSectionModel`; no networking
//  lives in the view. SwiftUI parity of
//  features/analytics/components/weekly-digest/DrivingSection.tsx.
//
//  The web component receives `metrics` + `dailyDistanceData` as props derived by the parent
//  `useWeeklyDigest` hook, and the parent owns the `isLoading` / error / freshness lifecycle. The
//  native surface reproduces that whole lifecycle through a `DrivingSectionSource` so every
//  prompt-required state (loading / empty / error / stale / offline / content) renders here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated and redacted there.
public protocol DrivingSectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogDrivingSectionTelemetry: DrivingSectionTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "DrivingSection" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each parallel
/// surface prompt self-contained.
public enum DrivingSectionStrings {
    public static let table = "DrivingSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog (the labels the web
    /// reads via `t()`, plus the unit glyphs + em-dash the web embeds inline).
    public static func copy() -> DrivingSectionCopy {
        DrivingSectionCopy(
            avgEfficiencyLabel: string("analytics.weeklyDigest.avgEfficiency", "Avg Efficiency"),
            totalDrivingTimeLabel: string("analytics.weeklyDigest.totalDrivingTime", "Total Driving Time"),
            efficiencyChangeLabel: string("analytics.weeklyDigest.efficiencyChange", "Efficiency Change"),
            drivesLabel: string("analytics.weeklyDigest.drivesCount", "Drives"),
            topDriveBadge: string("analytics.weeklyDigest.topDrive", "Top Drive"),
            dateLabel: string("analytics.weeklyDigest.date", "Date"),
            distanceLabel: string("analytics.weeklyDigest.distance", "Distance"),
            durationLabel: string("analytics.weeklyDigest.duration", "Duration"),
            efficiencyLabel: string("analytics.weeklyDigest.efficiency", "Efficiency"),
            efficiencyUnit: string("analytics.weeklyDigest.driving.whKmUnit", "Wh/km"),
            distanceUnit: string("analytics.weeklyDigest.driving.kmUnit", "km"),
            durationUnit: string("analytics.weeklyDigest.driving.minUnit", "min"),
            hoursGlyph: string("analytics.weeklyDigest.driving.hoursGlyph", "h"),
            minutesGlyph: string("analytics.weeklyDigest.driving.minutesGlyph", "m"),
            emDash: string("analytics.weeklyDigest.driving.emDash", "—")
        )
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `DrivingSectionSource`: the digest payload + its load status,
/// the live-state connection, the in-flight flag, and the last-update timestamp.
public struct DrivingSectionUpdate: Sendable, Equatable {
    public var status: DrivingSectionLoadStatus
    public var data: DrivingDigestDTO?
    public var connection: DrivingSectionConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: DrivingSectionLoadStatus = .loading,
        data: DrivingDigestDTO? = nil,
        connection: DrivingSectionConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.data = data
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders — composing the drives query the web `useWeeklyDigest` reads and projecting it into the
/// `DigestMetrics` slice + daily-distance bins. Previews + tests use `InMemoryDrivingSectionSource`.
/// The view never talks to the network directly.
@MainActor
public protocol DrivingSectionSource: AnyObject {
    var onUpdate: (@MainActor (DrivingSectionUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `DrivingSectionSource`, projects each
/// snapshot into chart-ready bars + stat tiles + the Top Drive card, exposes a render
/// `DrivingSectionPhase` + freshness for SwiftUI to switch over, and emits the `view.opened`
/// diagnostics event once on first appearance.
@MainActor
@Observable
public final class DrivingSectionModel {
    public private(set) var phase: DrivingSectionPhase = .loading
    public private(set) var connection: DrivingSectionConnection = .live
    public private(set) var projection: DrivingSectionProjection = .empty
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DrivingSectionSource
    @ObservationIgnored private let telemetry: any DrivingSectionTelemetry
    @ObservationIgnored private let copy: DrivingSectionCopy
    @ObservationIgnored private let localeIdentifier: String
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DrivingSectionSource,
        telemetry: any DrivingSectionTelemetry = OSLogDrivingSectionTelemetry(),
        copy: DrivingSectionCopy = DrivingSectionStrings.copy(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        localeIdentifier = locale.identifier
        self.timeZone = timeZone
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the whole section.
    public var accessibilitySummary: String {
        DrivingSectionAccessibility.sectionSummary(for: projection, localize: DrivingSectionStrings.string)
    }

    /// The chart-level VoiceOver summary.
    public var chartAccessibilitySummary: String {
        DrivingSectionAccessibility.chartSummary(for: projection, localize: DrivingSectionStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DrivingSectionSurface.slug)
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

    private func apply(_ update: DrivingSectionUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        projection = DrivingSectionProjector.project(
            data: update.data,
            copy: copy,
            localeIdentifier: localeIdentifier,
            timeZone: timeZone
        )
        phase = DrivingSectionProjector.resolvePhase(update.status, hasData: update.data != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached content on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: DrivingSectionConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryDrivingSectionSource: DrivingSectionSource {
    public var onUpdate: (@MainActor (DrivingSectionUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DrivingSectionUpdate?

    public init(initial: DrivingSectionUpdate? = nil) {
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
    public func push(_ update: DrivingSectionUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension DrivingSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        DrivingSectionSurface.slug
    }
}
