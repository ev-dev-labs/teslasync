//
//  DrivingCoachSection.Adapter.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  The testable projection core for the driving-dynamics "Driving Coach" section — the faithful port of
//  features/driving/components/driving-dynamics/DrivingCoachSection.tsx. `DrivingCoachFormat` mirrors the
//  web `fmtNumber` (lib/numberFormat.ts) + `formatDateShort` (lib/dateFormat.ts) helpers;
//  `DrivingCoachProjector` reproduces the component's render pipeline VERBATIM (the score gauge banding,
//  the style-breakdown split, the five threshold pattern bars + their `lo` / `hi` cutoffs, the weekly-trend
//  series, the recommendation rows, and the per-drive table rows). Foundation-only so it is unit-tested
//  without a bundle or a rendered view.
//

import Foundation

// MARK: - Number + date formatting (ports of numberFormat.ts / dateFormat.ts)

/// Pure formatting helpers mirroring the web numeric pipeline so the native and web surfaces render
/// identical values for identical input. The web global precision is 2 and `safeNumber` coerces non-finite
/// input to 0; both are reproduced here.
public enum DrivingCoachFormat {
    /// The em-dash sentinel the web renders for a missing / unparseable value.
    public static let dash = "—"

    /// `safeNumber` (numberFormat.ts): non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals)` — locale grouping, fixed fraction digits, half-away rounding (web
    /// `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, localeIdentifier: String = "en_US") -> String {
        formatted(
            safeNumber(value),
            minimumFractionDigits: max(0, decimals),
            maximumFractionDigits: max(0, decimals),
            localeIdentifier: localeIdentifier
        )
    }

    /// `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func integer(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// `fmtPercent(v)` — `fmtNumber(v)` with a trailing `%` (web `${fmtNumber(p.value)}%`).
    public static func percent(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, localeIdentifier: localeIdentifier) + "%"
    }

    /// `${fmtNumber(v)} ${unit}` — the web's spaced value + unit (e.g. `"150.00 Wh/km"`, `"12.00 km"`).
    public static func withUnit(_ value: Double, _ unit: String, localeIdentifier: String = "en_US") -> String {
        number(value, localeIdentifier: localeIdentifier) + " " + unit
    }

    /// The bare JSX `{number}` score rendering: an integer shows no fraction, a fractional score keeps up to
    /// the global precision (2) without trailing zeros — matching JavaScript's default number stringification
    /// for these 0-100 scores.
    public static func scoreLabel(_ value: Double, localeIdentifier: String = "en_US") -> String {
        formatted(
            safeNumber(value),
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
            localeIdentifier: localeIdentifier
        )
    }

    /// `formatDateShort(iso)` (lib/dateFormat.ts): a locale-aware short "MMM d" (e.g. "Apr 4"), returning the
    /// injected em-dash sentinel for an empty / unparseable input (web `FALLBACK = '—'`).
    public static func dateShort(
        _ iso: String,
        localeIdentifier: String = "en_US",
        timeZone: TimeZone = .current,
        emDash: String = "—"
    ) -> String {
        guard let parsed = parseTimestamp(iso) else { return emDash }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: parsed)
    }

    /// The drive's sort key — its epoch seconds (web sorts the table on the raw `date`). An unparseable date
    /// sorts as the epoch (0) so malformed rows cluster predictably rather than crashing.
    public static func epochSeconds(_ iso: String) -> Double {
        parseTimestamp(iso)?.timeIntervalSince1970 ?? 0
    }

    private static func formatted(
        _ value: Double,
        minimumFractionDigits: Int,
        maximumFractionDigits: Int,
        localeIdentifier: String
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = minimumFractionDigits
        formatter.maximumFractionDigits = maximumFractionDigits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(maximumFractionDigits)f", value)
    }

    /// Parses the backend's ISO-8601 timestamp (web `new Date(iso)`), tolerating the fractional-seconds and
    /// whole-second forms, and falling back to a plain `YYYY-MM-DD` day key.
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

// MARK: - Pattern threshold table (web `patterns` array)

/// One driving-pattern descriptor — the i18n key + web fallback label, the value accessor, and the web's
/// per-pattern `lo` / `hi` colour cutoffs. `Sendable` is inferred (non-public, all-`Sendable` members) so
/// the static `patternSpecs` table is concurrency-safe under Swift 6 strict concurrency.
private struct DrivingCoachPatternSpec {
    let key: String
    let fallback: String
    let value: @Sendable (DrivingCoachPatterns) -> Double
    let lo: Double
    let hi: Double
}

// MARK: - Projector (pure)

/// The dependency-free projection from a resolved `DrivingCoachData` to the view-ready `DrivingCoachSectionProjection`.
/// Every value uses the same arithmetic as the web component so the native surface shows the exact same
/// numbers as the web one.
public enum DrivingCoachProjector {
    /// The five driving-pattern bars (web `patterns` array), with their fixed `lo` / `hi` thresholds.
    private static let patternSpecs: [DrivingCoachPatternSpec] = [
        DrivingCoachPatternSpec(
            key: "dynamics.coach.hardAccel", fallback: "Hard Acceleration",
            value: { $0.hardAccelPct }, lo: 20, hi: 40
        ),
        DrivingCoachPatternSpec(
            key: "dynamics.coach.hardBrake", fallback: "Hard Braking",
            value: { $0.hardBrakePct }, lo: 15, hi: 30
        ),
        DrivingCoachPatternSpec(
            key: "dynamics.coach.highway", fallback: "Highway Driving",
            value: { $0.highwayPct }, lo: 50, hi: 70
        ),
        DrivingCoachPatternSpec(
            key: "dynamics.coach.shortTrips", fallback: "Short Trips (<5 km)",
            value: { $0.shortTripPct }, lo: 30, hi: 50
        ),
        DrivingCoachPatternSpec(
            key: "dynamics.coach.coldStarts", fallback: "Cold Starts",
            value: { $0.coldStartPct }, lo: 15, hi: 30
        )
    ]

    private static let styleOrder: [DrivingCoachStyle] = [.efficient, .moderate, .aggressive]

    /// Whether the surface has analysable content (web parent → the coach panels). A `nil` payload or a zero
    /// analysed-drive count maps to the resolved-but-empty surface state.
    public static func hasContent(_ data: DrivingCoachData?) -> Bool {
        guard let data else { return false }
        return data.totalDrivesAnalyzed > 0
    }

    /// Resolves the surface phase, mirroring the web parent precedence (loading → error → body): a
    /// resolved-but-empty payload is the empty state, an analysed payload is content with the full
    /// composition.
    public static func resolvePhase(
        _ status: DrivingCoachSectionLoadStatus,
        hasContent: Bool
    ) -> DrivingCoachPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasContent ? .content : .empty
        }
    }

    /// Builds the full projection. `nil` data yields the all-zero empty state (the caller renders the empty
    /// state, not this projection).
    public static func project(
        data: DrivingCoachData?,
        copy: DrivingCoachCopy = .fallback,
        localeIdentifier: String = "en_US",
        timeZone: TimeZone = .current
    ) -> DrivingCoachSectionProjection {
        guard let data else { return .empty }
        return DrivingCoachSectionProjection(
            gauge: gauge(from: data, localeIdentifier: localeIdentifier),
            drivesAnalyzed: data.totalDrivesAnalyzed,
            styleBreakdown: styleBreakdown(from: data),
            avgEfficiencyText: DrivingCoachFormat.withUnit(
                data.efficiencyWhKm, copy.efficiencyUnit, localeIdentifier: localeIdentifier
            ),
            bestEfficiencyText: DrivingCoachFormat.withUnit(
                data.bestEfficiencyWhKm, copy.efficiencyUnit, localeIdentifier: localeIdentifier
            ),
            patterns: patterns(from: data.patterns, localeIdentifier: localeIdentifier),
            trend: data.weeklyTrend.map { DrivingCoachTrendPoint(week: $0.week, score: $0.score) },
            recommendations: data.recommendations.map {
                DrivingCoachRecommendationRow(id: $0.id, impact: $0.impact, tip: $0.tip)
            },
            perDriveRows: data.perDriveScores.map {
                driveRow(from: $0, copy: copy, localeIdentifier: localeIdentifier, timeZone: timeZone)
            }
        )
    }

    // MARK: Score gauge (web `RadialGauge` value + colour)

    private static func gauge(
        from data: DrivingCoachData,
        localeIdentifier: String
    ) -> DrivingCoachGauge {
        let score = data.overallScore
        return DrivingCoachGauge(
            score: score,
            scoreText: DrivingCoachFormat.scoreLabel(score, localeIdentifier: localeIdentifier),
            fraction: clampUnit(DrivingCoachFormat.safeNumber(score) / 100),
            band: DrivingCoachBand.score(score)
        )
    }

    // MARK: Style breakdown (web split bar + legend)

    private static func styleBreakdown(from data: DrivingCoachData) -> DrivingCoachStyleBreakdownVM {
        let total = data.totalDrivesAnalyzed
        let hasData = total > 0
        let segments: [DrivingCoachStyleSegment] = hasData
            ? styleOrder.compactMap { style in
                let fraction = clampUnit(Double(data.styleBreakdown.count(for: style)) / Double(total))
                return fraction > 0 ? DrivingCoachStyleSegment(style: style, fraction: fraction) : nil
            }
            : []
        let legend = styleOrder.map {
            DrivingCoachStyleLegendRow(style: $0, count: data.styleBreakdown.count(for: $0))
        }
        return DrivingCoachStyleBreakdownVM(hasData: hasData, segments: segments, legend: legend)
    }

    // MARK: Pattern bars (web `patterns.map`)

    private static func patterns(
        from patterns: DrivingCoachPatterns,
        localeIdentifier: String
    ) -> [DrivingCoachPatternRow] {
        patternSpecs.map { spec in
            let value = spec.value(patterns)
            return DrivingCoachPatternRow(
                labelKey: spec.key,
                labelFallback: spec.fallback,
                valueText: DrivingCoachFormat.percent(value, localeIdentifier: localeIdentifier),
                fraction: clampUnit(min(100, DrivingCoachFormat.safeNumber(value)) / 100),
                band: DrivingCoachBand.pattern(value: value, lo: spec.lo, hi: spec.hi)
            )
        }
    }

    // MARK: Per-drive row (web `DataTable` row)

    private static func driveRow(
        from drive: DrivingCoachDriveScore,
        copy: DrivingCoachCopy,
        localeIdentifier: String,
        timeZone: TimeZone
    ) -> DrivingCoachDriveRow {
        DrivingCoachDriveRow(
            id: drive.id,
            dateText: DrivingCoachFormat.dateShort(
                drive.date, localeIdentifier: localeIdentifier, timeZone: timeZone, emDash: copy.emDash
            ),
            dateSortValue: DrivingCoachFormat.epochSeconds(drive.date),
            score: drive.score,
            scoreText: DrivingCoachFormat.scoreLabel(drive.score, localeIdentifier: localeIdentifier),
            scoreBand: DrivingCoachBand.score(drive.score),
            style: drive.style,
            efficiency: drive.efficiency,
            efficiencyText: DrivingCoachFormat.number(drive.efficiency, localeIdentifier: localeIdentifier),
            distance: drive.distance,
            distanceText: DrivingCoachFormat.withUnit(
                drive.distance, copy.distanceUnit, localeIdentifier: localeIdentifier
            )
        )
    }

    private static func clampUnit(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(max(value, 0), 1)
    }
}
