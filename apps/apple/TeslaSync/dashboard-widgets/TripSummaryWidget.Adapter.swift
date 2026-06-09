//
//  TripSummaryWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0103 · TripSummaryWidget (Apple)
//
//  Pure (Foundation-only) projection: cached `[TripSummaryDTO]` + `TripSummaryUnitPrefs`
//  → the last-trip stat block + recent-trip rows, reproducing the web source's numeric pipeline
//  VERBATIM so the native surface shows the exact same values as
//  features/dashboard/widgets/TripSummaryWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Distance conversion (ported 1:1 from lib/unitConversion.ts)

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in lib/unitConversion.ts
/// — a divide by the unit's metres-per-unit factor. Non-finite inputs collapse to 0 (the web feeds
/// `total_distance_m ?? 0` and `fmtNumber` then applies `safeNumber`, so the rendered value is
/// identical).
func convertTripDistanceFromSI(_ meters: Double, to unit: TripDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number / date / duration formatting (ported from lib/numberFormat.ts + lib/dateFormat.ts)

/// Locale-aware number, duration and date formatting that mirrors the web `fmtNumber` / `fmtInt`
/// (`Intl.NumberFormat`), `formatDurationRange`, and `formatDateShort`.
public enum TripSummaryFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Intl.NumberFormat`'s default `halfExpand`.
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

    /// `fmtInt(v)` — `fmtNumber(v, 0)`. Accepts a `Double` so callers can pass counts directly.
    public static func integer(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// A `number`-style integer string pinned to en-US, matching the web `formatRoundedInt` helper
    /// that `formatDurationMinutes` uses for the minutes component.
    static func roundedInt(_ value: Double) -> String {
        number(value, decimals: 0, localeIdentifier: "en_US")
    }

    /// Ports `formatDurationMinutes(minutes, { subMinuteLabel })` from lib/dateFormat.ts: the
    /// em-dash fallback for non-finite/negative input, an optional sub-minute label, and the
    /// `Hh Mm` / `Mm` shape with the minutes component rounded the same way the web does.
    public static func durationMinutes(minutes: Double, subMinuteLabel: String?) -> String {
        guard minutes.isFinite, minutes >= 0 else { return "—" }
        if let subMinuteLabel, minutes < 1 { return subMinuteLabel }
        let hours = Int(minutes / 60)
        let remainder = minutes.truncatingRemainder(dividingBy: 60)
        let mins = roundedInt(remainder)
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }

    /// Ports `formatDurationRange(start, end)` from lib/dateFormat.ts: the em-dash fallback for a
    /// missing/invalid/non-positive range, otherwise the whole-minute duration between the two
    /// timestamps formatted via `formatDurationMinutes` (no sub-minute label).
    public static func durationRange(start: Date?, end: Date?) -> String {
        guard let start, let end else { return "—" }
        let startMs = start.timeIntervalSince1970
        let endMs = end.timeIntervalSince1970
        guard startMs.isFinite, endMs.isFinite else { return "—" }
        let deltaMs = (endMs - startMs) * 1000
        if deltaMs <= 0 { return "—" }
        let minutes = (deltaMs / 60000).rounded()
        return durationMinutes(minutes: minutes, subMinuteLabel: nil)
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

// MARK: - Projected content (web `WidgetShell` body)

/// The projected "Last Trip" summary block — the localized/formatted strings the SwiftUI stat
/// grid renders. Mirrors the web `lastTrip` block (`Badge` + date + name + four `StatCard`s).
public struct TripSummaryLastTrip: Equatable {
    public let id: Int
    public let name: String
    public let dateText: String
    public let distanceValue: String
    public let distanceUnit: String
    public let durationText: String
    public let drivesText: String
    public let chargeStopsText: String
    public let accessibilityLabel: String

    public init(
        id: Int,
        name: String,
        dateText: String,
        distanceValue: String,
        distanceUnit: String,
        durationText: String,
        drivesText: String,
        chargeStopsText: String,
        accessibilityLabel: String
    ) {
        self.id = id
        self.name = name
        self.dateText = dateText
        self.distanceValue = distanceValue
        self.distanceUnit = distanceUnit
        self.durationText = durationText
        self.drivesText = drivesText
        self.chargeStopsText = chargeStopsText
        self.accessibilityLabel = accessibilityLabel
    }
}

/// One projected recent-trip row (web `recentTrips.slice(1)` list row): the name + date and, when
/// the widget is not compact, distance + duration + the `N drv` badge count.
public struct TripSummaryRow: Identifiable, Equatable {
    public let id: Int
    public let name: String
    public let dateText: String
    public let distanceValue: String
    public let distanceUnit: String
    public let durationText: String
    public let driveCountText: String
    public let accessibilityLabel: String

    public init(
        id: Int,
        name: String,
        dateText: String,
        distanceValue: String,
        distanceUnit: String,
        durationText: String,
        driveCountText: String,
        accessibilityLabel: String
    ) {
        self.id = id
        self.name = name
        self.dateText = dateText
        self.distanceValue = distanceValue
        self.distanceUnit = distanceUnit
        self.durationText = durationText
        self.driveCountText = driveCountText
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully-projected widget content: the last-trip block (web `trips[0]`), the recent rows (web
/// `recentTrips.slice(1)`, shown only when there is more than one recent trip), and whether the
/// compact single-column layout is active. Computed by the view from the model's cached trips +
/// display prefs, mirroring the web `useMemo` derive.
public struct TripSummaryProjection: Equatable {
    public let lastTrip: TripSummaryLastTrip?
    public let recentRows: [TripSummaryRow]
    public let isCompact: Bool

    public init(lastTrip: TripSummaryLastTrip?, recentRows: [TripSummaryRow], isCompact: Bool) {
        self.lastTrip = lastTrip
        self.recentRows = recentRows
        self.isCompact = isCompact
    }

    /// `true` when there is no trip to render at all (web `trips.length === 0`).
    public var isEmpty: Bool {
        lastTrip == nil && recentRows.isEmpty
    }
}

/// Pure projector: `[TripSummaryDTO]` + `TripSummaryUnitPrefs` → `TripSummaryProjection`. Every
/// value is computed with the exact same arithmetic + formatting as the web widget.
public enum TripSummaryProjector {
    /// Mirrors the web derive: `lastTrip = trips[0]`, `recentTrips = trips.slice(0, 3)`, recent
    /// rows = `recentTrips.slice(1)` shown only when `recentTrips.length > 1`.
    public static func project(
        trips: [TripSummaryDTO],
        units: TripSummaryUnitPrefs,
        isCompact: Bool
    ) -> TripSummaryProjection {
        guard let first = trips.first else {
            return TripSummaryProjection(lastTrip: nil, recentRows: [], isCompact: isCompact)
        }
        let recent = Array(trips.prefix(3))
        let rows: [TripSummaryRow] = recent.count > 1
            ? recent.dropFirst().map { projectRow($0, units: units, isCompact: isCompact) }
            : []
        return TripSummaryProjection(
            lastTrip: projectLastTrip(first, units: units),
            recentRows: rows,
            isCompact: isCompact
        )
    }

    private static func projectLastTrip(_ trip: TripSummaryDTO, units: TripSummaryUnitPrefs) -> TripSummaryLastTrip {
        let locale = units.localeIdentifier
        let distance = convertTripDistanceFromSI(trip.totalDistanceM, to: units.distance)
        let block = TripSummaryLastTrip(
            id: trip.id,
            name: tripName(trip.name),
            dateText: TripSummaryFormat.shortDate(
                trip.startDate,
                localeIdentifier: locale,
                timeZoneIdentifier: units.timeZoneIdentifier
            ),
            distanceValue: TripSummaryFormat.number(distance, decimals: 1, localeIdentifier: locale),
            distanceUnit: units.distance.symbol,
            durationText: TripSummaryFormat.durationRange(start: trip.startDate, end: trip.endDate),
            drivesText: TripSummaryFormat.integer(Double(trip.driveCount), localeIdentifier: locale),
            chargeStopsText: TripSummaryFormat.integer(Double(trip.chargeCount), localeIdentifier: locale),
            accessibilityLabel: ""
        )
        return block.withAccessibilityLabel(TripSummaryAccessibility.lastTripLabel(for: block))
    }

    private static func projectRow(
        _ trip: TripSummaryDTO,
        units: TripSummaryUnitPrefs,
        isCompact: Bool
    ) -> TripSummaryRow {
        let locale = units.localeIdentifier
        let distance = convertTripDistanceFromSI(trip.totalDistanceM, to: units.distance)
        let row = TripSummaryRow(
            id: trip.id,
            name: tripName(trip.name),
            dateText: TripSummaryFormat.shortDate(
                trip.startDate,
                localeIdentifier: locale,
                timeZoneIdentifier: units.timeZoneIdentifier
            ),
            distanceValue: TripSummaryFormat.number(distance, decimals: 1, localeIdentifier: locale),
            distanceUnit: units.distance.symbol,
            durationText: TripSummaryFormat.durationRange(start: trip.startDate, end: trip.endDate),
            driveCountText: TripSummaryFormat.integer(Double(trip.driveCount), localeIdentifier: locale),
            accessibilityLabel: ""
        )
        return row.withAccessibilityLabel(TripSummaryAccessibility.rowLabel(for: row, isCompact: isCompact))
    }

    /// Web `trip.name ?? t('widget.tripUnnamed', 'Unnamed trip')` — a `nil` name falls back to the
    /// localized "Unnamed trip" (an empty string is left as-is, mirroring JS `??`).
    private static func tripName(_ name: String?) -> String {
        name ?? TripSummaryStrings.string("widget.tripUnnamed", "Unnamed trip")
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver labels for the last-trip block and the recent rows. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum TripSummaryAccessibility {
    /// One spoken sentence describing the last-trip block, e.g. "Last Trip, Morning Commute, Jun 7,
    /// Distance 12.0 km, Duration 31m, Drives 1, Charge Stops 0".
    public static func lastTripLabel(for block: TripSummaryLastTrip) -> String {
        let lastTrip = TripSummaryStrings.string("widget.lastTrip", "Last Trip")
        let distance = TripSummaryStrings.string("widget.distance", "Distance")
        let duration = TripSummaryStrings.string("widget.duration", "Duration")
        let drives = TripSummaryStrings.string("widget.drives", "Drives")
        let chargeStops = TripSummaryStrings.string("widget.chargeStops", "Charge Stops")
        return [
            lastTrip,
            block.name,
            block.dateText,
            "\(distance) \(block.distanceValue) \(block.distanceUnit)",
            "\(duration) \(block.durationText)",
            "\(drives) \(block.drivesText)",
            "\(chargeStops) \(block.chargeStopsText)"
        ].joined(separator: ", ")
    }

    /// One spoken sentence for a recent row. The wide layout speaks distance + duration + drive
    /// count; the compact layout speaks only the distance (matching what is shown).
    public static func rowLabel(for row: TripSummaryRow, isCompact: Bool) -> String {
        var parts = [row.name, row.dateText, "\(row.distanceValue) \(row.distanceUnit)"]
        if !isCompact {
            parts.append(row.durationText)
            let drv = TripSummaryStrings.string("widget.drivesShort", "drv")
            parts.append("\(row.driveCountText) \(drv)")
        }
        return parts.joined(separator: ", ")
    }

    /// The recent-list container summary, e.g. "Recent Trips, 2 trips".
    public static func recentSummary(for projection: TripSummaryProjection) -> String {
        let title = TripSummaryStrings.string("widget.recentTrips", "Recent Trips")
        let count = TripSummaryStrings.format(
            "widget.tripSummary.a11yCount",
            "%lld trips",
            projection.recentRows.count
        )
        return "\(title), \(count)"
    }
}

// MARK: - Layout (web `size` → isCompact)

/// The web responsive sizing, ported verbatim from the source: `isCompact = size.cols <= 1`
/// (a single-column widget drops the duration/drive-count columns and the 4-up stat grid becomes
/// 2-up). Pure + public so the size math can be unit-tested without rendering.
public enum TripSummaryLayout {
    /// `true` when the compact single-column layout is active (web `isCompact`).
    public static func isCompact(cols: Int) -> Bool {
        cols <= 1
    }

    /// The number of columns in the last-trip stat grid (web `isCompact ? 2 : 4`).
    public static func statColumns(cols: Int) -> Int {
        isCompact(cols: cols) ? 2 : 4
    }
}

// MARK: - Projection mutation helpers

extension TripSummaryLastTrip {
    /// Returns a copy carrying the given VoiceOver label, so the projector can build the display
    /// fields once and then attach the label derived from them.
    func withAccessibilityLabel(_ label: String) -> TripSummaryLastTrip {
        TripSummaryLastTrip(
            id: id,
            name: name,
            dateText: dateText,
            distanceValue: distanceValue,
            distanceUnit: distanceUnit,
            durationText: durationText,
            drivesText: drivesText,
            chargeStopsText: chargeStopsText,
            accessibilityLabel: label
        )
    }
}

extension TripSummaryRow {
    /// Returns a copy carrying the given VoiceOver label (see `TripSummaryLastTrip` above).
    func withAccessibilityLabel(_ label: String) -> TripSummaryRow {
        TripSummaryRow(
            id: id,
            name: name,
            dateText: dateText,
            distanceValue: distanceValue,
            distanceUnit: distanceUnit,
            durationText: durationText,
            driveCountText: driveCountText,
            accessibilityLabel: label
        )
    }
}
