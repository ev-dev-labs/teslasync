import SwiftUI

// The metric-card grid (web `MetricCard` × 6 — MetricCard2) and the insights panel (web "Insights"
// GlassPanel — GlassPanel5). Values format from raw SI via `PeriodCompareFormat` at this display
// boundary; copy resolves from `Localizable.xcstrings`.

// MARK: - Metric cards (web `MetricCard` grid — MetricCard2)

/// The six side-by-side metric cards (web `metrics.map(<MetricCard>)`): each shows Period A's
/// value, the Period B subtitle, and the A-vs-B percent change, plus a tinted metric icon. The
/// grid reflows 1 → 2 → 3 columns (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`).
struct PeriodCompareMetricCards: View {
    let values: [PeriodCompareMetricValue]
    let isCompact: Bool

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)]
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(values) { value in
                PeriodCompareMetricCard(value: value)
            }
        }
    }
}

/// One metric card (web `MetricCard`): label, Period A value + unit, the Period B subtitle, the
/// A-vs-B percent-change delta, and the metric's tinted icon.
struct PeriodCompareMetricCard: View {
    let value: PeriodCompareMetricValue

    var body: some View {
        TSCard {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSMetricLabel(value.metric.titleKey)
                    TSMetricValue(PeriodCompareFormat.valueWithUnit(value.valueA, unit: value.unitLabel))
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                    TSDelta(value: percent.positive ? 1 : -1, formatted: percent.value)
                }
                Spacer(minLength: 0)
                TSIconBox(systemName: value.metric.systemImage, tone: value.metric.tone)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// Web `pctChange(m.a, m.b)` — drives the change delta's value + color.
    private var percent: PeriodCompareFormat.Percent {
        PeriodCompareFormat.pctChange(value.valueA, value.valueB)
    }

    /// Web `${t('compare.periodB')}: ${fmtNumber(m.b)} ${m.unit}`.
    private var subtitle: String {
        let prefix = String(localized: "compare.periodB", defaultValue: "Period B")
        return "\(prefix): \(PeriodCompareFormat.valueWithUnit(value.valueB, unit: value.unitLabel))"
    }
}

// MARK: - Insights (web "Insights" GlassPanel — GlassPanel5)

/// The insights panel (web "Insights"): a lightbulb-headed list of the three narrated comparisons
/// (web `insights.map`). Always renders the heading; shows an empty state rather than a blank
/// region when no insight lines are available.
struct PeriodCompareInsightsPanel: View {
    let lines: [String]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "lightbulb.fill")
                        .foregroundStyle(Color.TS.statusWarning)
                        .font(Font.TS.bodySm)
                        .accessibilityHidden(true)
                    TSPanelTitle("compare.insights")
                }
                if lines.isEmpty {
                    TSEmptyState(title: "compare.empty", systemImage: "lightbulb")
                        .frame(maxWidth: .infinity)
                } else {
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                            insightRow(line)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private func insightRow(_ line: String) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.xs) {
            Text(verbatim: "•")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: line)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
