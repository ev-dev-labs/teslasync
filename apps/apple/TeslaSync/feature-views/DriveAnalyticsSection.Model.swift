//
//  DriveAnalyticsSection.Model.swift
//  TeslaSync — P4 feature view · 0166 · DriveAnalyticsSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  driving-dynamics "Drive Analytics" section. The view binds through `DriveAnalyticsSectionModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx.
//
//  The web component is presentational — its parent owns `filteredDrives`, the `startDate` / `endDate`
//  window, the unit converters, and the load lifecycle. The native surface reproduces that whole
//  lifecycle through a `DriveAnalyticsSectionSource` so every prompt-required state (loading / empty /
//  error / stale / offline / content) renders here, and routes the header range-picker changes back to
//  the source the way the web calls `onStartDateChange` / `onEndDateChange`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated and redacted there.
public protocol DriveAnalyticsSectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogDriveAnalyticsSectionTelemetry: DriveAnalyticsSectionTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "DriveAnalyticsSection" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; the per-surface table keeps each parallel surface prompt self-contained.
public enum DriveAnalyticsSectionStrings {
    public static let table = "DriveAnalyticsSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog (the kW glyph + em-dash
    /// the web embeds inline).
    public static func copy() -> DriveAnalyticsSectionCopy {
        DriveAnalyticsSectionCopy(
            kilowattUnit: string("dynamics.kwUnit", "kW"),
            emDash: string("dynamics.emDash", "—")
        )
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `DriveAnalyticsSectionSource`: the resolved payload + its load
/// status, the live-state connection, the in-flight flag, and the last-update timestamp.
public struct DriveAnalyticsSectionUpdate: Sendable, Equatable {
    public var status: DriveAnalyticsSectionLoadStatus
    public var data: DriveAnalyticsSectionData?
    public var connection: DriveAnalyticsSectionConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: DriveAnalyticsSectionLoadStatus = .loading,
        data: DriveAnalyticsSectionData? = nil,
        connection: DriveAnalyticsSectionConnection = .live,
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
/// holders — running the drives query for the selected window and projecting it into the section's
/// chart payload. Previews + tests use `InMemoryDriveAnalyticsSectionSource`. The view never talks to
/// the network directly.
@MainActor
public protocol DriveAnalyticsSectionSource: AnyObject {
    var onUpdate: (@MainActor (DriveAnalyticsSectionUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
    /// Re-runs the query for a new window (web `onStartDateChange` / `onEndDateChange`).
    func setRange(start: Date, end: Date)
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `DriveAnalyticsSectionSource`, projects each
/// snapshot into the three chart series, exposes a render `DriveAnalyticsSectionPhase` + freshness +
/// the selected window for SwiftUI to bind, and emits the `view.opened` diagnostics event once on first
/// appearance.
@MainActor
@Observable
public final class DriveAnalyticsSectionModel {
    public private(set) var phase: DriveAnalyticsSectionPhase = .loading
    public private(set) var connection: DriveAnalyticsSectionConnection = .live
    public private(set) var projection: DriveAnalyticsSectionProjection = .empty
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var rangeStart: Date
    public private(set) var rangeEnd: Date

    @ObservationIgnored private let source: any DriveAnalyticsSectionSource
    @ObservationIgnored private let telemetry: any DriveAnalyticsSectionTelemetry
    @ObservationIgnored private let copy: DriveAnalyticsSectionCopy
    @ObservationIgnored private let localeIdentifier: String
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DriveAnalyticsSectionSource,
        telemetry: any DriveAnalyticsSectionTelemetry = OSLogDriveAnalyticsSectionTelemetry(),
        copy: DriveAnalyticsSectionCopy = DriveAnalyticsSectionStrings.copy(),
        locale: Locale = .current,
        timeZone: TimeZone = .current,
        initialRange: ClosedRange<Date>? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        localeIdentifier = locale.identifier
        self.timeZone = timeZone
        let window = initialRange ?? Self.defaultRange(now: Date(), calendar: Calendar(identifier: .gregorian))
        rangeStart = window.lowerBound
        rangeEnd = window.upperBound
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the whole section.
    public var accessibilitySummary: String {
        DriveAnalyticsSectionAccessibility.sectionSummary(
            for: projection,
            localize: DriveAnalyticsSectionStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DriveAnalyticsSectionSurface.slug)
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

    /// Applies a new date window (web `onStartDateChange` / `onEndDateChange`): reflects it optimistically
    /// for the picker and re-runs the query through the source.
    public func setRange(start: Date, end: Date) {
        rangeStart = start
        rangeEnd = end
        source.setRange(start: start, end: end)
    }

    private func apply(_ update: DriveAnalyticsSectionUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        if let data = update.data {
            rangeStart = data.rangeStart
            rangeEnd = data.rangeEnd
        }
        projection = DriveAnalyticsSectionProjector.project(
            data: update.data,
            copy: copy,
            localeIdentifier: localeIdentifier,
            timeZone: timeZone
        )
        phase = DriveAnalyticsSectionProjector.resolvePhase(
            update.status,
            hasDrives: !(update.data?.drives.isEmpty ?? true)
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached content on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: DriveAnalyticsSectionConnection) {
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

    /// The default 30-day window ending today, used until the source delivers the resolved window.
    private static func defaultRange(now: Date, calendar: Calendar) -> ClosedRange<Date> {
        let start = calendar.date(byAdding: .day, value: -30, to: now) ?? now
        return start ... now
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets
/// a test push further snapshots via `push(_:)`, while recording the start / stop / refresh / setRange
/// calls so the wiring can be asserted.
@MainActor
public final class InMemoryDriveAnalyticsSectionSource: DriveAnalyticsSectionSource {
    public var onUpdate: (@MainActor (DriveAnalyticsSectionUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var lastRange: ClosedRange<Date>?

    private let initial: DriveAnalyticsSectionUpdate?

    public init(initial: DriveAnalyticsSectionUpdate? = nil) {
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

    public func setRange(start: Date, end: Date) {
        lastRange = start ... end
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: DriveAnalyticsSectionUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension DriveAnalyticsSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        DriveAnalyticsSectionSurface.slug
    }
}
