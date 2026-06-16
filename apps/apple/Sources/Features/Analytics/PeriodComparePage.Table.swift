import SwiftUI

// The comparison details table (web `DataTable` — GlassPanel4): one row per metric with the two
// periods' values, the absolute change (arrow + magnitude), and the percent-change badge. Values
// are the same display-converted figures the cards + chart use; copy resolves from
// `Localizable.xcstrings`.

/// The metric comparison table (web "Comparison Details" `GlassPanel` + `DataTable`): a metric
/// column plus Period A / Period B values, the signed change, and the percent-change badge.
struct PeriodCompareComparisonTable: View {
    let values: [PeriodCompareMetricValue]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("compare.tableTitle")
                table
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var table: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                headerCell("compare.metric")
                headerCell("compare.periodA")
                headerCell("compare.periodB")
                headerCell("compare.change")
                headerCell("compare.pctChange")
            }
            Divider().overlay(Color.TS.border).gridCellColumns(5)
            ForEach(values) { value in
                GridRow {
                    Text(value.metric.titleKey)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    valueCell(PeriodCompareFormat.number(value.valueA))
                    valueCell(PeriodCompareFormat.number(value.valueB))
                    changeCell(value)
                    percentCell(value)
                }
            }
        }
    }

    private func headerCell(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textMuted)
    }

    private func valueCell(_ text: String) -> some View {
        Text(verbatim: text)
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textSecondary)
    }

    /// Web change cell — `↑ / ↓` plus the absolute change, green when the percent change is
    /// non-negative, rose otherwise.
    private func changeCell(_ value: PeriodCompareMetricValue) -> some View {
        let positive = PeriodCompareFormat.pctChange(value.valueA, value.valueB).positive
        return HStack(spacing: 2) {
            Image(systemName: positive ? "arrow.up" : "arrow.down")
                .font(.caption2)
                .accessibilityHidden(true)
            Text(verbatim: PeriodCompareFormat.number(abs(value.change)))
                .monospacedDigit()
        }
        .font(Font.TS.bodySm)
        .foregroundStyle(positive ? Color.TS.statusSuccess : Color.TS.statusDanger)
    }

    /// Web `% Change` cell — a success/danger badge carrying the signed percentage.
    private func percentCell(_ value: PeriodCompareMetricValue) -> some View {
        let percent = PeriodCompareFormat.pctChange(value.valueA, value.valueB)
        return TSBadge(LocalizedStringKey(percent.value), tone: percent.positive ? .success : .danger)
    }
}
