//
//  BatteryDegradationForecastWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0011 · BatteryDegradationForecastWidget (Apple)
//
//  Pure cached→projection adapter — a faithful Swift port of the derivations in
//  features/dashboard/widgets/BatteryDegradationForecastWidget.tsx: the
//  `healthTier` / `scoreToImpact` / `riskIcon` classifiers, the `hasData`
//  predicate, the projected-date formatting (web
//  `Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short' })`), and the
//  `fmtNumber` number formatting. State-of-health, the degradation rate and the
//  risk score are unitless, so there is no SI→display conversion here. No SwiftUI
//  / transport — this is the unit-tested core.
//

import Foundation

// MARK: - Number + date formatting (web `fmtNumber` / `Intl.DateTimeFormat`)

/// Locale-aware formatting for the surface, kept pure so the rendered strings can
/// be asserted deterministically with an explicit locale + time zone. Matches the
/// web `fmtNumber(value, digits)` grouping/rounding and the projected-date
/// `Intl.DateTimeFormat` month/year output.
public enum BatteryDegradationForecastFormat {
    /// U+2212 MINUS SIGN — the exact glyph the web prefixes the degradation rate
    /// with (`−${fmtNumber(rate, 2)}%`), not an ASCII hyphen.
    public static let minusSign = "\u{2212}"
    /// U+2014 EM DASH — the web fallback glyph for a missing value (`'—'`).
    public static let emDash = "\u{2014}"

    /// Grouped, fixed-fraction decimal matching web `fmtNumber(value, digits)`.
    /// Half-up (away from zero) so display matches `Intl.toLocaleString`, not
    /// `NumberFormatter`'s default banker's rounding. Non-finite → em dash.
    public static func number(_ value: Double, digits: Int, locale: Locale = .current) -> String {
        guard value.isFinite else { return emDash }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.usesGroupingSeparator = true
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(digits)f", value)
    }

    /// State-of-health value: `"92.5%"`, or `"—"` when absent (web
    /// `currentHealthPct != null ? `${fmtNumber(currentHealthPct, 1)}%` : '—'`).
    public static func healthValue(_ health: Double?, locale: Locale = .current) -> String {
        guard let health, health.isFinite else { return emDash }
        return "\(number(health, digits: 1, locale: locale))%"
    }

    /// Degradation rate value: `"−0.42%"` (web `−${fmtNumber(rate, 2)}%`). Only
    /// shown by the view when the rate is present and positive.
    public static func degradationRate(_ rate: Double, locale: Locale = .current) -> String {
        guard rate.isFinite else { return emDash }
        return "\(minusSign)\(number(rate, digits: 2, locale: locale))%"
    }

    /// Risk-score badge value: a whole number (web `fmtNumber(rf.score, 0)`).
    public static func riskScore(_ score: Double, locale: Locale = .current) -> String {
        guard score.isFinite else { return emDash }
        return number(score, digits: 0, locale: locale)
    }

    /// The projected 80%-capacity date formatted as a localized short month +
    /// numeric year (web `Intl.DateTimeFormat(locale, { year: 'numeric', month:
    /// 'short' })`), e.g. `"Apr 2027"`. Returns the em dash when no date is
    /// projected (web `'—'`).
    public static func projectedDate(
        _ date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return emDash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMM")
        return formatter.string(from: date)
    }
}

// MARK: - Classifiers (port of web `healthTier` / `scoreToImpact` / `riskIcon`)

/// Pure classifiers + the cached→projection builder, a faithful Swift port of the
/// web component's `healthTier`, `scoreToImpact`, `riskIcon`, the `hasData`
/// predicate and the derived render inputs.
public enum BatteryDegradationForecastBuilder {
    /// Classifies a degradation rate (% per month) into a health tier — the Swift
    /// port of the web `healthTier`: ≤ 0.05 healthy, ≤ 0.12 normal, else
    /// accelerated. A non-finite rate falls back to the healthiest tier.
    public static func tier(forRate rate: Double) -> BatteryDegradationForecastHealthTier {
        guard rate.isFinite else { return .healthy }
        if rate <= 0.05 { return .healthy }
        if rate <= 0.12 { return .normal }
        return .accelerated
    }

    /// Classifies a 0…10 risk score into an impact level — the Swift port of the
    /// web `scoreToImpact`: ≥ 7 high, ≥ 4 medium, else low.
    public static func impact(forScore score: Double) -> BatteryDegradationForecastImpact {
        guard score.isFinite else { return .low }
        if score >= 7 { return .high }
        if score >= 4 { return .medium }
        return .low
    }

    /// Maps a risk-factor name to its SF Symbol — the Swift port of the web
    /// `riskIcon`: temperature / heat / thermal → thermometer; charge / fast / dc
    /// → bolt; battery / soc / depth → battery; otherwise the warning triangle.
    public static func riskSymbol(forName name: String) -> String {
        let lower = name.lowercased()
        if lower.contains("temp") || lower.contains("heat") || lower.contains("thermal") {
            return "thermometer.medium"
        }
        if lower.contains("charge") || lower.contains("fast") || lower.contains("dc") {
            return "bolt.fill"
        }
        if lower.contains("battery") || lower.contains("soc") || lower.contains("depth") {
            return "minus.plus.batteryblock.fill"
        }
        return "exclamationmark.triangle.fill"
    }

    /// Builds the projection from a cached snapshot: resolve state-of-health (web
    /// `current_health_pct ?? current_health`), default the rate to 0 (web
    /// `?? 0`), classify the tier, and resolve `hasData` exactly as the web
    /// component does (`currentHealthPct != null || projected_80pct_date != null`).
    public static func buildProjection(
        snapshot: BatteryDegradationForecastSnapshot
    ) -> BatteryDegradationForecastProjection {
        let resolvedHealth = snapshot.resolvedHealth
        let rate = snapshot.degradationRatePctPerMonth ?? 0
        let hasData = resolvedHealth != nil || snapshot.projected80Date != nil
        return BatteryDegradationForecastProjection(
            currentHealth: resolvedHealth,
            rate: rate,
            tier: tier(forRate: rate),
            projected80Date: snapshot.projected80Date,
            riskFactors: snapshot.riskFactors,
            recommendations: snapshot.recommendations,
            hasData: hasData
        )
    }

    /// The status colour family a tier maps to (web Badge `variant`):
    /// healthy → success, normal → warning, accelerated → danger.
    public static func impact(forTier tier: BatteryDegradationForecastHealthTier) -> BatteryDegradationForecastImpact {
        switch tier {
        case .healthy: .low
        case .normal: .medium
        case .accelerated: .high
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver strings spoken for the surface + its rows. Pure + public
/// so the a11y content can be unit-tested without rendering the view. The
/// `localize` closure mirrors the web `t(key, default)` so tests can echo the
/// fallback while the app resolves the catalog.
public enum BatteryDegradationForecastAccessibility {
    /// The header/hero summary, e.g. "Battery Forecast. Projected 80% Capacity
    /// Apr 2027. Healthy. Current Health 92.5%." Reads the empty message when
    /// there is nothing to summarize.
    public static func summary(
        for projection: BatteryDegradationForecastProjection,
        localize: (String, String) -> String,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let title = localize("widget.forecast.title", "Battery Forecast")
        guard !projection.isEmpty else {
            let empty = localize("widget.forecast.noData", "No degradation forecast data")
            return "\(title). \(empty)"
        }
        var clauses: [String] = [title]

        let projectedLabel = localize("widget.forecast.projected80", "Projected 80% Capacity")
        let projectedValue = BatteryDegradationForecastFormat.projectedDate(
            projection.projected80Date,
            locale: locale,
            timeZone: timeZone
        )
        clauses.append("\(projectedLabel) \(projectedValue)")

        clauses.append(localize(projection.tier.localizationKey, projection.tier.fallback))

        if let health = projection.currentHealth {
            let healthLabel = localize("widget.forecast.currentHealth", "Current Health")
            let healthValue = BatteryDegradationForecastFormat.healthValue(health, locale: locale)
            clauses.append("\(healthLabel) \(healthValue)")
        }

        return clauses.joined(separator: ". ")
    }

    /// One risk-factor row's spoken value, e.g. "High heat exposure: Frequent
    /// thermal stress. Score 8." Substitutes the em-dash fallback glyph for a
    /// blank detail (web `rf.detail ?? '—'`).
    public static func riskFactorLabel(
        _ factor: BatteryDegradationForecastRiskFactor,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let detail = factor.displayDetail ?? BatteryDegradationForecastFormat.emDash
        let scoreLabel = localize("widget.forecast.riskScore", "Score")
        let score = BatteryDegradationForecastFormat.riskScore(factor.score, locale: locale)
        return "\(factor.displayTitle): \(detail). \(scoreLabel) \(score)"
    }
}
