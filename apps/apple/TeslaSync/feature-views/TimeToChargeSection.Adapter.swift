//
//  TimeToChargeSection.Adapter.swift
//  TeslaSync — P4 feature view · 0094 · TimeToChargeSection (Apple)
//
//  The testable projection core for the time-to-charge analysis section — the
//  SwiftUI parity of the data half of
//  web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx.
//  Everything here is pure + dependency-free (no store, no bundle, no rendered
//  view): the DC-session classification, the 10→80 / 20→80 average-duration math,
//  the fastest/slowest charge-rate reduction, the per-year trend grouping, the
//  number formatting (numberFormat.ts `fmtNumber`), the SI energy conversion
//  (unitConversion.ts `convertEnergyFromSI`), and the per-state presentation
//  resolver are all unit-tested in isolation.
//
//  Parity note on composition: the web section also renders a `YearlyTrendChart`
//  child. In the native decomposition that chart is its own sibling surface (this
//  prompt scopes the title + description + four metric cards). So this core still
//  computes the full `yearlyTrend` series — it is part of THIS section's data and
//  the sibling chart binds to it — while the rendered surface here is the
//  four-card summary. The trend math is fully covered by the adapter tests.
//

import Foundation

// MARK: - Pure formatting (ports of helpers.ts + numberFormat.ts + unitConversion.ts)

/// Pure numeric helpers ported verbatim from the web so the bucket boundaries,
/// rounding, and unit conversion match the source exactly.
public enum TimeToChargeFormat {
    /// The em-dash sentinel the web card renders for a `nil` value (`value ?? '—'`).
    public static let dash = "—"

    /// Port of `helpers.ts durationMinutes`: `0` when there is no end timestamp,
    /// when either timestamp is unparseable, or when the end is not strictly after
    /// the start; otherwise the elapsed whole minutes, rounded to nearest (web
    /// `Math.round((end - start) / 60000)`).
    public static func durationMinutes(startedAt: String, endedAt: String?) -> Int {
        guard let endedAt, !endedAt.isEmpty else { return 0 }
        guard let start = parseISO(startedAt), let end = parseISO(endedAt) else { return 0 }
        let startSeconds = start.timeIntervalSince1970
        let endSeconds = end.timeIntervalSince1970
        guard endSeconds > startSeconds else { return 0 }
        return Int(((endSeconds - startSeconds) / 60).rounded())
    }

    /// Port of `helpers.ts avg`: the arithmetic mean, or `0` for an empty input.
    public static func average(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }

    /// Port of `unitConversion.ts convertEnergyFromSI(wh, 'kWh')`: `wh / 1000`.
    public static func kilowattHours(fromWh wh: Double) -> Double {
        wh / 1000
    }

    /// Port of `numberFormat.ts fmtNumber(v)`: locale grouping with a fixed
    /// fraction-digit count (the web default is 2), non-finite coerced to `0`
    /// (web `safeNumber`), ties rounded away from zero (web `toLocaleString`).
    public static func number(_ value: Double, fractionDigits: Int = 2, locale: Locale = .current) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? "0"
    }

    /// Rounds to one decimal place the way the web `yearlyTrend` does
    /// (`Math.round(value * 10) / 10`), ties away from zero.
    public static func roundToTenth(_ value: Double) -> Double {
        (value * 10).rounded() / 10
    }

    private static func parseISO(_ raw: String) -> Date? {
        guard !raw.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: raw) { return date }
        if let epoch = Double(raw) { return Date(timeIntervalSince1970: epoch) }
        return nil
    }
}

// MARK: - Metrics projection (port of the web `useMemo`)

/// The faithful port of the web component's `timeToCharge` `useMemo`: classifies
/// DC sessions, computes the two band averages, reduces the fastest/slowest
/// charge rate, and groups the per-year trend. Pure + unit-tested.
public enum TimeToChargeProjection {
    /// Whether a session is DC fast charging (web `helpers.ts isDcSession`): it
    /// has a non-empty charger type, or a peak power above 20 kW.
    public static func isDcSession(_ session: TimeToChargeSectionChargingSessionSummary) -> Bool {
        if let chargerType = session.chargerType, !chargerType.isEmpty { return true }
        return (session.peakPowerW ?? 0) > 20000
    }

    /// Builds the resolved metrics from the sessions (web `timeToCharge` memo).
    public static func metrics(from sessions: [TimeToChargeSectionChargingSessionSummary]) -> TimeToChargeMetrics {
        guard !sessions.isEmpty else { return .empty }
        let dcSessions = sessions.filter(isDcSession)
        guard !dcSessions.isEmpty else { return .empty }

        let rates = chargeRates(dcSessions)
        return TimeToChargeMetrics(
            avg10to80: bandAverage(dcSessions, startCeiling: 10),
            avg20to80: bandAverage(dcSessions, startCeiling: 20),
            fastest: extremum(rates, keepWhenRateIsGreater: true),
            slowest: extremum(rates, keepWhenRateIsGreater: false),
            yearlyTrend: yearlyTrend(dcSessions)
        )
    }

    /// Whether a session crosses the `start <= ceiling` and `end >= 80` band
    /// (web `start_soc_pct <= n && (end_soc_pct ?? 0) >= 80`).
    private static func crosses(_ session: TimeToChargeSectionChargingSessionSummary, startCeiling: Double) -> Bool {
        session.startSocPct <= startCeiling && (session.endSocPct ?? 0) >= 80
    }

    /// The average crossing-session duration for a band, or `nil` when none cross
    /// (web `cross.length ? avg(...) : null`).
    private static func bandAverage(_ dcSessions: [TimeToChargeSectionChargingSessionSummary], startCeiling: Double) -> Double? {
        let crossing = dcSessions.filter { crosses($0, startCeiling: startCeiling) }
        guard !crossing.isEmpty else { return nil }
        let durations = crossing.map {
            Double(TimeToChargeFormat.durationMinutes(startedAt: $0.startedAt, endedAt: $0.endedAt))
        }
        return TimeToChargeFormat.average(durations)
    }

    /// The kWh/h charge rate for each session with a positive duration and added
    /// energy (web `withRate`): `(kWh / minutes) * 60`.
    private static func chargeRates(_ dcSessions: [TimeToChargeSectionChargingSessionSummary]) -> [ChargeRateRef] {
        dcSessions.compactMap { session in
            let minutes = TimeToChargeFormat.durationMinutes(startedAt: session.startedAt, endedAt: session.endedAt)
            guard minutes > 0, session.totalEnergyAddedWh > 0 else { return nil }
            let kwh = TimeToChargeFormat.kilowattHours(fromWh: session.totalEnergyAddedWh)
            return ChargeRateRef(id: session.id, rate: (kwh / Double(minutes)) * 60)
        }
    }

    /// The fastest/slowest rate (web `reduce((a, b) => a.rate > b.rate ? a : b)`
    /// and `… a.rate < b.rate ? a : b`). The web ternary returns `b` whenever the
    /// strict comparison is false — so on a rate tie the *later* element wins. The
    /// non-strict comparison below reproduces that left-fold exactly.
    private static func extremum(_ rates: [ChargeRateRef], keepWhenRateIsGreater: Bool) -> ChargeRateRef? {
        guard var best = rates.first else { return nil }
        for candidate in rates.dropFirst() {
            let candidateWins = keepWhenRateIsGreater
                ? candidate.rate >= best.rate
                : candidate.rate <= best.rate
            if candidateWins { best = candidate }
        }
        return best
    }

    /// The per-year trend series (web `byYear` map → sorted `yearlyTrend`).
    private static func yearlyTrend(_ dcSessions: [TimeToChargeSectionChargingSessionSummary]) -> [YearlyTrendPoint] {
        struct Bucket {
            var d10: [Double] = []
            var d20: [Double] = []
            var count = 0
        }

        var byYear: [String: Bucket] = [:]
        for session in dcSessions {
            let year = String(session.startedAt.prefix(4))
            var bucket = byYear[year] ?? Bucket()
            bucket.count += 1
            let minutes = Double(
                TimeToChargeFormat.durationMinutes(startedAt: session.startedAt, endedAt: session.endedAt)
            )
            if crosses(session, startCeiling: 10) { bucket.d10.append(minutes) }
            if crosses(session, startCeiling: 20) { bucket.d20.append(minutes) }
            byYear[year] = bucket
        }

        return byYear.keys.sorted().map { year in
            let bucket = byYear[year] ?? Bucket()
            return YearlyTrendPoint(
                year: year,
                avg10to80: TimeToChargeFormat.roundToTenth(TimeToChargeFormat.average(bucket.d10)),
                avg20to80: TimeToChargeFormat.roundToTenth(TimeToChargeFormat.average(bucket.d20)),
                count: bucket.count
            )
        }
    }
}

// MARK: - Card building (web `<TimeToChargeCard>` wiring)

/// Builds the four cards from the resolved metrics (web card wiring). The
/// duration cards show `min` and keep their `Avg duration` subtitle; the rate
/// cards show `kWh/h` and a `Session #{id}` subtitle only when a rate exists. A
/// `nil` figure becomes the card's em-dash (web `value ?? '—'`).
public enum TimeToChargeCards {
    public static func make(from metrics: TimeToChargeMetrics, locale: Locale = .current) -> [TimeToChargeCardModel] {
        [
            durationCard(.band10, minutes: metrics.avg10to80, locale: locale),
            durationCard(.band20, minutes: metrics.avg20to80, locale: locale),
            rateCard(.fastestSpec, rate: metrics.fastest, locale: locale),
            rateCard(.slowestSpec, rate: metrics.slowest, locale: locale)
        ]
    }

    /// The static label/accent wiring for a duration card, so the builder takes a
    /// single spec plus the dynamic minutes (keeping the parameter list small).
    private struct DurationSpec {
        let id: String
        let labelKey: String
        let labelFallback: String
        let accent: TimeToChargeAccent

        static let band10 = DurationSpec(
            id: "avg10to80", labelKey: "charging.curve.avg10to80",
            labelFallback: "10% → 80%", accent: .band10
        )
        static let band20 = DurationSpec(
            id: "avg20to80", labelKey: "charging.curve.avg20to80",
            labelFallback: "20% → 80%", accent: .band20
        )
    }

    /// The static label/accent/symbol wiring for a rate card.
    private struct RateSpec {
        let id: String
        let labelKey: String
        let labelFallback: String
        let accent: TimeToChargeAccent
        let symbol: String

        static let fastestSpec = RateSpec(
            id: "fastest", labelKey: "charging.curve.fastest",
            labelFallback: "Fastest Session", accent: .fastest, symbol: "bolt.fill"
        )
        static let slowestSpec = RateSpec(
            id: "slowest", labelKey: "charging.curve.slowest",
            labelFallback: "Slowest Session", accent: .slowest, symbol: "tortoise.fill"
        )
    }

    private static func durationCard(_ spec: DurationSpec, minutes: Double?, locale: Locale) -> TimeToChargeCardModel {
        TimeToChargeCardModel(
            id: spec.id,
            labelKey: spec.labelKey,
            labelFallback: spec.labelFallback,
            value: minutes.map { TimeToChargeFormat.number($0, locale: locale) },
            unitKey: "charging.curve.unit.min",
            unitFallback: "min",
            subtitleKey: "charging.curve.avgDuration",
            subtitleFallback: "Avg duration",
            subtitleSessionID: nil,
            accent: spec.accent,
            symbol: "clock.fill"
        )
    }

    private static func rateCard(_ spec: RateSpec, rate: ChargeRateRef?, locale: Locale) -> TimeToChargeCardModel {
        TimeToChargeCardModel(
            id: spec.id,
            labelKey: spec.labelKey,
            labelFallback: spec.labelFallback,
            value: rate.map { TimeToChargeFormat.number($0.rate, locale: locale) },
            unitKey: "charging.curve.unit.kwhPerHour",
            unitFallback: "kWh/h",
            subtitleKey: rate != nil ? "charging.curve.sessionId" : nil,
            subtitleFallback: rate != nil ? "Session #%lld" : nil,
            subtitleSessionID: rate?.id,
            accent: spec.accent,
            symbol: spec.symbol
        )
    }
}

// MARK: - Presentation resolver (every state)

public extension TimeToChargePresentation {
    /// Pure mapping from the cache-then-network load state (ADR-013) to a
    /// render-ready presentation. Cached sessions stay visible behind a
    /// refresh/error; a resolved-but-empty session set becomes the friendly
    /// empty state (never a blank box).
    static func resolve(
        state: TimeToChargeLoadState<[TimeToChargeSectionChargingSessionSummary]>,
        locale: Locale = .current
    ) -> TimeToChargePresentation {
        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            guard let cached, !cached.isEmpty else { return .loading }
            return content(cached, freshness: stale ? .stale : .live, refreshing: true, locale: locale)
        case let .loaded(sessions, stale):
            return sessions.isEmpty
                ? .empty
                : content(sessions, freshness: stale ? .stale : .live, refreshing: false, locale: locale)
        case .empty:
            return .empty
        case let .failed(error, cached, stale):
            return resolveFailure(error, cached: cached, stale: stale, locale: locale)
        }
    }

    private static func content(
        _ sessions: [TimeToChargeSectionChargingSessionSummary],
        freshness: TimeToChargeFreshness,
        refreshing: Bool,
        locale: Locale
    ) -> TimeToChargePresentation {
        let metrics = TimeToChargeProjection.metrics(from: sessions)
        return .content(TimeToChargeContent(
            cards: TimeToChargeCards.make(from: metrics, locale: locale),
            metrics: metrics,
            freshness: freshness,
            refreshing: refreshing
        ))
    }

    private static func resolveFailure(
        _ error: TimeToChargeError,
        cached: [TimeToChargeSectionChargingSessionSummary]?,
        stale: Bool,
        locale: Locale
    ) -> TimeToChargePresentation {
        if error == .offline {
            guard let cached, !cached.isEmpty else { return .offlineNoData }
            return content(cached, freshness: .offline, refreshing: false, locale: locale)
        }
        if let cached, !cached.isEmpty {
            return content(cached, freshness: stale ? .stale : .live, refreshing: false, locale: locale)
        }
        return .error(retryable: error.isRetryable)
    }
}

// MARK: - Responsive layout (web `grid-cols-2 lg:grid-cols-4`)

/// The responsive column math, ported from the web Tailwind grid so it is unit
/// testable and identical across iPhone / iPad / Mac widths. The web section uses
/// `grid-cols-2 lg:grid-cols-4`; Tailwind `lg` is 1024 CSS px.
public enum TimeToChargeLayout {
    public static let lgBreakpoint: CGFloat = 1024

    /// Columns for an available width: 4 at/above `lg`, otherwise 2.
    public static func columnCount(forWidth width: CGFloat) -> Int {
        width >= lgBreakpoint ? 4 : 2
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the combined VoiceOver string for a card so the spoken content is
/// asserted without rendering the view: "{label}, {value} {unit}" (or the em-dash
/// when there is no value), plus the optional subtitle.
public enum TimeToChargeAccessibility {
    public static func cardLabel(label: String, value: String?, unit: String, subtitle: String?) -> String {
        let valuePart = value.map { "\($0) \(unit)" } ?? TimeToChargeFormat.dash
        var parts = ["\(label), \(valuePart)"]
        if let subtitle, !subtitle.isEmpty { parts.append(subtitle) }
        return parts.joined(separator: ", ")
    }
}
