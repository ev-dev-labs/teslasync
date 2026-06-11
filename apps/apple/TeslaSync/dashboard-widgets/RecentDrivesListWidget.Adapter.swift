//
//  RecentDrivesListWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0078 · RecentDrivesListWidget (Apple)
//
//  Pure (Foundation-only) projection: cached `[RecentDriveDTO]` + `RecentDrivesUnitPrefs`
//  → per-row display strings, reproducing the web source's numeric pipeline VERBATIM so the
//  native surface shows the exact same values as
//  features/dashboard/widgets/RecentDrivesListWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be
//  compiled and executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Distance conversion (ported 1:1 from lib/unitConversion.ts)

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in
/// lib/unitConversion.ts — a divide by the unit's metres-per-unit factor. Non-finite
/// inputs collapse to 0 (the web feeds `d.distance_m ?? 0` and `fmtNumber` then applies
/// `safeNumber`, so the rendered value is identical).
func convertRecentDistanceFromSI(_ meters: Double, to unit: RecentDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

// MARK: - Address truncation (ported from the web `truncateAddress`)

/// Ports `truncateAddress(addr, maxLen)` from the web source: a missing/empty address
/// becomes the em-dash fallback, and an over-long address is cut to `maxLength` characters
/// with a trailing ellipsis.
func truncateRecentAddress(_ address: String?, maxLength: Int) -> String {
    guard let address, !address.isEmpty else { return "—" }
    if address.count > maxLength {
        return String(address.prefix(maxLength)) + "…"
    }
    return address
}

// MARK: - Number / date / duration formatting (ported from lib/numberFormat.ts + lib/dateFormat.ts)

/// Locale-aware number, duration and date formatting that mirrors the web `fmtNumber` /
/// `fmtInt` (`Intl.NumberFormat`), `formatDurationMinutes`, and `formatDateShort`.
public enum RecentDrivesFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away
    /// from zero to match `Intl.NumberFormat`'s default `halfExpand`.
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

    /// `fmtInt(v)` — `fmtNumber(v, 0)`. Accepts a `Double` because the web computes
    /// `start_soc_pct - end_soc_pct` (a number) before formatting.
    public static func integer(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// A `number`-style integer string pinned to en-US, matching the web `formatRoundedInt`
    /// helper that `formatDurationMinutes` uses for the minutes component.
    static func roundedInt(_ value: Double) -> String {
        number(value, decimals: 0, localeIdentifier: "en_US")
    }

    /// Reproduces `${value}` JS number stringification for the raw SoC interpolation
    /// (`${d.start_soc_pct}`): an integral value drops its fraction, otherwise the shortest
    /// round-tripping decimal is used.
    static func jsNumber(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }

    /// Ports `formatDurationMinutes(minutes, { subMinuteLabel })` from lib/dateFormat.ts:
    /// the em-dash fallback for non-finite/negative input, an optional sub-minute label, and
    /// the `Hh Mm` / `Mm` shape with the minutes component rounded the same way the web does.
    public static func duration(minutes: Double, subMinuteLabel: String?) -> String {
        guard minutes.isFinite, minutes >= 0 else { return "—" }
        if let subMinuteLabel, minutes < 1 { return subMinuteLabel }
        let hours = Int(minutes / 60)
        let remainder = minutes.truncatingRemainder(dividingBy: 60)
        let mins = roundedInt(remainder)
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }

    /// Ports `formatDateShort(iso)` from lib/dateFormat.ts: the em-dash fallback for a missing
    /// date, otherwise a locale + timezone aware `{ month: 'short', day: 'numeric' }` string.
    public static func shortDate(
        _ date: Date?,
        localeIdentifier: String,
        timeZoneIdentifier: String
    ) -> String {
        guard let date else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .current
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }
}

// MARK: - Projected row (web list row inside `WidgetShell`)

/// One projected drive row: the localized/formatted strings the SwiftUI row renders. Mirrors
/// the per-`Drive` derivation in the web `items.map(...)` block (distance, duration, start/end
/// address, start→end SoC, battery used, date).
public struct RecentDriveRow: Identifiable, Equatable {
    public let id: Int
    public let distanceText: String
    public let distanceUnit: String
    public let durationText: String
    public let startAddress: String
    public let endAddress: String
    public let socText: String
    public let batteryUsedText: String?
    public let dateText: String
    public let accessibilityLabel: String

    public init(
        id: Int,
        distanceText: String,
        distanceUnit: String,
        durationText: String,
        startAddress: String,
        endAddress: String,
        socText: String,
        batteryUsedText: String?,
        dateText: String,
        accessibilityLabel: String
    ) {
        self.id = id
        self.distanceText = distanceText
        self.distanceUnit = distanceUnit
        self.durationText = durationText
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.socText = socText
        self.batteryUsedText = batteryUsedText
        self.dateText = dateText
        self.accessibilityLabel = accessibilityLabel
    }

    /// Returns a copy of the row carrying the given VoiceOver label, so the projector can build
    /// the display fields once and then attach the label derived from them.
    public func withAccessibilityLabel(_ label: String) -> RecentDriveRow {
        RecentDriveRow(
            id: id,
            distanceText: distanceText,
            distanceUnit: distanceUnit,
            durationText: durationText,
            startAddress: startAddress,
            endAddress: endAddress,
            socText: socText,
            batteryUsedText: batteryUsedText,
            dateText: dateText,
            accessibilityLabel: label
        )
    }
}

// MARK: - Projection

/// The fully-projected widget content: the capped + projected rows and whether the address
/// column is shown (the web `isWide` branch). Computed by the view from the model's cached
/// drives + display prefs, mirroring the web `useMemo` derive.
public struct RDListProjection: Equatable {
    public let rows: [RecentDriveRow]
    public let showsAddresses: Bool

    public init(rows: [RecentDriveRow], showsAddresses: Bool) {
        self.rows = rows
        self.showsAddresses = showsAddresses
    }

    public var isEmpty: Bool {
        rows.isEmpty
    }
}

/// Pure projector: `[RecentDriveDTO]` + `RecentDrivesUnitPrefs` → `RDListProjection`.
/// Every value is computed with the exact same arithmetic + formatting as the web widget.
public enum RecentDrivesProjector {
    /// The web row-derivation, applied to each cached drive (capped at `limit`).
    public static func project(
        drives: [RecentDriveDTO],
        units: RecentDrivesUnitPrefs,
        limit: Int,
        showsAddresses: Bool
    ) -> RDListProjection {
        let capped = limit > 0 ? Array(drives.prefix(limit)) : []
        let rows = capped.map { projectRow($0, units: units, showsAddresses: showsAddresses) }
        return RDListProjection(rows: rows, showsAddresses: showsAddresses)
    }

    private static func projectRow(
        _ drive: RecentDriveDTO,
        units: RecentDrivesUnitPrefs,
        showsAddresses: Bool
    ) -> RecentDriveRow {
        let locale = units.localeIdentifier

        // Distance: convertDistanceFromSI(d.distance_m ?? 0, unit) → fmtNumber(dist, 1).
        let dist = convertRecentDistanceFromSI(drive.distanceM, to: units.distance)
        let distanceText = RecentDrivesFormat.number(dist, decimals: 1, localeIdentifier: locale)

        // Duration: formatDurationMinutes((d.duration_s ?? 0) / 60, { subMinuteLabel: '<1m' }).
        let durationText = RecentDrivesFormat.duration(minutes: drive.durationS / 60, subMinuteLabel: "<1m")

        // Addresses: truncateAddress(addr, 30) (always projected; only shown when wide).
        let startAddress = truncateRecentAddress(drive.startAddress, maxLength: 30)
        let endAddress = truncateRecentAddress(drive.endAddress, maxLength: 30)

        // SoC: `${start ?? '?'}% → ${end ?? '?'}%`.
        let startSoc = drive.startSocPct.map(RecentDrivesFormat.jsNumber) ?? "?"
        let endSoc = drive.endSocPct.map(RecentDrivesFormat.jsNumber) ?? "?"
        let socText = "\(startSoc)% → \(endSoc)%"

        // Battery used: shown only when both SoC values exist AND distance > 0.
        let batteryUsed: Double? = {
            guard let start = drive.startSocPct, let end = drive.endSocPct else { return nil }
            return start - end
        }()
        let batteryUsedText: String? = {
            guard let batteryUsed, dist > 0 else { return nil }
            return RecentDrivesFormat.integer(batteryUsed, localeIdentifier: locale) + "%"
        }()

        // Date: formatDateShort(d.start_ts).
        let dateText = RecentDrivesFormat.shortDate(
            drive.startTimestamp,
            localeIdentifier: locale,
            timeZoneIdentifier: units.timeZoneIdentifier
        )

        let row = RecentDriveRow(
            id: drive.id,
            distanceText: distanceText,
            distanceUnit: units.distance.symbol,
            durationText: durationText,
            startAddress: startAddress,
            endAddress: endAddress,
            socText: socText,
            batteryUsedText: batteryUsedText,
            dateText: dateText,
            accessibilityLabel: ""
        )
        return row.withAccessibilityLabel(
            RDListAccessibility.rowLabel(for: row, showsAddresses: showsAddresses)
        )
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver labels for the list and its rows. Pure + public so the a11y content
/// can be unit-tested without rendering the view.
public enum RDListAccessibility {
    /// One spoken sentence describing a single drive row, e.g.
    /// "12.0 km, 31m, Battery 82% to 75%, 7% used, from … to …, Jun 7". Derived from the
    /// already-projected row so the field set stays the single source of truth.
    public static func rowLabel(for row: RecentDriveRow, showsAddresses: Bool) -> String {
        let battery = RDListStrings.string("widget.recentDrivesList.a11yBattery", "Battery")
        let toWord = RDListStrings.string("widget.recentDrivesList.a11yTo", "to")
        let spokenSoc = row.socText.replacingOccurrences(of: "→", with: toWord)
        var parts = ["\(row.distanceText) \(row.distanceUnit)", row.durationText, "\(battery) \(spokenSoc)"]
        if let batteryUsedText = row.batteryUsedText {
            let used = RDListStrings.string("widget.recentDrivesList.a11yUsed", "used")
            parts.append("\(batteryUsedText) \(used)")
        }
        if showsAddresses {
            let from = RDListStrings.string("widget.recentDrivesList.a11yFrom", "from")
            parts.append("\(from) \(row.startAddress) \(toWord) \(row.endAddress)")
        }
        parts.append(row.dateText)
        return parts.joined(separator: ", ")
    }

    /// The list container summary, e.g. "Recent Drives, 7 drives".
    public static func listSummary(for projection: RDListProjection) -> String {
        let title = RDListStrings.string("widget.recentDrivesList", "Recent Drives")
        let count = RDListStrings.format(
            "widget.recentDrivesList.a11yCount",
            "%lld drives",
            projection.rows.count
        )
        return "\(title), \(count)"
    }
}

// MARK: - Layout (web `size` → driveLimit + isWide)

/// The web responsive sizing, ported verbatim from the source:
/// `isWide = cols >= 3`, `isTall = rows >= 2`, `driveLimit = isWide ? 10 : isTall ? 7 : 5`.
/// Pure + public so the size math can be unit-tested without rendering.
public enum RecentDrivesLayout {
    /// `true` when the address column is shown (web `isWide`).
    public static func isWide(cols: Int) -> Bool {
        cols >= 3
    }

    /// The number of drives fetched + rendered for a grid size (web `driveLimit`).
    public static func driveLimit(cols: Int, rows: Int) -> Int {
        if isWide(cols: cols) { return 10 }
        return rows >= 2 ? 7 : 5
    }
}
