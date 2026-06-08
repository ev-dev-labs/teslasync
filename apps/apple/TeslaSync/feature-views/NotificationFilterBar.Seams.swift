//
//  NotificationFilterBar.Seams.swift
//  TeslaSync — P4 feature view · 0189 · NotificationFilterBar (Apple)
//
//  The dependency seams the NotificationFilterBar view-model binds through, kept apart
//  from the model for the lint length budget: the P1/S11 telemetry contract, the P1/S10
//  i18n facade (web `useTranslation`), the change sink (web `onChange`), the coalesced
//  source snapshot, the P1/S8 source protocol, the in-memory source for previews/tests,
//  and the VoiceOver summary builder. Foundation + OSLog only (no SwiftUI / no network).
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted.
public protocol NotificationFilterTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogNotificationFilterTelemetry: NotificationFilterTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views
/// hold no hardcoded literals. Keys live in the "NotificationFilterBar" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; kept per-surface
/// so each parallel prompt owns its own strings.
public enum NotificationFilterStrings {
    public static let table = "NotificationFilterBar"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Change sink (web `onChange`)

/// Receives each merged filter patch the bar produces (web `onChange(next)`), so the
/// host inbox can adopt it. The production app injects a sink that writes into its
/// notifications query state; the default logs the change so the view stays I/O-free.
public protocol NotificationFilterChangeSink: Sendable {
    func filtersChanged(_ filters: NotificationFilters)
}

/// `os.Logger`-backed default that records each filter change for diagnostics.
public struct OSLogNotificationFilterChangeSink: NotificationFilterChangeSink {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "notifications-filter")
    }

    public func filtersChanged(_ filters: NotificationFilters) {
        let summary = "sev=\(filters.severity.count)"
            + " veh=\(filters.selectedVehicleID ?? -1)"
            + " rule=\(filters.selectedRuleID ?? -1)"
        logger.debug("notifications.filter.changed \(summary, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `NotificationFilterSource`: the parent's current
/// filters (web controlled prop), the selectable vehicle + rule options, the option
/// load status, the live-state freshness, the in-flight flag, and the last update time.
public struct NotificationFilterUpdate: Sendable, Equatable {
    public var status: NotificationFilterLoadStatus
    public var filters: NotificationFilters
    public var vehicles: [NotificationVehicleOption]
    public var rules: [NotificationRuleOption]
    public var connection: NotificationFilterConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: NotificationFilterLoadStatus = .loading,
        filters: NotificationFilters = NotificationFilters(),
        vehicles: [NotificationVehicleOption] = [],
        rules: [NotificationRuleOption] = [],
        connection: NotificationFilterConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.filters = filters
        self.vehicles = vehicles
        self.rules = rules
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// notifications state holder (vehicles + alert rules + the inbox filter state);
/// previews/tests use `InMemoryNotificationFilterSource`. The view never talks to the
/// network directly.
@MainActor
public protocol NotificationFilterSource: AnyObject {
    var onUpdate: (@MainActor (NotificationFilterUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying option queries (web parent refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryNotificationFilterSource: NotificationFilterSource {
    public var onUpdate: (@MainActor (NotificationFilterUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: NotificationFilterUpdate?

    public init(initial: NotificationFilterUpdate? = nil) {
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
    public func push(_ update: NotificationFilterUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the surface's VoiceOver summary. Copy resolves through an injected localizer
/// so the summary is testable without a bundle, exactly like the views' P1/S10 facade.
public enum NotificationFilterAccessibility {
    /// The filter-bar summary: the title plus how many filters are currently active.
    public static func summary(activeCount: Int, localize: (String, String) -> String) -> String {
        let title = localize("notifications.inbox.filter.title", "Notification filters")
        guard activeCount > 0 else {
            let none = localize("notifications.inbox.filter.noneActive", "no filters active")
            return "\(title): \(none)"
        }
        let template = localize("notifications.inbox.filter.activeCount", "{{count}} active")
        let detail = template.replacingOccurrences(of: "{{count}}", with: "\(activeCount)")
        return "\(title): \(detail)"
    }
}
