//
//  RecentDrivesWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0079 · RecentDrivesWidget (Apple)
//
//  Pure (Foundation-only) projection: cached `RecentDrivesWidgetDriveDTO`s + `RecentDrivesWidgetUnitPrefs`
//  → per-row display strings, reproducing the web source's numeric + date pipeline VERBATIM
//  so the native surface shows the exact same values as
//  features/dashboard/widgets/RecentDrivesWidget.tsx.
//
//  Deliberately free of SwiftUI so the conversion/formatting compiles and executes on a plain
//  host and is pinned by unit tests. The view layers SwiftUI chrome on top in
//  RecentDrivesWidget.swift.
//

import Foundation

// MARK: - Conversion (ported 1:1 from web lib/unitConversion.ts)

/// Distance converter ported verbatim from `convertDistanceFromSI(meters, to)` in
/// lib/unitConversion.ts — a divide by the unit's metres-per-unit factor (km / mi / ft).
/// Non-finite metres collapse to zero, matching the web `safeNumber` guard.
func convertRecentDrivesDistanceFromSI(_ meters: Double, to unit: RecentDrivesDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting that mirrors the web `fmtNumber` / `fmtInt`
/// (`Intl.NumberFormat`), used for the distance value and the minutes count.
public enum RecentDrivesWidgetFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away
    /// from zero to match `Intl.NumberFormat`'s default `halfExpand` for the non-negative drive
    /// quantities this surface formats (distance, minutes).
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func integer(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The small set of pre-localized strings the projector needs. Injected so the projection stays
/// Foundation-only and host-testable (the view/model resolve these from `RecentDrivesWidgetStrings`),
/// mirroring the web source's literal `min` / `?` fallbacks and the `· … % → … %` detail layout.
public struct RecentDrivesCopy: Sendable, Equatable {
    /// Positional format for the detail line. Web:
    /// `${fmtInt(durationS/60)} min · ${startSoc ?? '?'}% → ${endSoc ?? '?'}%`.
    /// Args: (1) minutes, (2) start SoC, (3) end SoC. `%%` renders a literal `%`.
    public var tripDetailFormat: String
    /// Web `d.start_soc_pct ?? '?'` / `d.end_soc_pct ?? '?'` fallback glyph.
    public var socUnknown: String
    /// Web `formatDateShort` missing/invalid fallback (`'—'`).
    public var noDate: String

    public init(
        tripDetailFormat: String = "%1$@ min · %2$@%% → %3$@%%",
        socUnknown: String = "?",
        noDate: String = "—"
    ) {
        self.tripDetailFormat = tripDetailFormat
        self.socUnknown = socUnknown
        self.noDate = noDate
    }

    /// English fallbacks (matches the web source literals) — used by previews + tests.
    public static let fallback = RecentDrivesCopy()
}

// MARK: - Projected row (web list item)

/// One projected drive row: the formatted distance + unit, the `… min · …% → …%` detail line, a
/// short date, and a spoken accessibility label. Mirrors the web list item built in
/// `RecentDrivesWidget.tsx` (`distance + unit`, `minutes · start% → end%`, `formatDateShort`).
public struct RecentDrivesWidgetDriveRow: Identifiable, Equatable {
    public let id: Int64
    public let distanceValue: String
    public let distanceUnit: String
    public let detailText: String
    public let dateText: String
    public let accessibilityLabel: String

    public init(
        id: Int64,
        distanceValue: String,
        distanceUnit: String,
        detailText: String,
        dateText: String,
        accessibilityLabel: String
    ) {
        self.id = id
        self.distanceValue = distanceValue
        self.distanceUnit = distanceUnit
        self.detailText = detailText
        self.dateText = dateText
        self.accessibilityLabel = accessibilityLabel
    }

    /// The combined `value unit` distance string (web renders both in one `<p>`).
    public var distanceText: String {
        "\(distanceValue) \(distanceUnit)"
    }
}

// MARK: - Projection

/// The projected widget content: the (≤5) recent-drive rows. Computed once per snapshot.
public struct RecentDrivesWidgetProjection: Equatable {
    /// Last-five drive rows, newest-first as delivered by the source.
    public let rows: [RecentDrivesWidgetDriveRow]

    public init(rows: [RecentDrivesWidgetDriveRow]) {
        self.rows = rows
    }

    public var isEmpty: Bool {
        rows.isEmpty
    }
}

/// Pure projector: cached `RecentDrivesWidgetDriveDTO`s + unit prefs → `RecentDrivesWidgetProjection`. Every value is
/// computed with the same arithmetic + formatting as the web widget so a user with the web and
/// native dashboards open side by side sees identical rows.
public enum RecentDrivesWidgetProjector {
    /// The widget's contract is "Last 5 drives" (registry: recent-drives). The source already
    /// requests `limit=5`; we defensively cap here too.
    public static let maxRows = 5

    public static func project(
        drives: [RecentDrivesWidgetDriveDTO],
        units: RecentDrivesWidgetUnitPrefs,
        copy: RecentDrivesCopy = .fallback,
        timeZone: TimeZone = .current
    ) -> RecentDrivesWidgetProjection {
        let rows = drives.prefix(maxRows).map { drive in
            project(drive: drive, units: units, copy: copy, timeZone: timeZone)
        }
        return RecentDrivesWidgetProjection(rows: Array(rows))
    }

    public static func project(
        drive: RecentDrivesWidgetDriveDTO,
        units: RecentDrivesWidgetUnitPrefs,
        copy: RecentDrivesCopy = .fallback,
        timeZone: TimeZone = .current
    ) -> RecentDrivesWidgetDriveRow {
        let locale = units.localeIdentifier

        // Distance: convertDistanceFromSI(distance_m ?? 0, unitPrefs.distance) then fmtNumber(_, 1).
        let displayDistance = convertRecentDrivesDistanceFromSI(drive.distanceM ?? 0, to: units.distance)
        let distanceValue = RecentDrivesWidgetFormat.number(displayDistance, decimals: 1, localeIdentifier: locale)
        let distanceUnit = units.distance.symbol

        // Detail: fmtInt((duration_s ?? 0) / 60) min · start% → end%.
        let minutes = RecentDrivesWidgetFormat.integer((drive.durationS ?? 0) / 60, localeIdentifier: locale)
        let startSoc = socLabel(drive.startSocPct, copy: copy)
        let endSoc = socLabel(drive.endSocPct, copy: copy)
        let detailText = String(format: copy.tripDetailFormat, minutes, startSoc, endSoc)

        // Date: formatDateShort(start_ts) — short month + numeric day, or "—".
        let dateText = dateShort(drive.startTs, localeIdentifier: locale, timeZone: timeZone, fallback: copy.noDate)

        let accessibilityLabel = "\(distanceValue) \(distanceUnit), \(detailText), \(dateText)"

        return RecentDrivesWidgetDriveRow(
            id: drive.id,
            distanceValue: distanceValue,
            distanceUnit: distanceUnit,
            detailText: detailText,
            dateText: dateText,
            accessibilityLabel: accessibilityLabel
        )
    }

    /// Web `d.start_soc_pct ?? '?'` — the raw JS number stringification (no grouping, `.` decimal,
    /// trailing zeros dropped) with the `?` fallback for a missing value.
    static func socLabel(_ value: Double?, copy: RecentDrivesCopy) -> String {
        guard let value, value.isFinite else { return copy.socUnknown }
        if value == value.rounded() {
            return String(Int(value))
        }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 3
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Web `formatDateShort(iso)` — `toLocaleDateString(locale, { month: 'short', day: 'numeric' })`,
    /// or `'—'` for a missing/invalid timestamp.
    static func dateShort(
        _ date: Date?,
        localeIdentifier: String,
        timeZone: TimeZone,
        fallback: String
    ) -> String {
        guard let date else { return fallback }
        let locale = Locale(identifier: localeIdentifier)
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        // Locale-appropriate field ordering for "short month + numeric day" (en → "MMM d").
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the list. Pure + public so the a11y label content can be
/// unit-tested without rendering the view.
public enum RecentDrivesWidgetAccessibility {
    /// One spoken phrase per visible row, prefixed by the surface title:
    /// "Recent Drives. 12.3 km, 25 min · 80% → 62%, Jun 7. …".
    public static func summary(for projection: RecentDrivesWidgetProjection, title: String) -> String {
        var parts = [title]
        for row in projection.rows {
            parts.append(row.accessibilityLabel)
        }
        return parts.joined(separator: ". ")
    }
}
