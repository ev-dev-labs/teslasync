//
//  DrivingSection.Adapter.swift
//  TeslaSync — P4 feature view · 0075 · DrivingSection (Apple)
//
//  The testable projection core for the weekly-digest "Driving" section — the faithful port of
//  features/analytics/components/weekly-digest/DrivingSection.tsx. `DrivingFormat` mirrors the web
//  lib/ number + date helpers (fmtNumber / fmtInt / pctChange / formatDate);
//  `DrivingSectionProjector` reproduces the component's numeric pipeline VERBATIM (kilometres,
//  Wh·km, minutes — NO unit conversion; the web source is THE spec). Foundation-only so it is
//  unit-tested without a bundle or a rendered view. The value types live in DrivingSection.Models /
//  DrivingSection.Projection.
//

import Foundation

// MARK: - Number + date formatting (ported from web lib/)

/// Locale-aware number formatting mirroring the web `fmtNumber` / `fmtInt` (`Intl.NumberFormat`),
/// and the `formatDate` / `pctChange` helpers the Driving section relies on. Pure so the projection
/// stays host-testable.
public enum DrivingFormat {
    /// `safeNumber` (numberFormat.ts): non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Intl.NumberFormat`'s default `halfExpand` for the non-negative quantities here.
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

    /// `pctChange(current, previous)` (weekly-digest/helpers.ts): `previous == 0` →
    /// `current > 0 ? 100 : 0`; otherwise `((current - previous) / |previous|) * 100`.
    public static func percentChange(current: Double, previous: Double) -> Double {
        guard previous != 0 else { return current > 0 ? 100 : 0 }
        return ((current - previous) / abs(previous)) * 100
    }

    /// `formatDate(iso)` (lib/dateFormat.ts): a locale-aware "MMM d, yyyy" medium date, returning the
    /// em-dash sentinel for an empty / unparseable input (web `FALLBACK = '—'`).
    public static func date(
        _ iso: String,
        localeIdentifier: String = "en_US",
        timeZone: TimeZone = .current,
        emDash: String = "—"
    ) -> String {
        guard let parsed = parseTimestamp(iso) else { return emDash }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: parsed)
    }

    /// Parses the backend's ISO-8601 timestamp (web `new Date(iso)`), tolerating both the
    /// fractional-seconds and whole-second forms, and falling back to a plain `YYYY-MM-DD` day key.
    private static func parseTimestamp(_ iso: String) -> Date? {
        let trimmed = iso.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: trimmed) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: trimmed) { return date }

        guard trimmed.count >= 10 else { return nil }
        let dayParser = DateFormatter()
        dayParser.locale = Locale(identifier: "en_US_POSIX")
        dayParser.timeZone = TimeZone(identifier: "UTC")
        dayParser.dateFormat = "yyyy-MM-dd"
        dayParser.isLenient = false
        return dayParser.date(from: String(trimmed.prefix(10)))
    }
}

// MARK: - Projector (pure)

/// The dependency-free projection from a cached `DrivingDigestDTO` to chart-ready bars, the four
/// stat tiles, and the Top Drive card. Every value uses the same arithmetic + formatting as the web
/// component so the web and native digests render identical strings for identical input.
public enum DrivingSectionProjector {
    /// Builds the projection. `nil` data reproduces the web parent's "no digest" branch (the caller
    /// maps that to the surface empty phase).
    public static func project(
        data: DrivingDigestDTO?,
        copy: DrivingSectionCopy = .fallback,
        localeIdentifier: String = "en_US",
        timeZone: TimeZone = .current
    ) -> DrivingSectionProjection {
        guard let data else { return .empty }
        return DrivingSectionProjection(
            bars: bars(from: data.dailyDistance, copy: copy, locale: localeIdentifier),
            stats: stats(from: data, copy: copy, locale: localeIdentifier),
            topDrive: card(from: data.topDrive, copy: copy, locale: localeIdentifier, timeZone: timeZone)
        )
    }

    /// Resolves the surface phase, mirroring the web parent precedence (loading → error → body) and
    /// the WeeklyDigest convention: a resolved-but-absent digest is the empty state, present data
    /// (even all-zero) is content with its own inner chart / top-drive empty states.
    public static func resolvePhase(_ status: DrivingSectionLoadStatus, hasData: Bool) -> DrivingSectionPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasData ? .content : .empty
        }
    }

    // MARK: Daily-distance bars

    private static func bars(
        from entries: [DrivingDailyDistance],
        copy: DrivingSectionCopy,
        locale: String
    ) -> [DrivingDistanceBar] {
        entries.map { entry in
            let km = DrivingFormat.safeNumber(entry.distanceKm)
            let value = "\(DrivingFormat.number(km, decimals: 1, localeIdentifier: locale)) \(copy.distanceUnit)"
            return DrivingDistanceBar(day: entry.day, distanceKm: km, valueText: value)
        }
    }

    // MARK: Mini-stats

    private static func stats(
        from data: DrivingDigestDTO,
        copy: DrivingSectionCopy,
        locale: String
    ) -> [DrivingSectionStat] {
        [
            avgEfficiencyStat(data, copy: copy, locale: locale),
            drivingTimeStat(data, copy: copy, locale: locale),
            efficiencyChangeStat(data, copy: copy, locale: locale),
            drivesStat(data, copy: copy, locale: locale)
        ]
    }

    private static func avgEfficiencyStat(
        _ data: DrivingDigestDTO,
        copy: DrivingSectionCopy,
        locale: String
    ) -> DrivingSectionStat {
        // Web `${fmtNumber(metrics.avgEfficiency, 1)} Wh/km`.
        let avg = data.avgEfficiency ?? 0
        let value = "\(DrivingFormat.number(avg, decimals: 1, localeIdentifier: locale)) \(copy.efficiencyUnit)"
        return DrivingSectionStat(
            kind: .avgEfficiency,
            label: copy.avgEfficiencyLabel,
            value: value,
            accessibilityLabel: "\(copy.avgEfficiencyLabel), \(value)"
        )
    }

    private static func drivingTimeStat(
        _ data: DrivingDigestDTO,
        copy: DrivingSectionCopy,
        locale: String
    ) -> DrivingSectionStat {
        // Web `${fmtInt(Math.floor(totalDuration / 60))}h ${fmtInt(totalDuration % 60)}m`.
        let total = DrivingFormat.safeNumber(data.totalDurationMin ?? 0)
        let hours = (total / 60).rounded(.down)
        let minutes = total.truncatingRemainder(dividingBy: 60)
        let hoursText = DrivingFormat.integer(hours, localeIdentifier: locale)
        let minutesText = DrivingFormat.integer(minutes, localeIdentifier: locale)
        let value = "\(hoursText)\(copy.hoursGlyph) \(minutesText)\(copy.minutesGlyph)"
        return DrivingSectionStat(
            kind: .totalDrivingTime,
            label: copy.totalDrivingTimeLabel,
            value: value,
            accessibilityLabel: "\(copy.totalDrivingTimeLabel), \(value)"
        )
    }

    private static func efficiencyChangeStat(
        _ data: DrivingDigestDTO,
        copy: DrivingSectionCopy,
        locale: String
    ) -> DrivingSectionStat {
        let avg = data.avgEfficiency ?? 0
        let prev = data.prevAvgEfficiency ?? 0
        // Web: `prevAvgEfficiency > 0 ? `${fmtNumber(pctChange(...), 1)}%` : '—'`.
        let value: String
        if prev > 0 {
            let pct = DrivingFormat.percentChange(current: avg, previous: prev)
            value = "\(DrivingFormat.number(pct, decimals: 1, localeIdentifier: locale))%"
        } else {
            value = copy.emDash
        }
        // Web icon: `avg <= prev ? <TrendingDown emerald> : <TrendingUp red>` (efficiency: lower is better).
        let improving = avg <= prev
        let direction: DrivingTrendDirection = improving ? .down : .up
        let tone: DrivingTrendTone = improving ? .positive : .negative
        return DrivingSectionStat(
            kind: .efficiencyChange,
            label: copy.efficiencyChangeLabel,
            value: value,
            trend: direction,
            trendTone: tone,
            accessibilityLabel: "\(copy.efficiencyChangeLabel), \(value)"
        )
    }

    private static func drivesStat(
        _ data: DrivingDigestDTO,
        copy: DrivingSectionCopy,
        locale: String
    ) -> DrivingSectionStat {
        // Web `fmtInt(metrics.totalDrives)`.
        let value = DrivingFormat.integer(data.totalDrives ?? 0, localeIdentifier: locale)
        return DrivingSectionStat(
            kind: .drives,
            label: copy.drivesLabel,
            value: value,
            accessibilityLabel: "\(copy.drivesLabel), \(value)"
        )
    }

    // MARK: Top Drive card

    private static func card(
        from drive: DrivingTopDrive?,
        copy: DrivingSectionCopy,
        locale: String,
        timeZone: TimeZone
    ) -> DrivingTopDriveCard? {
        guard let drive else { return nil }
        let dateValue = DrivingFormat.date(
            drive.startDate,
            localeIdentifier: locale,
            timeZone: timeZone,
            emDash: copy.emDash
        )
        let distanceValue = "\(DrivingFormat.number(drive.distanceKm, decimals: 1, localeIdentifier: locale)) " +
            copy.distanceUnit
        let durationValue = "\(DrivingFormat.integer(drive.durationMin, localeIdentifier: locale)) \(copy.durationUnit)"
        let efficiencyValue = "\(DrivingFormat.number(drive.efficiencyWhKm, decimals: 1, localeIdentifier: locale)) " +
            copy.efficiencyUnit
        let rows = [
            DrivingTopDriveRow(label: copy.dateLabel, value: dateValue),
            DrivingTopDriveRow(label: copy.distanceLabel, value: distanceValue),
            DrivingTopDriveRow(label: copy.durationLabel, value: durationValue),
            DrivingTopDriveRow(label: copy.efficiencyLabel, value: efficiencyValue)
        ]
        let spoken = ([copy.topDriveBadge] + rows.map { "\($0.label) \($0.value)" }).joined(separator: ", ")
        return DrivingTopDriveCard(badge: copy.topDriveBadge, rows: rows, accessibilityLabel: spoken)
    }
}
