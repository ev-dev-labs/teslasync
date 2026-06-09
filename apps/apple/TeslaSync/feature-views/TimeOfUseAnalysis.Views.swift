//
//  TimeOfUseAnalysis.Views.swift
//  TeslaSync — P4 feature view · 0119 · TimeOfUseAnalysis (Apple)
//
//  Presentational chrome composed by `TimeOfUseAnalysis`: the panel header (web
//  `<h3>` with the `Clock` glyph) + the live-state freshness chip, the stale/offline
//  connectivity banner, the peak / mid / off-peak legend (web three-swatch row), the
//  insights rail (web `<h4>Insights</h4>` + four nested `GlassPanel` cards or the
//  `noInsights` empty), and the loading / empty / error states (web `noData` widened
//  to the full load envelope). The Swift Charts bar chart + its tooltip live in
//  `TimeOfUseAnalysis.Chart.swift`. All copy resolves through the P1/S10 facade; all
//  chrome is token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web `<h3>` with the `Clock` icon + title)

/// The panel header: the web amber clock glyph, the "Electricity Rate Analysis
/// (Time-of-Use)" title, and the live-state freshness chip pushed to the trailing
/// edge.
struct TimeOfUseHeader: View {
    let connection: TimeOfUseConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "clock")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            TimeOfUseStrings.text("costAnalysis.tou.title", "Electricity Rate Analysis (Time-of-Use)")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            TimeOfUseFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TimeOfUseFreshnessChip: View {
    let connection: TimeOfUseConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TimeOfUseStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TimeOfUseStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: TimeOfUseConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "costAnalysis.tou.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "costAnalysis.tou.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "costAnalysis.tou.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live,
/// so the cached figures are clearly labelled, with a retry affordance.
struct TimeOfUseConnectivityBanner: View {
    let connection: TimeOfUseConnection
    let onRetry: () -> Void

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "costAnalysis.tou.offlineBanner" : "costAnalysis.tou.staleBanner"
        let fallback = offline
            ? "Offline — showing last known time-of-use data"
            : "Reconnecting — time-of-use data may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TimeOfUseStrings.text(key, fallback).font(Font.TS.caption)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRetry) {
                TimeOfUseStrings.text("costAnalysis.tou.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.accent)
            .accessibilityLabel(TimeOfUseStrings.text("costAnalysis.tou.retry", "Retry"))
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Legend (web peak / mid-peak / off-peak swatch row)

/// The three-swatch legend under the chart, sharing `TimeOfUseBandPalette` with the
/// bars so a swatch can never disagree with the column it explains (the native
/// improvement over the web legend, whose mid swatch hardcodes a different hue).
struct TimeOfUseLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(TimeOfUseBand.allCases.sorted { $0.order < $1.order }, id: \.self) { band in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(TimeOfUseBandPalette.color(band))
                        .frame(width: 8, height: 8)
                    TimeOfUseStrings.text(band.legendKey, band.legendFallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Insights rail (web `<h4>Insights</h4>` + four cards)

/// The insights rail: the "Insights" subhead over the four nested cards (Cheapest /
/// Priciest / Busiest / Off-Peak), or the web `noInsights` empty when no hour has
/// sessions. Numbers + copy come from the bound model's facades.
struct TimeOfUseInsightsColumn: View {
    let insights: TimeOfUseInsights?
    let localize: (String, String) -> String
    let formatting: any TimeOfUseFormatting

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TimeOfUseStrings.text("costAnalysis.tou.insights", "Insights")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)

            if let insights {
                ForEach(cards(for: insights)) { card in
                    TimeOfUseInsightCardView(card: card)
                }
            } else {
                TimeOfUseInsightsEmpty()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func cards(for insights: TimeOfUseInsights) -> [TimeOfUseInsightCard] {
        [
            TimeOfUseInsightCard(
                id: .cheapest,
                title: localize("costAnalysis.tou.cheapestHour", "Cheapest Hour"),
                value: insights.cheapest.label,
                tone: Color.TS.statusSuccess,
                caption: avgCostCaption(insights.cheapest.avgCost)
            ),
            TimeOfUseInsightCard(
                id: .priciest,
                title: localize("costAnalysis.tou.priciestHour", "Priciest Hour"),
                value: insights.priciest.label,
                tone: Color.TS.statusDanger,
                caption: avgCostCaption(insights.priciest.avgCost)
            ),
            TimeOfUseInsightCard(
                id: .busiest,
                title: localize("costAnalysis.tou.busiestHour", "Busiest Hour"),
                value: insights.busiest.label,
                tone: Color.TS.statusInfo,
                caption: sessionsCaption(insights.busiest.sessions)
            ),
            TimeOfUseInsightCard(
                id: .offPeak,
                title: localize("costAnalysis.tou.offPeakRatio", "Off-Peak Charging"),
                value: formatting.formatPercent(insights.offPeakPct),
                tone: Color.TS.statusSuccess,
                caption: localize("costAnalysis.tou.offPeakDesc", "of sessions between 10 PM–6 AM")
            )
        ]
    }

    private func avgCostCaption(_ avgCost: Double) -> String {
        let avg = localize("costAnalysis.tou.avgCost", "avg")
        let perSession = localize("costAnalysis.tou.perSession", "/ session")
        return "\(avg) \(formatting.formatCurrency(avgCost)) \(perSession)"
    }

    private func sessionsCaption(_ sessions: Int) -> String {
        "\(formatting.formatCount(sessions)) \(localize("costAnalysis.tou.sessions", "sessions"))"
    }
}

// MARK: - Insight card (web nested `GlassPanel`)

/// Identity for the four insight cards — drives the stable `ForEach` id.
enum TimeOfUseInsightKind: String, Identifiable {
    case cheapest, priciest, busiest, offPeak
    var id: String {
        rawValue
    }
}

/// One insight card's resolved copy (title / value / value tone / caption).
struct TimeOfUseInsightCard: Identifiable {
    let id: TimeOfUseInsightKind
    let title: String
    let value: String
    let tone: Color
    let caption: String
}

/// The nested card view — web `<GlassPanel className="p-3">` with a muted title, a
/// toned headline value, and a muted caption.
struct TimeOfUseInsightCardView: View {
    let card: TimeOfUseInsightCard

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: card.title)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: card.value)
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(card.tone)
            Text(verbatim: card.caption)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(card.title): \(card.value). \(card.caption)"))
    }
}

// MARK: - Insights empty (web `noInsights`)

/// The web `touInsights === null` branch — the "No insights available" message held
/// at a stable height so the rail never collapses to a blank box.
struct TimeOfUseInsightsEmpty: View {
    var body: some View {
        TimeOfUseStrings.text("costAnalysis.tou.noInsights", "No insights available")
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, minHeight: 128, alignment: .center)
            .multilineTextAlignment(.center)
            .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a row of muted bars at the chart height beside
/// stacked insight tiles, respecting Reduce Motion (via `TSSkeleton`). Never a frozen
/// UI.
struct TimeOfUseLoadingView: View {
    private let barHeights: [CGFloat] = [60, 110, 150, 90, 200, 170, 130, 210, 160, 100]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .bottom, spacing: TSSpacing.sm) {
                ForEach(Array(barHeights.enumerated()), id: \.offset) { _, height in
                    TSSkeleton(height: height, cornerRadius: 3)
                }
            }
            .frame(height: 260, alignment: .bottom)
            HStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 56, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(TimeOfUseStrings.text("costAnalysis.tou.a11y.loading", "Loading time-of-use analysis"))
    }
}

// MARK: - Empty state (web centered `noData` — "Not enough data")

/// The resolved-but-empty surface state: the web chart `noData` branch over a native
/// `ContentUnavailableView` with a clock glyph, held at the chart height so the panel
/// never collapses to a blank box.
struct TimeOfUseEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TimeOfUseStrings.text("costAnalysis.charts.noData", "Not enough data")
            } icon: {
                Image(systemName: "clock.badge.questionmark")
            }
        } description: {
            TimeOfUseStrings.text(
                "costAnalysis.tou.emptyHint",
                "Time-of-use insights appear here once charging sessions are recorded."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 260)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance. The web presentational component
/// has no error branch (its parent owns the lifecycle); the native surface reproduces
/// the parent's failure envelope so the prompt's error state always renders.
struct TimeOfUseError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TimeOfUseStrings.text("costAnalysis.tou.a11y.errorTitle", "Couldn't load time-of-use analysis")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                TimeOfUseStrings.text("costAnalysis.tou.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TimeOfUseStrings.text("costAnalysis.tou.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 260)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
