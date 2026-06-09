//
//  BackupHistoryWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0008 · BackupHistoryWidget (Apple)
//
//  The pure, SwiftUI-free, Shared-free adapter layer: the cached DTO inputs the
//  state holder pushes (`BackupHistoryEvent` + the "site linked" flag) and the
//  projection that turns them into the view's render model — the outage events
//  list (timestamp + duration badge), the 30-day outage count, and the average
//  outage duration.
//
//  This is a 1:1 port of the web source's derived stats and `sortedItems`
//  `useMemo` in `features/dashboard/widgets/BackupHistoryWidget.tsx`, composed
//  with the `fmtDuration` helper, `fmtInt` (`lib/numberFormat`) and
//  `useDateFormat().formatDateTime` (`lib/dateFormat`) formatters it uses. Kept
//  free of SwiftUI + the KMP `Shared` framework so the adapter is unit-testable
//  on the host without rendering or the Kotlin/Native toolchain.
//

import Foundation

// MARK: - Cached DTO input (port of the web `TeslaBackupEvent`)

/// One Powerwall backup / power-outage record — the native projection of a
/// single web `TeslaBackupEvent` (`@/types/energy`). Only the three fields the
/// widget reads (`id`, `timestamp`, `duration_seconds`) are modeled; the
/// `period` / `fetched_at` bookkeeping is out of scope for this surface.
public struct BackupHistoryEvent: Sendable, Equatable, Identifiable {
    public let id: Int64
    public var timestamp: Date?
    public var durationSeconds: Double?

    public init(id: Int64, timestamp: Date? = nil, durationSeconds: Double? = nil) {
        self.id = id
        self.timestamp = timestamp
        self.durationSeconds = durationSeconds
    }
}

// MARK: - Format options (the user display preferences the projection bakes in)

/// The display preferences the projection bakes into its already-formatted
/// strings: the locale + timezone the event timestamps render in (the web
/// `useDateFormat()` `{ locale, tz }`). Defaults mirror the web test globals
/// (`en-US`, UTC) so previews and tests are deterministic; the production source
/// threads the live settings through.
public struct BackupHistoryFormatOptions: Sendable, Equatable {
    public var localeIdentifier: String
    public var timeZoneIdentifier: String

    public init(localeIdentifier: String = "en-US", timeZoneIdentifier: String = "UTC") {
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
    }

    var locale: Locale {
        Locale(identifier: localeIdentifier)
    }

    var timeZone: TimeZone {
        TimeZone(identifier: timeZoneIdentifier) ?? .gmt
    }
}

// MARK: - Formatters (ports of fmtDuration + fmtInt + formatDateTime)

/// Pure formatting mirroring the web `fmtDuration` (seconds → "2h 15m" / "45m" /
/// "30s"), `fmtInt` (`lib/numberFormat` — locale-grouped integer) and
/// `formatDateTime` (`lib/dateFormat` — "MMM d, yyyy, hh:mm a", em-dash for a
/// missing value). Ties round half away from zero to match the JS default.
public enum BackupHistoryFormat {
    /// The em-dash sentinel the web shows for a missing timestamp (`formatDateTime`
    /// returns `'—'` for a null/invalid value).
    static let dash = "—"

    /// Formats a duration in seconds — the web `fmtDuration`. Under a minute it
    /// reads in rounded seconds ("30s"); otherwise it floors to whole minutes and
    /// hours ("2h 15m" / "2h" / "45m").
    public static func duration(_ seconds: Double) -> String {
        let safe = seconds.isFinite ? max(0, seconds) : 0
        if safe < 60 {
            return "\(Int(safe.rounded()))s"
        }
        let mins = Int((safe / 60).rounded(.down))
        let hrs = mins / 60
        let remainMins = mins % 60
        if hrs > 0 {
            return remainMins > 0 ? "\(hrs)h \(remainMins)m" : "\(hrs)h"
        }
        return "\(mins)m"
    }

    /// Formats an integer count with locale grouping — the web `fmtInt`
    /// (`fmtNumber(v, 0)` → `toLocaleString` with zero fraction digits).
    public static func integer(_ value: Int, locale: Locale = Locale(identifier: "en-US")) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.maximumFractionDigits = 0
        formatter.minimumFractionDigits = 0
        formatter.usesGroupingSeparator = true
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Formats an event timestamp — the web `formatDateTime` with
    /// `{ year:'numeric', month:'short', day:'numeric', hour:'2-digit',
    /// minute:'2-digit' }` ("Apr 4, 2026, 03:45 PM"). A missing date reads as the
    /// em-dash sentinel.
    public static func dateTime(_ date: Date?, options: BackupHistoryFormatOptions) -> String {
        guard let date else { return dash }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = options.locale
        formatter.timeZone = options.timeZone
        formatter.dateFormat = "MMM d, yyyy, hh:mm a"
        return formatter.string(from: date)
    }
}

// MARK: - Rendered event row (port of the web event list item)

/// One row of the outage list — already formatted for display (`timeText` =
/// "Apr 4, 2026, 03:45 PM", `durationText` = "2h 15m"). The view performs no
/// formatting, only layout.
public struct BackupHistoryRow: Sendable, Equatable, Identifiable {
    public let id: Int64
    public var timeText: String
    public var durationText: String

    public init(id: Int64, timeText: String, durationText: String) {
        self.id = id
        self.timeText = timeText
        self.durationText = durationText
    }
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-computed render model the view switches over. Every value is
/// already formatted into display strings so the SwiftUI layer performs no math
/// or formatting. Stats (`totalOutages`, `avgDurationText`) are computed over the
/// full 30-day set — the web `items.length` / mean — while `rows` carries the
/// newest-first list the view caps per layout (compact 3 / standard 10). This is
/// the output the adapter tests assert for parity with the web computation.
public struct BackupHistoryProjection: Sendable, Equatable {
    public var rows: [BackupHistoryRow]
    public var totalOutages: Int
    public var totalOutagesText: String
    public var avgDurationText: String
    public var siteLinked: Bool

    public init(
        rows: [BackupHistoryRow],
        totalOutages: Int,
        totalOutagesText: String,
        avgDurationText: String,
        siteLinked: Bool
    ) {
        self.rows = rows
        self.totalOutages = totalOutages
        self.totalOutagesText = totalOutagesText
        self.avgDurationText = avgDurationText
        self.siteLinked = siteLinked
    }

    /// Whether there is at least one outage event to show — the web
    /// `items.length === 0 ? <EmptyState/> : …` switch.
    public var hasEvents: Bool {
        !rows.isEmpty
    }

    /// The newest-first rows capped to the layout's visible maximum — the web
    /// `sortedItems.slice(0, maxEvents)` (compact 3 / standard 10).
    public func displayedRows(max maxEvents: Int) -> [BackupHistoryRow] {
        Array(rows.prefix(max(0, maxEvents)))
    }
}

// MARK: - Adapter (cached DTOs → projection)

/// Pure transforms from the cached DTOs to the render model. The state holder
/// calls these; the view never recomputes them.
public enum BackupHistoryAdapter {
    /// The visible-row cap for the compact (1-column) layout — the web
    /// `isCompact ? 3 : 10`.
    public static let compactMaxEvents = 3

    /// The visible-row cap for the standard layout — the web `isCompact ? 3 : 10`.
    public static let standardMaxEvents = 10

    /// Projects the cached events + "site linked" flag into the render model: the
    /// newest-first formatted rows (web sort by timestamp descending), the 30-day
    /// outage count (`items.length`), and the average outage duration (mean of
    /// `duration_seconds`, `0` when empty).
    public static func project(
        events: [BackupHistoryEvent],
        siteLinked: Bool,
        options: BackupHistoryFormatOptions = BackupHistoryFormatOptions()
    ) -> BackupHistoryProjection {
        let sorted = events.sorted { ($0.timestamp ?? .distantPast) > ($1.timestamp ?? .distantPast) }

        let rows = sorted.map { event in
            BackupHistoryRow(
                id: event.id,
                timeText: BackupHistoryFormat.dateTime(event.timestamp, options: options),
                durationText: BackupHistoryFormat.duration(event.durationSeconds ?? 0)
            )
        }

        let totalOutages = events.count
        let avgDurationSec: Double = events.isEmpty
            ? 0
            : events.reduce(0) { $0 + ($1.durationSeconds ?? 0) } / Double(events.count)

        return BackupHistoryProjection(
            rows: rows,
            totalOutages: totalOutages,
            totalOutagesText: BackupHistoryFormat.integer(totalOutages, locale: options.locale),
            avgDurationText: BackupHistoryFormat.duration(avgDurationSec),
            siteLinked: siteLinked
        )
    }
}
