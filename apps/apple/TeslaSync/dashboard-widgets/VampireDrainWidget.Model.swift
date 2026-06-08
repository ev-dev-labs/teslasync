//
//  VampireDrainWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0105 · VampireDrainWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility/number composition. The dashboard registry types
//  (DashboardWidgetSize / DashboardWidgetRegistration) are shared across surfaces
//  and declared once by the DigitalTwinWidget sibling — reused here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol VampireDrainTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogVampireDrainTelemetry: VampireDrainTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from `Resource<T>`.
public enum VampireDrainLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum VampireDrainConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `VampireDrainSource`: the cached stats +
/// event rows plus their load/connection status. The model turns this into the
/// render phase + projections.
public struct VampireDrainUpdate: Sendable, Equatable {
    public var status: VampireDrainLoadStatus
    public var connection: VampireDrainConnection
    public var stats: VampireDrainStatsInput?
    public var events: [VampireDrainEventInput]
    public var updatedAt: Date?

    public init(
        status: VampireDrainLoadStatus = .loading,
        connection: VampireDrainConnection = .live,
        stats: VampireDrainStatsInput? = nil,
        events: [VampireDrainEventInput] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.stats = stats
        self.events = events
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the energy `StateHolderModel<…>` fed by
/// `useVampireDrainStats` + `useVampireDrainEvents` + `useVehicles`); previews and
/// tests use `InMemoryVampireDrainSource`. The view never talks to the network.
@MainActor
public protocol VampireDrainSource: AnyObject {
    var onUpdate: (@MainActor (VampireDrainUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `VampireDrainSource`,
/// projects rows via `VampireDrainBuilder`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class VampireDrainModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: VampireDrainConnection = .live
    public private(set) var stats: VampireDrainStatsInput?
    public private(set) var events: [VampireDrainEventInput] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any VampireDrainSource
    @ObservationIgnored private let telemetry: any VampireDrainTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any VampireDrainSource,
        telemetry: any VampireDrainTelemetry = OSLogVampireDrainTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VampireDrainWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached data stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    /// The headline average drain in %/day (web `avgDrainPctPerDay`).
    public var avgDrainPerDay: Double {
        VampireDrainBuilder.avgDrainPerDay(stats)
    }

    /// Every cached event projected to a feed item, in input order (web `eventItems`).
    public var eventItems: [VampireDrainEventItem] {
        VampireDrainBuilder.makeEvents(from: events)
    }

    /// The newest-first, capped (5) rows the feed renders (web `WidgetEventFeed`).
    public var feedItems: [VampireDrainEventItem] {
        VampireDrainBuilder.feedEvents(from: eventItems)
    }

    /// The per-day sparkline series (web `sparklineData`).
    public var sparkline: [Double] {
        VampireDrainBuilder.sparklineData(from: events)
    }

    /// Whether any data is present (web `hasData = stats != null || events.length > 0`).
    public var hasData: Bool {
        stats != nil || !events.isEmpty
    }

    private func apply(_ update: VampireDrainUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        stats = update.stats
        events = update.events
        phase = Self.resolvePhase(status: update.status, hasData: hasData)
    }

    /// Resolves the render phase. Like the web shell, the skeleton only shows on
    /// the initial fetch and the empty copy only when there is no data; once any
    /// data is cached it stays visible behind refresh/errors.
    static func resolvePhase(status: VampireDrainLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryVampireDrainSource: VampireDrainSource {
    public var onUpdate: (@MainActor (VampireDrainUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VampireDrainUpdate?

    public init(initial: VampireDrainUpdate? = nil) {
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
    public func push(_ update: VampireDrainUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "VampireDrainWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum VampireDrainStrings {
    public static let table = "VampireDrainWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// `"{value}%/day"` — the stat-card value + feed subtitle (web percent-per-day
    /// string). One composer for both web code paths, which render identically.
    public static func percentPerDay(_ value: Double) -> String {
        let percent = VampireDrainNumberFormat.decimal(value, fractionDigits: 1)
        return percent + "%" + string("widget.vampireDrain.perDay", "/day")
    }

    /// The localized duration string (web `formatDuration`): whole minutes + "m",
    /// or one-decimal hours + "h".
    public static func durationLabel(_ duration: DrainDuration) -> String {
        switch duration {
        case let .minutes(value):
            VampireDrainNumberFormat.decimal(value, fractionDigits: 0)
                + string("widget.vampireDrain.min", "m")
        case let .hours(value):
            VampireDrainNumberFormat.decimal(value, fractionDigits: 1)
                + string("widget.vampireDrain.hr", "h")
        }
    }

    /// One feed row's title (web `${battery}% · ${duration}${sentry ? ' · Sentry' : ''}`).
    public static func eventTitle(_ item: VampireDrainEventItem) -> String {
        let battery = VampireDrainNumberFormat.decimal(item.batteryLostPct, fractionDigits: 1)
        var title = "\(battery)% · \(durationLabel(item.duration))"
        if item.sentryMode {
            title += " · " + string("widget.vampireDrain.sentry", "Sentry")
        }
        return title
    }

    /// The stat-card sublabel (web `'{{count}} events · {{hours}}h total'`).
    public static func eventCountSublabel(count: Int, totalHours: Double) -> String {
        let hours = VampireDrainNumberFormat.decimal(totalHours, fractionDigits: 0)
        let format = string("widget.vampireDrain.eventCount", "%1$lld events · %2$@h total")
        return String(format: format, count, hours)
    }

    /// Localizes a relative-time bucket (web `formatRelativeTime` strings). Shared
    /// by the feed row and the VoiceOver label so the copy lives in one place.
    public static func relativeTimeLabel(_ bucket: DrainRelativeTime) -> String {
        switch bucket {
        case .justNow:
            string("widget.vampireDrain.justNow", "Just now")
        case let .minutes(value):
            String(format: string("widget.vampireDrain.minutesAgo", "%lldm ago"), value)
        case let .hours(value):
            String(format: string("widget.vampireDrain.hoursAgo", "%lldh ago"), value)
        case let .absolute(date):
            absoluteFormatter.string(from: date)
        }
    }

    private nonisolated(unsafe) static let absoluteFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver labels for the surface. Pure + public so the a11y content
/// can be unit-tested without rendering the view.
public enum VampireDrainAccessibility {
    /// The headline stat's spoken label (web StatCard label + value + sublabel).
    public static func statLabel(avgPerDay: Double, stats: VampireDrainStatsInput?) -> String {
        var parts = [
            VampireDrainStrings.string("widget.vampireDrain.avgDrain", "Avg Drain"),
            VampireDrainStrings.percentPerDay(avgPerDay)
        ]
        if let stats {
            parts.append(VampireDrainStrings.eventCountSublabel(
                count: stats.eventCount ?? 0,
                totalHours: stats.totalHours ?? 0
            ))
        }
        return parts.joined(separator: ". ")
    }

    /// One feed row's spoken label: the drain title, the per-day rate, the relative time.
    public static func rowLabel(for item: VampireDrainEventItem, now: Date = Date()) -> String {
        let parts = [
            VampireDrainStrings.eventTitle(item),
            VampireDrainStrings.percentPerDay(item.drainPerDay),
            VampireDrainStrings.relativeTimeLabel(VampireDrainBuilder.relativeTime(for: item.timestamp, now: now))
        ]
        return parts.joined(separator: ". ")
    }
}
