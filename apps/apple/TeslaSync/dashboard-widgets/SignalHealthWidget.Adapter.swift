//
//  SignalHealthWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0088 · SignalHealthWidget (Apple)
//
//  The pure, SwiftUI-free adapter layer: the cached DTO inputs the state holder
//  pushes (the available-signal names from `useSignals` + the live-signal map
//  from `useSignalGaps`) and the projection that turns them into the view's
//  render model — the total / active / gap counts, the data-freshness age, the
//  red / amber / green health level, and the sorted "stale / gap" signal list.
//
//  This is a 1:1 port of the `analysis` + `healthLevel` `useMemo` blocks in
//  `features/dashboard/widgets/SignalHealthWidget.tsx`, composed with the
//  `fmtInt` (`lib/numberFormat`), the widget's local `formatAge`, and
//  `formatRelative` (`lib/dateFormat`) formatters it renders with. Kept free of
//  SwiftUI so the projection is unit-testable on the host without rendering.
//
//  Display words ("just now", "… ago") resolve through the P1/S10 localization
//  facade (`SignalHealthStrings`), so there are no hardcoded English literals;
//  tests assert against the web English fallbacks the facade returns when the
//  table is absent from the test bundle.
//

import Foundation

// MARK: - Cached DTO input (port of the web live-signal entry)

/// One live-signal entry from the `/signals/{id}/live` map the web `useSignalGaps`
/// hook returns (`Record<string, { value: unknown; timestamp: string }>`). Only
/// the `timestamp` is modeled — it is the single field the freshness / gap
/// analysis reads; the opaque `value` is out of scope for this surface. A missing
/// timestamp (the web `entry?.timestamp ?? null`) is represented by `nil` and
/// always counts as a gap.
public struct SignalHealthLiveEntry: Sendable, Equatable {
    public var timestamp: Date?

    public init(timestamp: Date? = nil) {
        self.timestamp = timestamp
    }
}

// MARK: - Health level (port of the web `healthLevel` useMemo)

/// The coarse coverage grade derived from the active / stale ratio — the web
/// `healthLevel` (`'green' | 'amber' | 'red' | 'neutral'`). Drives the status
/// badge copy, the header tint, and the compact freshness color.
public enum SignalHealthLevel: String, Sendable, Equatable {
    case green
    case amber
    case red
    case neutral
}

// MARK: - Format options (the user display preferences the projection bakes in)

/// The locale + timezone the absolute date fallback renders in (the web
/// `formatRelative` → `formatDate` path for a last-seen older than a week).
/// Defaults mirror the web test globals (`en-US`, UTC) so previews and tests are
/// deterministic; the production source threads the live settings through.
public struct SignalHealthFormatOptions: Sendable, Equatable {
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

// MARK: - Formatters (ports of fmtInt + the widget formatAge + formatRelative)

/// Pure formatting mirroring the web `fmtInt` (`lib/numberFormat`), the widget's
/// local `formatAge` (`'{{count}}s ago'` / `'{{count}}m ago'` / `'{{count}}h ago'`
/// / em-dash), and `formatRelative` (`lib/dateFormat` — "just now" / "Nm ago" /
/// "Nh ago" / "Nd ago" / absolute date). The relative words resolve through the
/// P1/S10 facade so no English literal lives in code.
public enum SignalHealthFormat {
    /// The em-dash sentinel the web shows for a missing value (`formatAge(null)`
    /// and `formatRelative(null)` both read as `'—'`).
    public static let dash = "—"

    /// The web `STALE_THRESHOLD_MS = 5 * 60 * 1000`, expressed in seconds. A live
    /// signal older than this is a gap.
    public static let staleThresholdSeconds: TimeInterval = 5 * 60

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

    /// Formats a freshness age in seconds — the widget's local `formatAge`. A
    /// `nil` age reads as the em-dash sentinel; otherwise under a minute reads in
    /// seconds, under an hour floors to whole minutes, and beyond floors to whole
    /// hours.
    public static func age(seconds: Int?) -> String {
        guard let seconds else { return dash }
        if seconds < 60 {
            return SignalHealthStrings.count("widget.signalHealth.secAgo", "%llds ago", seconds)
        }
        if seconds < 3600 {
            return SignalHealthStrings.count("widget.signalHealth.minAgo", "%lldm ago", seconds / 60)
        }
        return SignalHealthStrings.count("widget.signalHealth.hrAgo", "%lldh ago", seconds / 3600)
    }

    /// Formats a last-seen timestamp relative to `now` — the web `formatRelative`
    /// (`lib/dateFormat`). Under a minute reads "just now"; under an hour / day /
    /// week reads in floored minutes / hours / days; beyond a week falls back to
    /// the absolute "MMM d, yyyy" date. A `nil` value reads as the em-dash.
    public static func relative(_ date: Date?, now: Date, options: SignalHealthFormatOptions) -> String {
        guard let date else { return dash }
        let seconds = Int(floor(now.timeIntervalSince(date)))
        if seconds < 60 {
            return SignalHealthStrings.string("widget.signalHealth.justNow", "just now")
        }
        let minutes = seconds / 60
        if minutes < 60 {
            return SignalHealthStrings.count("widget.signalHealth.minAgo", "%lldm ago", minutes)
        }
        let hours = minutes / 60
        if hours < 24 {
            return SignalHealthStrings.count("widget.signalHealth.hrAgo", "%lldh ago", hours)
        }
        let days = hours / 24
        if days < 7 {
            return SignalHealthStrings.count("widget.signalHealth.dayAgo", "%lldd ago", days)
        }
        return absoluteDate(date, options: options)
    }

    /// The absolute "MMM d, yyyy" date the web `formatRelative` falls back to for
    /// a last-seen older than a week (`formatDate`).
    public static func absoluteDate(_ date: Date, options: SignalHealthFormatOptions) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = options.locale
        formatter.timeZone = options.timeZone
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }
}

// MARK: - Rendered gap row (port of the web stale-signal list item)

/// One row of the "Stale / Gap Signals" list — already formatted for display
/// (`lastSeenText` = "5m ago" / "Apr 4, 2026" / "—"). The view performs no
/// formatting, only layout. Identified by the signal `name` (the live map keys
/// are unique).
public struct SignalHealthGapRow: Sendable, Equatable, Identifiable {
    public let name: String
    public var lastSeen: Date?
    public var lastSeenText: String

    public var id: String {
        name
    }

    public init(name: String, lastSeen: Date?, lastSeenText: String) {
        self.name = name
        self.lastSeen = lastSeen
        self.lastSeenText = lastSeenText
    }
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-computed render model the view switches over. Every value is already
/// formatted into display strings so the SwiftUI layer performs no math or
/// formatting. `gapSignals` carries the full sorted gap list (gaps with no
/// timestamp first, then oldest-seen first); the view caps the visible slice per
/// layout. This is the output the adapter tests assert for parity with the web
/// `analysis` / `healthLevel` `useMemo`.
public struct SignalHealthProjection: Sendable, Equatable {
    public var totalSignals: Int
    public var totalSignalsText: String
    public var activeCount: Int
    public var activeCountText: String
    public var staleCount: Int
    public var staleCountText: String
    public var coveredText: String
    public var freshnessAgeSeconds: Int?
    public var freshnessText: String
    public var gapSignals: [SignalHealthGapRow]
    public var healthLevel: SignalHealthLevel
    public var hasData: Bool

    public init(
        totalSignals: Int,
        totalSignalsText: String,
        activeCount: Int,
        activeCountText: String,
        staleCount: Int,
        staleCountText: String,
        coveredText: String,
        freshnessAgeSeconds: Int?,
        freshnessText: String,
        gapSignals: [SignalHealthGapRow],
        healthLevel: SignalHealthLevel,
        hasData: Bool
    ) {
        self.totalSignals = totalSignals
        self.totalSignalsText = totalSignalsText
        self.activeCount = activeCount
        self.activeCountText = activeCountText
        self.staleCount = staleCount
        self.staleCountText = staleCountText
        self.coveredText = coveredText
        self.freshnessAgeSeconds = freshnessAgeSeconds
        self.freshnessText = freshnessText
        self.gapSignals = gapSignals
        self.healthLevel = healthLevel
        self.hasData = hasData
    }

    /// The empty projection the model starts from before any snapshot arrives.
    public static let empty = SignalHealthProjection(
        totalSignals: 0,
        totalSignalsText: "0",
        activeCount: 0,
        activeCountText: "0",
        staleCount: 0,
        staleCountText: "0",
        coveredText: "0/0",
        freshnessAgeSeconds: nil,
        freshnessText: SignalHealthFormat.dash,
        gapSignals: [],
        healthLevel: .neutral,
        hasData: false
    )

    /// Whether there is at least one gap row to show — the web
    /// `analysis.gapSignals.length > 0` guard on the wide-layout list.
    public var hasGapSignals: Bool {
        !gapSignals.isEmpty
    }

    /// The newest-relevant rows capped to the layout's visible maximum — the web
    /// `analysis.gapSignals.slice(0, isCompact ? 3 : 15)`.
    public func displayedGapSignals(max maxRows: Int) -> [SignalHealthGapRow] {
        Array(gapSignals.prefix(max(0, maxRows)))
    }
}

// MARK: - Adapter (cached DTOs → projection)

/// Pure transforms from the cached DTOs to the render model. The state holder
/// calls these; the view never recomputes them.
public enum SignalHealthAdapter {
    /// The visible gap-row cap for the wide layout — the web `slice(0, 15)`.
    public static let wideMaxGapRows = 15

    /// Projects the available-signal names + the live-signal map into the render
    /// model. `signals == nil` / `liveEntries == nil` mean the corresponding query
    /// has not resolved yet (the web `undefined`); an empty resolved collection is
    /// still "present" data. `statsAvailable` mirrors the web `stats` truthiness in
    /// the `hasData = stats || signals || gapData` decision.
    public static func project(
        signals: [String]?,
        liveEntries: [String: SignalHealthLiveEntry]?,
        statsAvailable: Bool,
        now: Date,
        options: SignalHealthFormatOptions = SignalHealthFormatOptions()
    ) -> SignalHealthProjection {
        let totalSignals = signals?.count ?? 0
        let entries = liveEntries ?? [:]

        var activeCount = 0
        var staleCount = 0
        var latest: Date?
        var gaps: [(name: String, lastSeen: Date?)] = []

        for (name, entry) in entries {
            if let timestamp = entry.timestamp {
                let age = now.timeIntervalSince(timestamp)
                if age > SignalHealthFormat.staleThresholdSeconds {
                    staleCount += 1
                    gaps.append((name: name, lastSeen: timestamp))
                } else {
                    activeCount += 1
                }
                if let current = latest {
                    if timestamp > current { latest = timestamp }
                } else {
                    latest = timestamp
                }
            } else {
                staleCount += 1
                gaps.append((name: name, lastSeen: nil))
            }
        }

        gaps.sort(by: gapOrder)

        let gapRows = gaps.map { gap in
            SignalHealthGapRow(
                name: gap.name,
                lastSeen: gap.lastSeen,
                lastSeenText: SignalHealthFormat.relative(gap.lastSeen, now: now, options: options)
            )
        }

        let freshnessAge: Int? = latest.map { max(0, Int(floor(now.timeIntervalSince($0)))) }
        let level = healthLevel(activeCount: activeCount, staleCount: staleCount)

        let hasData = statsAvailable || signals != nil || liveEntries != nil

        return SignalHealthProjection(
            totalSignals: totalSignals,
            totalSignalsText: SignalHealthFormat.integer(totalSignals, locale: options.locale),
            activeCount: activeCount,
            activeCountText: SignalHealthFormat.integer(activeCount, locale: options.locale),
            staleCount: staleCount,
            staleCountText: SignalHealthFormat.integer(staleCount, locale: options.locale),
            coveredText: "\(activeCount)/\(activeCount + staleCount)",
            freshnessAgeSeconds: freshnessAge,
            freshnessText: SignalHealthFormat.age(seconds: freshnessAge),
            gapSignals: gapRows,
            healthLevel: level,
            hasData: hasData
        )
    }

    /// The web gap sort: entries with no last-seen first (ties broken by name),
    /// then the remaining entries oldest-seen first.
    static func gapOrder(_ lhs: (name: String, lastSeen: Date?), _ rhs: (name: String, lastSeen: Date?)) -> Bool {
        switch (lhs.lastSeen, rhs.lastSeen) {
        case (nil, nil):
            lhs.name < rhs.name
        case (nil, _):
            true
        case (_, nil):
            false
        case let (left?, right?):
            left < right
        }
    }

    /// The web `healthLevel` ratio test: `neutral` when nothing is tracked,
    /// `red` at ≥ 50 % stale, `amber` for any stale, else `green`.
    static func healthLevel(activeCount: Int, staleCount: Int) -> SignalHealthLevel {
        let total = activeCount + staleCount
        guard total > 0 else { return .neutral }
        let staleRatio = Double(staleCount) / Double(total)
        if staleRatio >= 0.5 { return .red }
        if staleRatio > 0 { return .amber }
        return .green
    }
}
