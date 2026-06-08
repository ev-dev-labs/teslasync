//
//  XRayFieldsTable.Adapter.swift
//  TeslaSync — P4 feature view · 0034 · XRayFieldsTable (Apple)
//
//  Pure (Foundation-only) projection: cached `[XRayFieldStat]` + the active sort →
//  per-row display strings, reproducing the web source's pipeline VERBATIM so the native
//  table shows the exact same values as
//  web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx:
//    • value_kind label  ← formatValueKind()           (api/hooks/useIngestXRay.ts)
//    • samples           ← fmtInt() = fmtNumber(v, 0)   (lib/numberFormat.ts)
//    • last seen         ← <TimeStamp format="relative"> → formatRelative()  (lib/dateFormat.ts)
//    • sort              ← const sorted = [...rows].sort(switch sortKey) * dir
//
//  This file is deliberately free of SwiftUI so the formatting + sort can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - value_kind label (ported 1:1 from useIngestXRay.ts `formatValueKind`)

/// Human-readable label for a `value_kind` integer, mirroring `protomodel.ValueKind` in the Go
/// ingest path. Unknown values render as `kind {n}` so an operator can still cross-reference the
/// raw enum without a UI patch — identical to the web `formatValueKind`.
public enum XRayValueKind {
    /// The known `value_kind` → label map (matches the `formatValueKind` switch 0…10).
    private static let labels: [Int: String] = [
        0: "unknown", 1: "string", 2: "bool", 3: "int32", 4: "int64",
        5: "float32", 6: "float64", 7: "enum", 8: "invalid", 9: "time", 10: "location"
    ]

    public static func label(_ kind: Int) -> String {
        labels[kind] ?? "kind \(kind)"
    }
}

// MARK: - Integer formatting (ported from lib/numberFormat.ts `fmtInt` = `fmtNumber(v, 0)`)

/// Locale-grouped integer formatting, ported 1:1 from `fmtInt(v) = fmtNumber(v, 0)` which calls
/// `safeNumber(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })`.
/// The web global locale is `'en-US'`, so the native formatter pins `en_US` for byte-identical
/// grouping (`12345 → "12,345"`).
public enum XRayNumberFormat {
    public static func int(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US")
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}

// MARK: - ISO-8601 timestamp parsing

/// Parses the API's `last_seen_at` ISO-8601 string. Tries the fractional-seconds variant first
/// (e.g. `2026-06-07T19:30:00.123Z`) then the plain variant (`2026-06-07T19:30:00Z`), mirroring
/// JavaScript's `new Date(iso)` acceptance of both. Returns `nil` for an unparseable value, just
/// as `isNaN(d.getTime())` guards the web formatters.
public enum XRayTimestamp {
    public static func parse(_ iso: String) -> Date? {
        // Built per call: ISO8601DateFormatter is not Sendable, so a shared static instance
        // would break Swift 6 strict-concurrency (and the design system likewise builds its
        // Foundation formatters per call).
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}

// MARK: - Relative time (ported 1:1 from lib/dateFormat.ts `formatRelative`)

/// Relative last-seen label, ported 1:1 from `formatRelative(iso)`:
///   • unparseable           → "—"
///   • < 60 s (incl. future) → "just now"
///   • < 60 min              → "Nm ago"
///   • < 24 h                → "Nh ago"
///   • < 7 d                 → "Nd ago"
///   • otherwise             → absolute `formatDate` ("MMM d, yyyy", locale + tz aware)
///
/// `now` is injected so the projection is deterministic + unit-testable (the web reads
/// `Date.now()` at render time).
public enum XRayRelativeTime {
    public static func lastSeen(
        fromISO iso: String,
        now: Date,
        locale: Locale,
        timeZone: TimeZone
    ) -> String {
        guard let date = XRayTimestamp.parse(iso) else { return "—" }
        let seconds = Int(floor(now.timeIntervalSince(date)))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        return absoluteDate(date, locale: locale, timeZone: timeZone)
    }

    /// Absolute fallback ported from `formatDate` — `toLocaleDateString(locale, { year:'numeric',
    /// month:'short', day:'numeric', timeZone })`. The localized `yMMMd` template yields the
    /// locale-appropriate ordering (en-US → "Jun 7, 2026").
    static func absoluteDate(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMd")
        return formatter.string(from: date)
    }
}

// MARK: - Sort (ported 1:1 from the web `const sorted = [...rows].sort(switch sortKey) * dir`)

/// Pure, stable sort reproducing the web `XRayFieldsTable` `sorted` computation exactly. The
/// per-key comparison mirrors the source switch (`field.localeCompare`, numeric `sample_count`,
/// `Date.parse` delta for `last_seen_at`, numeric `value_kind`); `* dir` is applied via the
/// direction. Swift's `sorted(by:)` is stable, matching ES2019 `Array.prototype.sort`.
public enum XRayFieldsSorter {
    public static func sorted(
        _ rows: [XRayFieldStat],
        key: XRayFieldsSortKey,
        direction: XRaySortDirection
    ) -> [XRayFieldStat] {
        let factor = direction == .ascending ? 1 : -1
        return rows.sorted { lhs, rhs in
            comparison(lhs, rhs, key: key) * factor < 0
        }
    }

    /// The web per-key comparator sign: negative when `lhs` orders before `rhs` ascending, zero
    /// when equal, positive otherwise (the `a.x - b.x` / `localeCompare` result, normalized to a
    /// sign so large `sample_count` deltas can never overflow).
    public static func comparison(_ lhs: XRayFieldStat, _ rhs: XRayFieldStat, key: XRayFieldsSortKey) -> Int {
        switch key {
        case .field:
            sign(of: lhs.field.localizedCompare(rhs.field))
        case .sampleCount:
            compareInt(lhs.sampleCount, rhs.sampleCount)
        case .lastSeenAt:
            compareEpoch(lhs.lastSeenAt, rhs.lastSeenAt)
        case .valueKind:
            compareInt(lhs.valueKind, rhs.valueKind)
        }
    }

    static func compareInt(_ lhs: Int, _ rhs: Int) -> Int {
        if lhs == rhs { return 0 }
        return lhs < rhs ? -1 : 1
    }

    /// Compares two `last_seen_at` strings by parsed epoch, reproducing `Date.parse(a) -
    /// Date.parse(b)`. Unparseable timestamps sort as the distant past (deterministic), keeping a
    /// strict weak ordering for `sorted(by:)`.
    static func compareEpoch(_ lhs: String, _ rhs: String) -> Int {
        let left = XRayTimestamp.parse(lhs)?.timeIntervalSince1970 ?? -Double.greatestFiniteMagnitude
        let right = XRayTimestamp.parse(rhs)?.timeIntervalSince1970 ?? -Double.greatestFiniteMagnitude
        if left == right { return 0 }
        return left < right ? -1 : 1
    }

    private static func sign(of result: ComparisonResult) -> Int {
        switch result {
        case .orderedAscending: -1
        case .orderedSame: 0
        case .orderedDescending: 1
        }
    }
}

// MARK: - Display projection

/// One projected display row the table renders — the native parity of the web column `render`
/// callbacks. Carries both the formatted strings (for display) and the raw values (for
/// accessibility + tests).
public struct XRayFieldRow: Sendable, Equatable, Identifiable {
    public var field: String
    public var samplesText: String
    public var sampleCount: Int
    public var lastSeenText: String
    public var lastSeenAt: String
    public var kindLabel: String
    public var valueKind: Int

    public var id: String {
        field
    }

    public init(
        field: String,
        samplesText: String,
        sampleCount: Int,
        lastSeenText: String,
        lastSeenAt: String,
        kindLabel: String,
        valueKind: Int
    ) {
        self.field = field
        self.samplesText = samplesText
        self.sampleCount = sampleCount
        self.lastSeenText = lastSeenText
        self.lastSeenAt = lastSeenAt
        self.kindLabel = kindLabel
        self.valueKind = valueKind
    }
}

/// The render context for the projection — bundles the `now` anchor + the user's locale + the
/// resolved time zone so the projector keeps a small parameter list and the relative-time +
/// absolute-date formatting stays deterministic + unit-testable.
public struct XRayFieldsRenderContext: Sendable {
    public var now: Date
    public var locale: Locale
    public var timeZone: TimeZone

    public init(now: Date = Date(), locale: Locale = .current, timeZone: TimeZone = .current) {
        self.now = now
        self.locale = locale
        self.timeZone = timeZone
    }
}

/// Projects cached field stats into sorted display rows — the native parity of the web
/// `const sorted = [...rows].sort(...)` plus the four column `render` callbacks
/// (`fmtInt`, `<TimeStamp format="relative">`, `formatValueKind`).
public enum XRayFieldsProjector {
    public static func project(
        rows: [XRayFieldStat],
        sortKey: XRayFieldsSortKey,
        sortDirection: XRaySortDirection,
        context: XRayFieldsRenderContext
    ) -> [XRayFieldRow] {
        XRayFieldsSorter.sorted(rows, key: sortKey, direction: sortDirection).map { stat in
            XRayFieldRow(
                field: stat.field,
                samplesText: XRayNumberFormat.int(stat.sampleCount),
                sampleCount: stat.sampleCount,
                lastSeenText: XRayRelativeTime.lastSeen(
                    fromISO: stat.lastSeenAt,
                    now: context.now,
                    locale: context.locale,
                    timeZone: context.timeZone
                ),
                lastSeenAt: stat.lastSeenAt,
                kindLabel: XRayValueKind.label(stat.valueKind),
                valueKind: stat.valueKind
            )
        }
    }
}

// MARK: - Accessibility text

/// VoiceOver text for the table + rows. Built from the per-surface i18n facade so no English
/// literal lives in code; the row label spells out each column for a single combined utterance.
public enum XRayFieldsAccessibility {
    public static func rowLabel(_ row: XRayFieldRow) -> String {
        let samples = XRayFieldsStrings.string("admin.xray.fields.a11y.samples", "samples")
        let lastSeen = XRayFieldsStrings.string("admin.xray.fields.a11y.lastSeen", "last seen")
        let kind = XRayFieldsStrings.string("admin.xray.fields.a11y.kind", "kind")
        return "\(row.field), \(row.samplesText) \(samples), \(lastSeen) \(row.lastSeenText), \(kind) \(row.kindLabel)"
    }

    public static func summary(count: Int) -> String {
        XRayFieldsStrings.format("admin.xray.fields.a11y.summary", "%lld fields", count)
    }

    /// Spoken value for a sortable header: "ascending" / "descending" when active, else empty.
    public static func sortValue(isActive: Bool, direction: XRaySortDirection) -> String {
        guard isActive else { return "" }
        return direction == .ascending
            ? XRayFieldsStrings.string("admin.xray.fields.a11y.ascending", "ascending")
            : XRayFieldsStrings.string("admin.xray.fields.a11y.descending", "descending")
    }
}
