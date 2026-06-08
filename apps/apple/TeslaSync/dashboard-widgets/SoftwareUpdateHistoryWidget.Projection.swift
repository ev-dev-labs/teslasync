//
//  SoftwareUpdateHistoryWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0091 · SoftwareUpdateHistoryWidget (Apple)
//
//  The pure, SwiftUI-free adapter layer: the cached DTO the state holder pushes
//  (`SoftwareUpdate`) and the projection that turns the firmware-update history
//  into the view's render model — the event-feed rows (web `WidgetEventFeed`
//  items) and the compact "latest version" badge. This is a 1:1 port of the web
//  source's `STATUS_MAP`, the `feedItems` `useMemo`, the `CompactView` badge
//  logic, and `WidgetEventFeed`'s sort/slice + `formatRelativeTime`
//  (features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx +
//  shared/WidgetEventFeed.tsx). Kept free of SwiftUI so the adapter is
//  unit-testable without rendering.
//

import Foundation

// MARK: - Cached DTO input (port of the web `SoftwareUpdate`)

/// One firmware-update record — the native projection of a single web
/// `SoftwareUpdate` row (`@/types/vehicle-systems`). The three timestamp fields
/// are modeled as optional `Date`s; the projection resolves the display
/// timestamp with the same `installedAt ?? scheduledAt ?? createdAt` precedence
/// the web source uses.
public struct SoftwareUpdate: Sendable, Equatable, Identifiable {
    public let id: String
    public var version: String?
    public var status: SoftwareUpdateStatus
    public var installedAt: Date?
    public var scheduledAt: Date?
    public var createdAt: Date?

    public init(
        id: String,
        version: String? = nil,
        status: SoftwareUpdateStatus = .other(""),
        installedAt: Date? = nil,
        scheduledAt: Date? = nil,
        createdAt: Date? = nil
    ) {
        self.id = id
        self.version = version
        self.status = status
        self.installedAt = installedAt
        self.scheduledAt = scheduledAt
        self.createdAt = createdAt
    }
}

// MARK: - Status (port of the web status union + `STATUS_MAP`)

/// The firmware-update lifecycle status — the five web union members plus an
/// `other` escape hatch for forward-compatibility (the web does `STATUS_MAP[s]
/// ?? DEFAULT_STATUS`). The `symbol` / `tone` / `severity` mirror the web
/// `STATUS_MAP` entries exactly so the rows read identically across platforms;
/// the label resolves through the i18n facade.
public enum SoftwareUpdateStatus: Sendable, Equatable {
    case installed
    case installing
    case downloading
    case available
    case scheduled
    case other(String)

    /// Parses the wire string into a case, matching the web union members; any
    /// unrecognized value is retained verbatim as `.other` (web `?? DEFAULT`).
    public init(raw: String) {
        switch raw {
        case "installed": self = .installed
        case "installing": self = .installing
        case "downloading": self = .downloading
        case "available": self = .available
        case "scheduled": self = .scheduled
        default: self = .other(raw)
        }
    }

    /// The canonical wire value (round-trips `init(raw:)`).
    public var rawValue: String {
        switch self {
        case .installed: "installed"
        case .installing: "installing"
        case .downloading: "downloading"
        case .available: "available"
        case .scheduled: "scheduled"
        case let .other(value): value
        }
    }

    /// The i18n key for the status label.
    public var labelKey: String {
        switch self {
        case .other: "widget.softwareUpdateHistory.status.unknown"
        default: "widget.softwareUpdateHistory.status.\(rawValue)"
        }
    }

    /// The English fallback for the status label (proper-cased localization of
    /// the raw web enum the source renders verbatim).
    public var labelFallback: String {
        switch self {
        case .installed: "Installed"
        case .installing: "Installing"
        case .downloading: "Downloading"
        case .available: "Available"
        case .scheduled: "Scheduled"
        case let .other(value): value.isEmpty ? "Update" : value
        }
    }

    /// The SF Symbol for the row icon — the native counterpart of the web
    /// `STATUS_MAP` lucide glyph (CheckCircle2 / ArrowDownCircle / Download /
    /// Clock).
    public var symbol: String {
        switch self {
        case .installed: "checkmark.circle.fill"
        case .installing: "arrow.down.circle"
        case .downloading: "arrow.down.circle"
        case .available: "square.and.arrow.down"
        case .scheduled: "clock"
        case .other: "square.and.arrow.down"
        }
    }

    /// The dot/icon-box tone — the semantic mapping of the web `STATUS_MAP`
    /// hex colors (#22c55e green / #f59e0b amber / #3b82f6 blue / #6b7280 gray /
    /// #a78bfa purple) onto the design palette.
    public var tone: SoftwareUpdateTone {
        switch self {
        case .installed: .success
        case .installing: .warning
        case .downloading: .info
        case .available: .neutral
        case .scheduled: .scheduled
        case .other: .neutral
        }
    }

    /// The feed severity — port of the web `STATUS_MAP[...].severity`. Retained
    /// for fidelity (the web `TimelineItem` does not render it).
    public var severity: SoftwareUpdateSeverity {
        switch self {
        case .installing: .warning
        default: .info
        }
    }

    /// The compact-badge tone — port of the web `CompactView` variant ternary
    /// (`installed→success : installing→warning : info`).
    public var compactTone: SoftwareUpdateTone {
        switch self {
        case .installed: .success
        case .installing: .warning
        default: .info
        }
    }
}

/// The semantic tone an update row / badge carries. SwiftUI-free so the
/// projection stays renderer-agnostic; the view layer maps each case onto a
/// `Color.TS` token.
public enum SoftwareUpdateTone: Sendable, Equatable {
    case success
    case warning
    case info
    case neutral
    case scheduled
    case current
}

/// The feed severity (web `EventFeedItem['severity']`).
public enum SoftwareUpdateSeverity: Sendable, Equatable {
    case info
    case warning
    case critical
}

// MARK: - Render model (port of the web `EventFeedItem` + compact latest)

/// One event-feed row, already projected from a `SoftwareUpdate` — the native
/// `EventFeedItem`. Pre-formatted (`relativeTime`) so the row view is a pure
/// renderer and the formatting is unit-testable.
public struct SoftwareUpdateFeedItem: Sendable, Equatable, Identifiable {
    public let id: String
    public var title: String
    public var subtitle: String
    public var relativeTime: String
    public var symbol: String
    public var tone: SoftwareUpdateTone
    public var severity: SoftwareUpdateSeverity
    public var isCurrent: Bool
    public var timestamp: Date

    public init(
        id: String,
        title: String,
        subtitle: String,
        relativeTime: String,
        symbol: String,
        tone: SoftwareUpdateTone,
        severity: SoftwareUpdateSeverity,
        isCurrent: Bool,
        timestamp: Date
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.relativeTime = relativeTime
        self.symbol = symbol
        self.tone = tone
        self.severity = severity
        self.isCurrent = isCurrent
        self.timestamp = timestamp
    }
}

/// The compact (1-column) summary — the latest update's version + status badge
/// (web `CompactView`).
public struct SoftwareUpdateLatest: Sendable, Equatable {
    public var version: String
    public var statusLabel: String
    public var tone: SoftwareUpdateTone
    public var isInstalled: Bool

    public init(version: String, statusLabel: String, tone: SoftwareUpdateTone, isInstalled: Bool) {
        self.version = version
        self.statusLabel = statusLabel
        self.tone = tone
        self.isInstalled = isInstalled
    }
}

// MARK: - Projection (cached DTOs → render model)

/// Pure transforms from the cached `SoftwareUpdate` history to the render model.
/// The state holder calls these; the view never recomputes them.
public enum SoftwareUpdateProjection {
    /// The em-dash sentinel the web shows for a missing version (`upd.version ?? '—'`).
    static let dash = "—"

    /// The number of rows the full-size feed renders — the web
    /// `WidgetEventFeed maxItems={15}`.
    public static let maxItems = 15

    /// Projects the cached update history into the ordered event-feed rows: maps
    /// each record (marking `isCurrent` from the *original* order, exactly like
    /// the web `feedItems` `useMemo`), then sorts by resolved timestamp
    /// descending and slices to `limit` — the web `WidgetEventFeed` sort+slice.
    public static func feedItems(
        from updates: [SoftwareUpdate],
        limit: Int = maxItems,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent
    ) -> [SoftwareUpdateFeedItem] {
        let mapped = updates.enumerated().map { index, update -> SoftwareUpdateFeedItem in
            let isCurrent = index == 0 && update.status == .installed
            let timestamp = displayTimestamp(for: update)
            return SoftwareUpdateFeedItem(
                id: update.id,
                title: update.version ?? dash,
                subtitle: subtitle(for: update, isCurrent: isCurrent),
                relativeTime: SoftwareUpdateRelativeFormatter.string(for: timestamp, now: now, locale: locale),
                symbol: isCurrent ? "checkmark.circle.fill" : update.status.symbol,
                tone: isCurrent ? .current : update.status.tone,
                severity: update.status.severity,
                isCurrent: isCurrent,
                timestamp: timestamp
            )
        }
        return Array(
            mapped
                .sorted { $0.timestamp > $1.timestamp }
                .prefix(max(0, limit))
        )
    }

    /// The compact summary for the latest update (web `list[0]`), or `nil` when
    /// the history is empty.
    public static func latest(from updates: [SoftwareUpdate]) -> SoftwareUpdateLatest? {
        guard let first = updates.first else { return nil }
        let isInstalled = first.status == .installed
        return SoftwareUpdateLatest(
            version: first.version ?? dash,
            statusLabel: isInstalled
                ? SoftwareUpdateHistoryStrings.string("widget.updateCurrent", "Current")
                : SoftwareUpdateHistoryStrings.label(for: first.status),
            tone: first.status.compactTone,
            isInstalled: isInstalled
        )
    }

    /// The row subtitle: "Current" for the current install, else the localized
    /// status label (web `isCurrent ? t('widget.updateCurrent') : upd.status`).
    static func subtitle(for update: SoftwareUpdate, isCurrent: Bool) -> String {
        isCurrent
            ? SoftwareUpdateHistoryStrings.string("widget.updateCurrent", "Current")
            : SoftwareUpdateHistoryStrings.label(for: update.status)
    }

    /// Resolves the row timestamp with the web precedence
    /// `installedAt ?? scheduledAt ?? createdAt ?? epoch(0)`.
    static func displayTimestamp(for update: SoftwareUpdate) -> Date {
        update.installedAt ?? update.scheduledAt ?? update.createdAt ?? Date(timeIntervalSince1970: 0)
    }
}

// MARK: - Relative-time formatter (port of WidgetEventFeed.formatRelativeTime)

/// Relative-time phrasing for feed rows — a verbatim port of the web
/// `WidgetEventFeed.formatRelativeTime`: "Just now" (< 1m), "{m}m ago" (< 1h),
/// "{h}h ago" (< 24h), else a locale-formatted absolute date-time. The phrases
/// resolve through the i18n facade so no English literal ships.
public enum SoftwareUpdateRelativeFormatter {
    public static func string(
        for date: Date,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        let diffSeconds = now.timeIntervalSince(date)
        let diffMinutes = Int(diffSeconds / 60)
        if diffMinutes < 1 {
            return SoftwareUpdateHistoryStrings.string("widget.softwareUpdateHistory.relativeNow", "Just now")
        }
        if diffMinutes < 60 {
            return SoftwareUpdateHistoryStrings.count(
                "widget.softwareUpdateHistory.relativeMinutes",
                "%lldm ago",
                diffMinutes
            )
        }
        let diffHours = diffMinutes / 60
        if diffHours < 24 {
            return SoftwareUpdateHistoryStrings.count(
                "widget.softwareUpdateHistory.relativeHours",
                "%lldh ago",
                diffHours
            )
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
