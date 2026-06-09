//
//  DashboardStatsWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0033 · DashboardStatsWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `DashboardStatsDTO` + the vehicle FSM state +
//  its recent transitions → display strings, reproducing the web source's numeric + relative-time
//  pipeline VERBATIM so the native surface shows the exact same values as
//  features/dashboard/widgets/DashboardStatsWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests. The SwiftUI color palette for the FSM state
//  kinds lives in DashboardStatsWidget.Components.swift.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Integer formatting that mirrors the web `fmtInt(v)` (= `fmtNumber(v, 0)`):
/// `safeNumber(v).toLocaleString(locale, { min/maxFractionDigits: 0 })` — grouped thousands, no
/// fraction digits, half away from zero (matching `Intl.NumberFormat`'s default `halfExpand`).
public enum DashboardStatsFormat {
    /// `fmtInt(v)` for an integer count (vehicles / trips / charge sessions).
    public static func integer(_ value: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}

// MARK: - Relative time (ported 1:1 from web lib/dateFormat.ts `formatRelative`)

/// A faithful port of the web `formatRelative(iso)`: bucketed relative labels (`just now`,
/// `{m}m ago`, `{h}h ago`, `{d}d ago`) for anything under a week, and a localized absolute date
/// (`formatDate`, `{month:'short', day:'numeric', year:'numeric'}`) beyond it. The localized
/// templates are injected so the bucketing logic stays pure + unit-testable; the i18n facade
/// (`DashboardStatsStrings.relative`) supplies them from the catalog.
public enum DashboardStatsRelativeTime {
    /// The localized strings the formatter interpolates. `%d` is the integer count.
    public struct Templates: Equatable, Sendable {
        public let justNow: String
        public let minutesAgo: String
        public let hoursAgo: String
        public let daysAgo: String
        public let emDash: String
        public let localeIdentifier: String

        public init(
            justNow: String,
            minutesAgo: String,
            hoursAgo: String,
            daysAgo: String,
            emDash: String = "—",
            localeIdentifier: String = "en_US"
        ) {
            self.justNow = justNow
            self.minutesAgo = minutesAgo
            self.hoursAgo = hoursAgo
            self.daysAgo = daysAgo
            self.emDash = emDash
            self.localeIdentifier = localeIdentifier
        }
    }

    /// The web `formatRelative` buckets, computed against `now` (web `Date.now()`). A `nil` date is
    /// the web `if (!iso) return '—'` / `isNaN` guard (the ISO parse returns `nil` for both).
    public static func label(from date: Date?, now: Date, templates: Templates) -> String {
        guard let date else { return templates.emDash }
        let seconds = Int(floor(now.timeIntervalSince(date)))
        if seconds < 60 { return templates.justNow }
        let minutes = seconds / 60
        if minutes < 60 { return String(format: templates.minutesAgo, minutes) }
        let hours = minutes / 60
        if hours < 24 { return String(format: templates.hoursAgo, hours) }
        let days = hours / 24
        if days < 7 { return String(format: templates.daysAgo, days) }
        return absoluteDate(date, localeIdentifier: templates.localeIdentifier)
    }

    /// The web `formatDate(iso)` fallback for ≥ 7 days: a localized medium date
    /// (`{month:'short', day:'numeric', year:'numeric'}` → e.g. "Jun 8, 2026").
    public static func absoluteDate(_ date: Date, localeIdentifier: String = "en_US") -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.setLocalizedDateFormatFromTemplate("yMMMd")
        return formatter.string(from: date)
    }
}

// MARK: - ISO timestamp parsing (web `new Date(iso)`)

/// Parses the API's RFC3339/ISO-8601 transition timestamps the way the web `new Date(iso)` does,
/// returning `nil` for blank/invalid input (the web `if (!iso) … if (isNaN(d.getTime()))` guard) so
/// the relative formatter renders the em-dash fallback.
public enum DashboardStatsDateParse {
    public static func parse(_ iso: String) -> Date? {
        let trimmed = iso.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        // The formatter is non-`Sendable`, so it is built locally (not a shared static) to stay
        // safe under Swift 6 strict concurrency. `.withFractionalSeconds` only matches timestamps
        // that carry a fraction, so we retry without it for plain second-precision input.
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: trimmed) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: trimmed) { return date }
        return nil
    }
}

// MARK: - Vehicle FSM state kind (port of the web VEHICLE_STATE_ENTRIES keyspace)

/// The vehicle operational states the widget distinguishes, mirroring the web `VEHICLE_STATES`
/// (`internal/enums/constants.go` + the frontend-only `updating`) the `StatusBadge` dot color is
/// resolved from, plus an `unknown` fallback for any other raw value (the web `DEFAULT_STATE` grey
/// branch). Pure: the color mapping lives in the palette (DashboardStatsWidget.Components.swift).
public enum DashboardVehicleStateKind: String, Sendable, Equatable, CaseIterable {
    case online
    case driving
    case charging
    case parked
    case updating
    case asleep
    case offline
    case unknown

    /// Resolves a raw API state string to a kind, lower-casing first (the web
    /// `states[state.toLowerCase()]` lookup). Unknown values map to `.unknown` so they still render
    /// with the neutral grey dot + their raw label.
    public static func from(raw: String) -> DashboardVehicleStateKind {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return DashboardVehicleStateKind(rawValue: key) ?? .unknown
    }
}

// MARK: - Projection value types (the adapter output the view renders)

/// One stat-grid cell, the Swift port of a web `StatGridItem` (`{ label, value }`). The label is
/// resolved lazily through the i18n facade so the projection stays free of pre-localized chrome.
public struct DashboardStatItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String

    public init(id: String, labelKey: String, labelFallback: String, value: String) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        DashboardStatsStrings.string(labelKey, labelFallback)
    }
}

/// One recent-transition row (web `recentTransitions.map`): the raw state (for the capitalized
/// neutral badge + dot color) and the parsed `startedAt` the view formats relative to now.
public struct DashboardTransitionRow: Sendable, Equatable, Identifiable {
    public let index: Int
    public let rawState: String
    public let startedAt: Date?

    public var id: Int {
        index
    }

    public init(index: Int, rawState: String, startedAt: Date?) {
        self.index = index
        self.rawState = rawState
        self.startedAt = startedAt
    }

    /// The capitalized label the web renders (`<Badge className="capitalize">{tr.state ?? '—'}`):
    /// a blank state collapses to the em-dash fallback, otherwise the first letter is upper-cased.
    public var label: String {
        DashboardStatsProjector.capitalizedState(rawState)
    }

    /// The parsed state kind (drives the neutral badge's accent dot color).
    public var kind: DashboardVehicleStateKind {
        DashboardVehicleStateKind.from(raw: rawState)
    }
}

/// The fully-projected widget content. The web renders the stat grid + current-state badge once a
/// dashboard-stats payload exists (the no-stats branch is the model's `.empty` phase); the compact
/// layout shows only `compactTripValue`, and the wide layout adds `transitions`.
public struct DashboardStatsProjection: Sendable, Equatable {
    /// Vehicles / Trips / Charge Sessions / FSM State — in web source order.
    public let statItems: [DashboardStatItem]
    /// The single big number the compact (1-column) layout centers (`fmtInt(totalTrips)`).
    public let compactTripValue: String
    /// The raw FSM state (web `fsm.data?.state ?? '—'`) the current-state badge renders capitalized.
    public let fsmState: String
    /// The recent state transitions (full list; the wide layout slices the first five).
    public let transitions: [DashboardTransitionRow]

    public init(
        statItems: [DashboardStatItem],
        compactTripValue: String,
        fsmState: String,
        transitions: [DashboardTransitionRow]
    ) {
        self.statItems = statItems
        self.compactTripValue = compactTripValue
        self.fsmState = fsmState
        self.transitions = transitions
    }

    /// The current FSM state's kind — drives the current-state badge dot color.
    public var fsmStateKind: DashboardVehicleStateKind {
        DashboardVehicleStateKind.from(raw: fsmState)
    }
}

// MARK: - Projector

/// Pure projector: `DashboardStatsDTO` + FSM state + transitions → `DashboardStatsProjection`. Every
/// value is computed with the exact same formatting as the web widget's `useMemo` blocks.
public enum DashboardStatsProjector {
    /// The web `fsm.data?.state ?? '—'` em-dash fallback for an absent FSM state.
    public static let emDash = "—"

    public static func project(
        stats: DashboardStatsDTO,
        fsmState rawFsmState: String?,
        transitions rawTransitions: [DashboardTransitionDTO],
        units: DashboardStatsUnitPrefs
    ) -> DashboardStatsProjection {
        let locale = units.localeIdentifier
        let fsmState = resolveFsmState(rawFsmState)

        let statItems = [
            DashboardStatItem(
                id: "vehicles",
                labelKey: "widget.dashboardStats.vehicles",
                labelFallback: "Vehicles",
                value: DashboardStatsFormat.integer(stats.totalVehicles, localeIdentifier: locale)
            ),
            DashboardStatItem(
                id: "trips",
                labelKey: "widget.dashboardStats.trips",
                labelFallback: "Trips",
                value: DashboardStatsFormat.integer(stats.totalTrips, localeIdentifier: locale)
            ),
            DashboardStatItem(
                id: "sessions",
                labelKey: "widget.dashboardStats.sessions",
                labelFallback: "Charge Sessions",
                value: DashboardStatsFormat.integer(stats.totalChargingSessions, localeIdentifier: locale)
            ),
            DashboardStatItem(
                id: "fsm-state",
                labelKey: "widget.dashboardStats.fsmState",
                labelFallback: "FSM State",
                value: fsmState
            )
        ]

        let transitions = rawTransitions.enumerated().map { index, transition in
            DashboardTransitionRow(
                index: index,
                rawState: transition.state,
                startedAt: DashboardStatsDateParse.parse(transition.startedAt)
            )
        }

        return DashboardStatsProjection(
            statItems: statItems,
            compactTripValue: DashboardStatsFormat.integer(stats.totalTrips, localeIdentifier: locale),
            fsmState: fsmState,
            transitions: transitions
        )
    }

    /// The web `fsm.data?.state ?? '—'`: a missing or blank FSM state collapses to the em-dash.
    public static func resolveFsmState(_ rawFsmState: String?) -> String {
        guard let rawFsmState else { return emDash }
        let trimmed = rawFsmState.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? emDash : trimmed
    }

    /// The web CSS `capitalize` for a single-token state, with the `?? '—'` blank fallback.
    public static func capitalizedState(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first else { return emDash }
        return first.uppercased() + trimmed.dropFirst()
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the widget. Pure + public so the a11y label content can
/// be unit-tested without rendering the view.
public enum DashboardStatsAccessibility {
    /// One spoken clause per stat, e.g.
    /// "Dashboard Stats. Vehicles 2. Trips 1,284. Charge Sessions 312. FSM State driving".
    public static func summary(for projection: DashboardStatsProjection) -> String {
        let title = DashboardStatsStrings.string("widget.dashboardStats.title", "Dashboard Stats")
        var parts = [title]
        for item in projection.statItems {
            parts.append("\(item.label) \(item.value)")
        }
        return parts.joined(separator: ". ")
    }
}
