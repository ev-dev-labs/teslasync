//
//  QuietHoursPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  The testable projection core for the quiet-hours / Do-Not-Disturb surface — the
//  faithful port of features/settings/components/QuietHoursPanel.tsx. Everything here is
//  pure and dependency-free (Foundation only) so it can be unit-tested without a bundle
//  or a rendered view.
//
//  Web parity notes:
//    • The web panel CRUDs `/notifications/quiet-hours` rows. Each row is a local-time
//      window (HH:MM start + end + IANA timezone), a 7-bit weekday mask (Sun=1<<0 …
//      Sat=1<<6), and a bypass-severity allow-list that escapes the gate.
//    • The web has three content branches — loading (Spinner), empty (`<EmptyState>`),
//      and the row list — with the add/edit form rendered beneath whenever a draft is
//      open. `QuietHoursProjection.resolvePhase` reproduces that, widened with the
//      prompt-required error envelope so a first-load failure is never a blank panel.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the
/// dependency-free core so the projection's unit tests can reach it.
public enum QuietHoursSurface {
    public static let slug = "QuietHoursPanel"
}

// MARK: - Render phase / load status / freshness

/// What the surface should render at the top level. The web splits
/// loading / empty / list; the error envelope is added so a first-load failure with no
/// cached rows never renders a blank panel.
public enum QuietHoursPhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case content
}

/// The bound source's load status for the quiet-hours query (web `isLoading` / resolved
/// / failure).
public enum QuietHoursLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so a cached list is clearly labeled while reconnecting / offline.
public enum QuietHoursConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Severity catalog (web `SEVERITY_CHOICES`)

/// One bypass-severity choice — the native mirror of a web `SEVERITY_CHOICES` entry.
/// The order (critical → warn → info) and the i18n keys/fallbacks are preserved
/// verbatim. The raw `value` is the wire token the backend stores.
public enum QuietHoursSeverity: String, Sendable, Equatable, CaseIterable, Identifiable {
    case critical
    case warn
    case info

    public var id: String {
        rawValue
    }

    /// The P1/S10 key for this severity's display label (web `labelKey`).
    public var labelKey: String {
        switch self {
        case .critical: "quietHours.severity.critical"
        case .warn: "quietHours.severity.warn"
        case .info: "quietHours.severity.info"
        }
    }

    /// The web English fallback for this severity's display label (web `fallback`).
    public var labelFallback: String {
        switch self {
        case .critical: "Critical"
        case .warn: "Warning"
        case .info: "Info"
        }
    }

    /// Resolves a raw wire token to its localized label, falling back to the token
    /// itself for an unknown severity (web rows render the raw `s`).
    public static func label(forToken token: String, localize: (String, String) -> String) -> String {
        guard let known = QuietHoursSeverity(rawValue: token) else { return token }
        return localize(known.labelKey, known.labelFallback)
    }
}

/// The default bypass allow-list a fresh draft seeds with (web `DEFAULT_BYPASS`).
public enum QuietHoursDefaults {
    public static let bypass: [String] = [QuietHoursSeverity.critical.rawValue]
}

// MARK: - Weekday catalog (web `WEEKDAYS`)

/// One weekday in the mask — the native mirror of a web `WEEKDAYS` entry. `bit` is the
/// Sun=1<<0 … Sat=1<<6 position that matches `models.QuietHoursWeekday*` server-side.
public struct QuietHoursWeekday: Sendable, Equatable, Identifiable {
    public let bit: Int
    public let key: String
    public let fallback: String

    public var id: Int {
        bit
    }

    public init(bit: Int, key: String, fallback: String) {
        self.bit = bit
        self.key = key
        self.fallback = fallback
    }
}

/// The weekday mask helpers + the ordered Sun→Sat catalog (web `WEEKDAYS` / `ALL_WEEKDAYS`).
public enum QuietHoursWeekdays {
    /// Every weekday selected (web `ALL_WEEKDAYS = 127`).
    public static let all = 127

    /// The ordered Sun→Sat catalog the row + form iterate (web `WEEKDAYS`).
    public static let ordered: [QuietHoursWeekday] = [
        QuietHoursWeekday(bit: 1 << 0, key: "quietHours.weekday.sun", fallback: "Sun"),
        QuietHoursWeekday(bit: 1 << 1, key: "quietHours.weekday.mon", fallback: "Mon"),
        QuietHoursWeekday(bit: 1 << 2, key: "quietHours.weekday.tue", fallback: "Tue"),
        QuietHoursWeekday(bit: 1 << 3, key: "quietHours.weekday.wed", fallback: "Wed"),
        QuietHoursWeekday(bit: 1 << 4, key: "quietHours.weekday.thu", fallback: "Thu"),
        QuietHoursWeekday(bit: 1 << 5, key: "quietHours.weekday.fri", fallback: "Fri"),
        QuietHoursWeekday(bit: 1 << 6, key: "quietHours.weekday.sat", fallback: "Sat")
    ]

    /// Whether a given weekday bit is set in the mask.
    public static func isOn(_ mask: Int, bit: Int) -> Bool {
        (mask & bit) != 0
    }

    /// Toggles a weekday bit in the mask (web `weekdays ^ bit`).
    public static func toggled(_ mask: Int, bit: Int) -> Int {
        mask ^ bit
    }
}

// MARK: - Display-ready window (web `QuietHoursWindow`)

/// One quiet-hours window — the native parity of the web `QuietHoursWindow` row
/// (id, enabled, HH:MM start/end, IANA timezone, weekday mask, bypass list).
public struct QuietHoursWindowItem: Sendable, Equatable, Identifiable {
    public let id: Int
    public let enabled: Bool
    public let startLocal: String
    public let endLocal: String
    public let timezone: String
    public let weekdays: Int
    public let bypassSeverities: [String]

    public init(
        id: Int,
        enabled: Bool,
        startLocal: String,
        endLocal: String,
        timezone: String,
        weekdays: Int,
        bypassSeverities: [String]
    ) {
        self.id = id
        self.enabled = enabled
        self.startLocal = startLocal
        self.endLocal = endLocal
        self.timezone = timezone
        self.weekdays = weekdays
        self.bypassSeverities = bypassSeverities
    }

    /// The "23:00 → 07:00 (Europe/London)" summary (web `summarizeWindow`).
    public var summary: String {
        "\(startLocal) → \(endLocal) (\(timezone))"
    }
}

// MARK: - Editable draft (web `DraftWindow`)

/// The in-memory add/edit form — the native mirror of the web `DraftWindow`. A non-nil
/// `id` marks an edit (web `editingId`); the wire (snake_case) shape is preserved.
public struct QuietHoursDraft: Sendable, Equatable {
    public var id: Int?
    public var enabled: Bool
    public var startLocal: String
    public var endLocal: String
    public var timezone: String
    public var weekdays: Int
    public var bypassSeverities: [String]

    public init(
        id: Int? = nil,
        enabled: Bool = true,
        startLocal: String = "23:00",
        endLocal: String = "07:00",
        timezone: String = "UTC",
        weekdays: Int = QuietHoursWeekdays.all,
        bypassSeverities: [String] = QuietHoursDefaults.bypass
    ) {
        self.id = id
        self.enabled = enabled
        self.startLocal = startLocal
        self.endLocal = endLocal
        self.timezone = timezone
        self.weekdays = weekdays
        self.bypassSeverities = bypassSeverities
    }

    /// A fresh "New window" draft seeded with the resolved local timezone (web
    /// `makeDraft()` with `Intl…resolvedOptions().timeZone`).
    public static func makeNew(defaultTimezone: String) -> QuietHoursDraft {
        QuietHoursDraft(
            timezone: defaultTimezone.isEmpty ? "UTC" : defaultTimezone,
            weekdays: QuietHoursWeekdays.all,
            bypassSeverities: QuietHoursDefaults.bypass
        )
    }

    /// An "Edit window" draft copied from an existing row (web `makeDraft(initial)`).
    public static func makeEditing(from item: QuietHoursWindowItem) -> QuietHoursDraft {
        QuietHoursDraft(
            id: item.id,
            enabled: item.enabled,
            startLocal: item.startLocal,
            endLocal: item.endLocal,
            timezone: item.timezone,
            weekdays: item.weekdays,
            bypassSeverities: item.bypassSeverities
        )
    }

    /// Whether a given bypass severity token is currently allowed through.
    public func allows(_ token: String) -> Bool {
        bypassSeverities.contains(token)
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution from the bound source's load status + row count +
/// whether a draft form is open to the top-level render phase.
public enum QuietHoursProjection {
    /// Resolves the render phase. Loading shows only before the first rows arrive; a
    /// resolved-empty list with no open draft shows the empty state; a failure with no
    /// cached rows and no draft shows the error state — while cached rows or an open
    /// draft keep the content branch (web renders the `<ul>` + form together), the
    /// freshness shown by the banner and the failure surfaced inline.
    public static func resolvePhase(
        status: QuietHoursLoadStatus,
        windowCount: Int,
        hasDraft: Bool
    ) -> QuietHoursPhase {
        let hasBody = windowCount > 0 || hasDraft
        switch status {
        case .loading:
            return hasBody ? .content : .loading
        case .loaded:
            return hasBody ? .content : .empty
        case let .failed(message):
            return hasBody ? .content : .error(message)
        }
    }
}

// MARK: - Timezone catalog (web `listTimezones`)

/// The IANA timezone options the picker offers — the native port of the web
/// `listTimezones`. The full known-identifier set replaces the web `Intl.supported
/// ValuesOf('timeZone')`; the current draft zone is pinned first when it isn't already
/// present (web `[currentTz, ...zones]`).
public enum QuietHoursTimezones {
    public static func options(current: String) -> [String] {
        var zones = TimeZone.knownTimeZoneIdentifiers.sorted()
        if !current.isEmpty, !zones.contains(current) {
            zones.insert(current, at: 0)
        }
        return zones
    }
}
