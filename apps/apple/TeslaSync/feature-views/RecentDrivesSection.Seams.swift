//
//  RecentDrivesSection.Seams.swift
//  TeslaSync — P4 feature view · 0297 · RecentDrivesSection (Apple)
//
//  The dependency seams the RecentDrivesSection view-model binds through, kept apart from the
//  model for the lint length budget: the P1/S11 telemetry contract, the date-formatting facade
//  (web `formatDateTime`), the navigation seam (web `<Link to="/drives">`), the coalesced
//  source snapshot, the P1/S8 source protocol, the in-memory source for previews/tests, the
//  P1/S10 i18n facade (web `useTranslation`), and the VoiceOver string builder.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol RecentDrivesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogRecentDrivesTelemetry: RecentDrivesTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Date-formatting facade (web `formatDateTime`)

/// Formats the Date column timestamps (web `formatDateTime(start_ts)` → "Apr 4, 2026, 2:30 AM").
/// Production injects a settings-backed implementation (locale + timezone + 12/24h from
/// `useSettings`); previews/tests use `DefaultRecentDrivesDateFormatting`.
public protocol RecentDrivesDateFormatting: Sendable {
    func dateTime(_ date: Date) -> String
}

/// Bundle-free default matching the web `formatDateTime` field set (`month: 'short',
/// day: 'numeric', year: 'numeric', hour/minute`). Stateless + `Sendable`.
public struct DefaultRecentDrivesDateFormatting: RecentDrivesDateFormatting {
    private let localeIdentifier: String

    public init(localeIdentifier: String = "en_US") {
        self.localeIdentifier = localeIdentifier
    }

    public func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.dateFormat = "MMM d, yyyy, h:mm a"
        return formatter.string(from: date)
    }
}

// MARK: - Navigation seam (web `<Link to="/drives">`)

/// The "View all" navigation intent (web `<Link to="/drives">`). Keeps routing out of the
/// view; the production app injects an adapter that pushes the drives route, previews/tests use
/// the logging / recording defaults.
public protocol RecentDrivesNavigator: Sendable {
    func openAllDrives()
}

/// `os.Logger`-backed default that records the navigation intent without routing, so previews
/// render the link safely.
public struct OSLogRecentDrivesNavigator: RecentDrivesNavigator {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "navigation")
    }

    public func openAllDrives() {
        logger.info("navigate route=/drives source=\(RecentDrivesSurface.slug, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `RecentDrivesSource`: the load status, the resolved rows,
/// the display preferences, the live-state freshness, and the in-flight flag.
public struct RecentDrivesUpdate: Sendable, Equatable {
    public var status: RecentDrivesLoadStatus
    public var items: [RecentDriveItem]
    public var formatting: RecentDrivesFormatting
    public var connection: RecentDrivesConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: RecentDrivesLoadStatus = .loading,
        items: [RecentDriveItem] = [],
        formatting: RecentDrivesFormatting = RecentDrivesFormatting(),
        connection: RecentDrivesConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.items = items
        self.formatting = formatting
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state
/// holders — composing the drives query (web `useDrives` / the parent's `drives` prop) with the
/// unit-preference holder (web `useUnits`) plus a refresh affordance. Previews/tests use
/// `InMemoryRecentDrivesSource`. The view never talks to the network directly.
@MainActor
public protocol RecentDrivesSource: AnyObject {
    var onUpdate: (@MainActor (RecentDrivesUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryRecentDrivesSource: RecentDrivesSource {
    public var onUpdate: (@MainActor (RecentDrivesUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RecentDrivesUpdate?

    public init(initial: RecentDrivesUpdate? = nil) {
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
    public func push(_ update: RecentDrivesUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "RecentDrivesSection" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings.
public enum RecentDrivesStrings {
    public static let table = "RecentDrivesSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a templated string, substituting positional arguments (web i18next `{{name}}`).
    public static func format(_ key: String, _ fallback: String, _ args: [String]) -> String {
        var result = string(key, fallback)
        for (index, value) in args.enumerated() {
            result = result.replacingOccurrences(of: "{{\(index)}}", with: value)
        }
        return result
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum RecentDrivesAccessibility {
    /// The section header summary: title + drive count.
    public static func sectionSummary(count: Int, localize: (String, String) -> String) -> String {
        let title = localize("common.recentDrives", "Recent Drives")
        return "\(title): \(count)"
    }

    /// One row's VoiceOver label: each column label paired with its cell value, resolved through
    /// the same localizer the header renders with, so the row reads as a sentence.
    public static func rowLabel(_ display: RecentDriveDisplay, localize: (String, String) -> String) -> String {
        let parts = [
            "\(localize("common.date", "Date")): \(display.date)",
            "\(localize("common.distance", "Distance")): \(display.distance)",
            "\(localize("common.duration", "Duration")): \(display.duration)",
            "\(localize("common.battery", "Battery")): \(display.battery)"
        ]
        return parts.joined(separator: ", ")
    }
}
