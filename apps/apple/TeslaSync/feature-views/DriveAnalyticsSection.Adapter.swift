//
//  DriveAnalyticsSection.Adapter.swift
//  TeslaSync — P4 feature view · 0166 · DriveAnalyticsSection (Apple)
//
//  The testable projection core for the driving-dynamics "Drive Analytics" section — the faithful port
//  of features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx. `DriveAnalyticsSectionFormat`
//  mirrors the web `Math.round` / `formatDateShort` / `fmtNumber` helpers;
//  `DriveAnalyticsSectionProjector` reproduces the component's three `useMemo` pipelines VERBATIM (the
//  speed-bucket histogram, the peak-power-vs-distance scatter, the recent-drives power profile),
//  including the bucket-boundary conversion. Foundation-only so it is unit-tested without a bundle or a
//  rendered view. The value types live in DriveAnalyticsSection.Models / DriveAnalyticsSection.Projection.
//

import Foundation

// MARK: - Number + date formatting (ported from web Math.* / lib/)

/// Pure formatting helpers mirroring the web numeric pipeline so the native and web charts render
/// identical values + tooltips for identical input.
public enum DriveAnalyticsSectionFormat {
    /// `safeNumber` (numberFormat.ts): non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// JavaScript `Math.round` semantics (round half toward +∞): `floor(x + 0.5)`. The web rounds each
    /// drive's display distance for the scatter x value.
    public static func jsRound(_ value: Double) -> Double {
        (safeNumber(value) + 0.5).rounded(.down)
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped (tooltip / value text only).
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

    /// `formatDateShort(iso)` (lib/dateFormat.ts): a locale-aware short "MMM d" (e.g. "Apr 4"),
    /// returning the em-dash sentinel for an empty / unparseable input (web `FALLBACK = '—'`).
    public static func dateShort(
        _ iso: String,
        localeIdentifier: String = "en_US",
        timeZone: TimeZone = .current,
        emDash: String = "—"
    ) -> String {
        guard let parsed = parseTimestamp(iso) else { return emDash }
        let locale = Locale(identifier: localeIdentifier)
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: parsed)
    }

    /// Parses the backend's ISO-8601 timestamp (web `new Date(iso)`), tolerating the fractional-seconds
    /// and whole-second forms, and falling back to a plain `YYYY-MM-DD` day key.
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

// MARK: - Speed bucket ranges (web `SPEED_BUCKETS_RANGES`)

/// One speed bucket's bounds + label (web `SPEED_BUCKETS_RANGES` entry). `upper == .infinity` is the
/// open top bucket. The label is the numeric range glyph the web hardcodes (en-dash separated).
private struct DriveAnalyticsSpeedRange {
    let lower: Double
    let upper: Double
    let label: String
}

// MARK: - Projector (pure)

/// The dependency-free projection from a resolved `DriveAnalyticsSectionData` to the three chart series.
/// Every value uses the same arithmetic as the web component so the web and native charts agree.
public enum DriveAnalyticsSectionProjector {
    /// The web `SPEED_BUCKETS_RANGES` constant (en-dash range labels, open top bucket).
    private static let speedRanges: [DriveAnalyticsSpeedRange] = [
        DriveAnalyticsSpeedRange(lower: 0, upper: 30, label: "0–30"),
        DriveAnalyticsSpeedRange(lower: 30, upper: 60, label: "30–60"),
        DriveAnalyticsSpeedRange(lower: 60, upper: 90, label: "60–90"),
        DriveAnalyticsSpeedRange(lower: 90, upper: 120, label: "90–120"),
        DriveAnalyticsSpeedRange(lower: 120, upper: .infinity, label: "120+")
    ]

    /// The most-recent window the power profile plots (web `filteredDrives.slice(-20)`).
    private static let powerProfileWindow = 20

    /// Builds the projection. `nil` data reproduces the web parent's "no drives" branch (the caller maps
    /// that to the surface empty phase).
    public static func project(
        data: DriveAnalyticsSectionData?,
        copy: DriveAnalyticsSectionCopy = .fallback,
        localeIdentifier: String = "en_US",
        timeZone: TimeZone = .current
    ) -> DriveAnalyticsSectionProjection {
        guard let data else { return .empty }
        let accel = accelPatterns(from: data)
        return DriveAnalyticsSectionProjection(
            speedDistribution: speedDistribution(from: data),
            accelPatterns: accel,
            accelAverage: average(of: accel),
            powerProfile: powerProfile(from: data, copy: copy, locale: localeIdentifier, timeZone: timeZone),
            distanceUnit: data.units.distanceUnit,
            kilowattUnit: copy.kilowattUnit
        )
    }

    /// Resolves the surface phase, mirroring the web parent precedence (loading → error → body): a
    /// resolved-but-driveless window is the empty state, present drives are content with the charts.
    public static func resolvePhase(
        _ status: DriveAnalyticsSectionLoadStatus,
        hasDrives: Bool
    ) -> DriveAnalyticsSectionPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasDrives ? .content : .empty
        }
    }

    // MARK: Speed distribution (web `speedDistribution` useMemo)

    private static func speedDistribution(
        from data: DriveAnalyticsSectionData
    ) -> [DriveAnalyticsSectionSpeedBucket] {
        let units = data.units
        var counts = [Int](repeating: 0, count: speedRanges.count)
        for drive in data.drives {
            guard let metersPerSecond = drive.avgSpeedMps else { continue }
            let displaySpeed = units.toSpeedDisplay(metersPerSecond)
            for index in speedRanges.indices {
                let range = speedRanges[index]
                let upper = range.upper == .infinity ? Double.infinity : units.toSpeedDisplay(range.upper)
                let lower = units.toSpeedDisplay(range.lower)
                if displaySpeed >= lower, displaySpeed < upper {
                    counts[index] += 1
                    break
                }
            }
        }
        return speedRanges.enumerated().map { index, range in
            DriveAnalyticsSectionSpeedBucket(range: "\(range.label) \(units.speedUnit)", count: counts[index])
        }
    }

    // MARK: Acceleration patterns (web `accelPatterns` useMemo)

    private static func accelPatterns(
        from data: DriveAnalyticsSectionData
    ) -> [DriveAnalyticsSectionAccelPoint] {
        let units = data.units
        var points: [DriveAnalyticsSectionAccelPoint] = []
        for (offset, drive) in data.drives.enumerated() {
            guard let watts = drive.avgPowerW else { continue }
            points.append(
                DriveAnalyticsSectionAccelPoint(
                    id: offset,
                    distance: DriveAnalyticsSectionFormat.jsRound(units.toDistanceDisplay(drive.distanceM)),
                    powerMax: watts / 1000
                )
            )
        }
        return points
    }

    /// Mean of the scatter points' peak power (web `ReferenceLine` y), or `nil` when there are none.
    private static func average(of points: [DriveAnalyticsSectionAccelPoint]) -> Double? {
        guard !points.isEmpty else { return nil }
        let total = points.reduce(0) { $0 + $1.powerMax }
        return total / Double(points.count)
    }

    // MARK: Power profile (web `powerProfile` useMemo)

    private static func powerProfile(
        from data: DriveAnalyticsSectionData,
        copy: DriveAnalyticsSectionCopy,
        locale: String,
        timeZone: TimeZone
    ) -> [DriveAnalyticsSectionPowerPoint] {
        let recent = data.drives.suffix(powerProfileWindow)
        return recent.enumerated().map { offset, drive in
            DriveAnalyticsSectionPowerPoint(
                index: offset + 1,
                label: DriveAnalyticsSectionFormat.dateShort(
                    drive.startTs,
                    localeIdentifier: locale,
                    timeZone: timeZone,
                    emDash: copy.emDash
                ),
                powerMax: DriveAnalyticsSectionFormat.safeNumber((drive.avgPowerW ?? 0) / 1000),
                powerMin: 0
            )
        }
    }
}
