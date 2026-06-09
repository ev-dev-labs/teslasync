//
//  BatteryDegradationForecastWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0011 · BatteryDegradationForecastWidget (Apple)
//
//  The loaded-content composition for `BatteryDegradationForecastWidget`, split
//  from the surface file to keep each file focused: the compact (1-col) health
//  summary and the standard (2×4+) projected-date hero + current-health stat +
//  risk-factor list + recommendation tip cards, plus the connectivity banner and
//  the combined VoiceOver summary. All strings resolve through the P1/S10 facade
//  and the shared P1/S9 tokens — no networking lives here.
//

import SwiftUI

// MARK: - Loaded content (compact summary / standard hero + lists)

extension BatteryDegradationForecastWidget {
    @ViewBuilder
    var forecastContent: some View {
        if isCompact {
            compactBody
        } else {
            standardBody
        }
    }

    /// Compact (1×N) — the centered health value + tier badge (web compact
    /// layout).
    private var compactBody: some View {
        let projection = model.projection
        return VStack(spacing: TSSpacing.xs) {
            if model.connection != .live { connectivityBanner }
            Spacer(minLength: 0)
            Text(verbatim: BatteryDegradationForecastFormat.healthValue(projection.currentHealth))
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            BatteryDegradationForecastBadge(
                text: BatteryDegradationForecastStrings.string(
                    projection.tier.localizationKey,
                    projection.tier.fallback
                ),
                impact: BatteryDegradationForecastBuilder.impact(forTier: projection.tier)
            )
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// Standard (2×4+) — the projected-date hero, current-health stat, risk-factor
    /// list and recommendation tip cards inside a scroll view (web
    /// `overflow-y-auto`).
    private var standardBody: some View {
        let projection = model.projection
        return ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if model.connection != .live { connectivityBanner }
                heroSection(projection)
                if let health = projection.currentHealth {
                    BatteryDegradationForecastStatCard(
                        label: BatteryDegradationForecastStrings.string(
                            "widget.forecast.currentHealth",
                            "Current Health"
                        ),
                        value: BatteryDegradationForecastFormat.healthValue(health)
                    )
                }
                if !projection.visibleRiskFactors.isEmpty {
                    riskFactorsSection(projection.visibleRiskFactors)
                }
                if !projection.recommendations.isEmpty {
                    recommendationsSection(projection.recommendations)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
    }

    private func heroSection(_ projection: BatteryDegradationForecastProjection) -> some View {
        BatteryDegradationForecastHero(
            eyebrow: BatteryDegradationForecastStrings.string(
                "widget.forecast.projected80",
                "Projected 80% Capacity"
            ),
            projectedDate: BatteryDegradationForecastFormat.projectedDate(projection.projected80Date),
            tierText: BatteryDegradationForecastStrings.string(
                projection.tier.localizationKey,
                projection.tier.fallback
            ),
            tierImpact: BatteryDegradationForecastBuilder.impact(forTier: projection.tier),
            rateText: rateText(for: projection)
        )
    }

    /// The degradation-rate sub-label `"−0.42%/mo"` (web
    /// `−${fmtNumber(rate, 2)}%/${t('widget.mo', 'mo')}`), shown only when the
    /// rate is present and positive.
    private func rateText(for projection: BatteryDegradationForecastProjection) -> String? {
        guard projection.showsRate else { return nil }
        let value = BatteryDegradationForecastFormat.degradationRate(projection.rate)
        let monthUnit = BatteryDegradationForecastStrings.string("widget.mo", "mo")
        return "\(value)/\(monthUnit)"
    }

    private func riskFactorsSection(_ factors: [BatteryDegradationForecastRiskFactor]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            BatteryDegradationForecastSectionLabel(
                text: BatteryDegradationForecastStrings.string(
                    "widget.forecast.riskFactors",
                    "Risk Factors"
                )
            )
            ForEach(factors) { factor in
                BatteryDegradationForecastRiskFactorRow(
                    factor: factor,
                    accessibilityLabel: BatteryDegradationForecastAccessibility.riskFactorLabel(
                        factor,
                        localize: BatteryDegradationForecastStrings.string
                    )
                )
            }
        }
    }

    private func recommendationsSection(_ recommendations: [String]) -> some View {
        let title = BatteryDegradationForecastStrings.string("widget.forecast.tip", "Tip")
        let badge = BatteryDegradationForecastStrings.string(
            "widget.forecast.recommendation",
            "Recommendation"
        )
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            BatteryDegradationForecastSectionLabel(
                text: BatteryDegradationForecastStrings.string(
                    "widget.forecast.recommendations",
                    "Recommendations"
                )
            )
            ForEach(Array(recommendations.prefix(3).enumerated()), id: \.offset) { _, rec in
                BatteryDegradationForecastTipCard(title: title, badgeText: badge, detail: rec)
            }
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline
            ? "widget.forecast.offlineBanner"
            : "widget.forecast.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last saved forecast"
            : "Updating — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            BatteryDegradationForecastStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    /// The combined VoiceOver summary for the content (hero + current health).
    private var accessibilitySummary: String {
        BatteryDegradationForecastAccessibility.summary(
            for: model.projection,
            localize: BatteryDegradationForecastStrings.string
        )
    }
}
