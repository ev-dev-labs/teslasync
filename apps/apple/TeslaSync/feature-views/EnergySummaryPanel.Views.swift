//
//  EnergySummaryPanel.Views.swift
//  TeslaSync — P4 feature view · 0142 · EnergySummaryPanel (Apple)
//
//  The presentational subviews composed by `EnergySummaryPanel`: the responsive
//  six-up metric grid (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`), one metric
//  cell (muted label over a bold tinted value with an optional battery sub-line), and
//  the loading / empty / error chrome. All consume the P1/S10 facade and the shared
//  P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web `text-{colour}-400` accents
//  map to the shared chart-series tokens — amber → `chartSeriesEnergy`, green →
//  `chartSeriesBattery`, cyan → `chartSeriesRegen`, purple → `chartSeriesPower`.
//

import SwiftUI

// MARK: - Tint mapping (web `text-{colour}-400` → shared chart-series tokens)

extension EnergySummaryMetric.Tint {
    /// The accent colour for the value text, mapped onto the brand chart-series tokens
    /// that equal the web Tailwind 400-shades used by the source.
    var color: Color {
        switch self {
        case .energy, .battery: Color.TS.chartSeriesEnergy
        case .recovered, .range: Color.TS.chartSeriesBattery
        case .net: Color.TS.chartSeriesRegen
        case .efficiency: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Grid sizing (web responsive `grid-cols-2 / sm:3 / lg:6`)

private enum EnergySummaryGrid {
    /// Adaptive columns: ~2 on a phone, scaling up toward six on iPad / Mac, mirroring
    /// the web breakpoints without hard-coding a device class.
    static let columns = [GridItem(.adaptive(minimum: 140), spacing: TSSpacing.lg, alignment: .top)]
}

// MARK: - Data body (web six-up metric grid)

/// The resolved panel body — the responsive metric grid, wrapped in the shared
/// fade-in (web `FadeIn`).
struct EnergySummaryContent: View {
    let metrics: [EnergySummaryMetric]

    var body: some View {
        TSFadeIn {
            LazyVGrid(columns: EnergySummaryGrid.columns, alignment: .leading, spacing: TSSpacing.lg) {
                ForEach(metrics) { metric in
                    EnergyMetricCell(metric: metric)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Metric cell (web grid cell)

/// One metric cell — a muted label over a bold tinted value, with the optional battery
/// sub-line (web `Battery Used` detail). Combined into a single VoiceOver element.
struct EnergyMetricCell: View {
    let metric: EnergySummaryMetric

    private var label: String {
        EnergySummaryStrings.string(metric.labelKey, metric.labelFallback)
    }

    var body: some View {
        VStack(alignment: .center, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            Text(verbatim: metric.value)
                .font(Font.TS.section.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(metric.tint.color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let detail = metric.detail {
                Text(verbatim: detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: EnergySummaryAccessibility.metricLabel(
            label: label,
            value: metric.value,
            detail: metric.detail
        )))
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: a skeleton grid that keeps the panel shape while the
/// parent query resolves.
struct EnergySummaryLoadingView: View {
    var body: some View {
        LazyVGrid(columns: EnergySummaryGrid.columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 6, id: \.self) { _ in
                VStack(alignment: .center, spacing: TSSpacing.xs) {
                    TSSkeleton(width: 72, height: 10)
                    TSSkeleton(width: 96, height: 18)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: EnergySummaryStrings.string(
            "energySummary.loadingA11y", "Loading energy summary"
        )))
    }
}

/// The empty render: a friendly state for a drive with no energy snapshot, never a
/// blank panel.
struct EnergySummaryEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: EnergySummaryStrings.string(
                    "energySummary.empty", "No energy data for this drive yet."
                ))
            } icon: {
                Image(systemName: "bolt.slash")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct EnergySummaryErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: EnergySummaryStrings.string(
                "energySummary.errorTitle", "Couldn't load energy summary"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: EnergySummaryStrings.string("energySummary.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: EnergySummaryStrings.string("energySummary.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
