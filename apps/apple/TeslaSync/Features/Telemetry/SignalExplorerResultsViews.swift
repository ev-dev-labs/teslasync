//
//  SignalExplorerResultsViews.swift
//  TeslaSync — P4 feature view · P7 · SignalExplorerPage (Apple)
//
//  The results region the page reveals once a query runs or Live is streaming:
//  the per-signal stats summary, the series overview (the chart slot — this page
//  parity unit declares zero charts; the full plot is the sibling SignalChartPanel
//  unit), and the paginated history table. Mirrors the web composition of
//  `SignalStatsPanel` + `SignalChartPanel` + `SignalHistoryTable`, kept native +
//  adaptive. Numbers are unit-free aggregates carried verbatim from upstream.
//

import SwiftUI

// MARK: - Results container

/// The web results stack (`SignalStatsPanel` + `SignalChartPanel` +
/// `SignalHistoryTable`), shown when a historical query has run or Live streams.
struct SignalExplorerResults: View {
    @Bindable var model: SignalExplorerPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.historicalLoading, !model.isLive {
                TSGlassPanel { ExplorerStateLoading(rows: 4) }
            } else {
                if !model.activeStats.isEmpty {
                    SignalStatsSummary(stats: model.activeStats)
                }
                SignalSeriesOverview(model: model)
                if !model.isLive, model.hasHistorical {
                    SignalHistoryTableView(model: model)
                }
            }
        }
    }
}

// MARK: - Stats summary (web `SignalStatsPanel`)

/// Per-signal min / max / avg / count tiles (web `SignalStatsPanel`).
struct SignalStatsSummary: View {
    let stats: [WorkspaceSignalStat]

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Text(verbatim: SEText.title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(stats) { stat in
                        SignalStatCard(stat: stat)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// A single per-signal aggregate tile.
struct SignalStatCard: View {
    let stat: WorkspaceSignalStat

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: stat.signal)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            HStack(spacing: TSSpacing.md) {
                metric(label: "min", value: stat.min)
                metric(label: "avg", value: stat.avg)
                metric(label: "max", value: stat.max)
            }
            Text(verbatim: "n = \(stat.count)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private func metric(label: String, value: Double) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .textCase(.uppercase)
            Text(verbatim: SignalExplorerFormat.number(value))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }

    private var accessibilityLabel: String {
        let minText = SignalExplorerFormat.number(stat.min)
        let avgText = SignalExplorerFormat.number(stat.avg)
        let maxText = SignalExplorerFormat.number(stat.max)
        return "\(stat.signal): min \(minText), avg \(avgText), max \(maxText), \(stat.count) samples"
    }
}

// MARK: - Series overview (the chart slot — charts delegated to SignalChartPanel)

/// The chart region. This page parity unit declares **zero** charts (the plot is
/// the sibling `SignalChartPanel` unit), so the page renders a compact, complete
/// per-series overview here: each selected signal with its sample count and a
/// min→avg→max band, plus the live point counter — never a blank region (ADR-011).
struct SignalSeriesOverview: View {
    @Bindable var model: SignalExplorerPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if model.activeStats.isEmpty {
                    Text(verbatim: SEText.exploreHint)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                } else {
                    ForEach(model.activeStats) { stat in
                        SignalSeriesRow(stat: stat)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: model.isLive ? "dot.radiowaves.left.and.right" : "chart.xyaxis.line")
                .foregroundStyle(Color.TS.accent)
            Text(verbatim: SEText.subtitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(2)
            Spacer(minLength: 0)
            if model.isLive {
                Text(verbatim: "\(model.liveEventCount) pts")
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            } else {
                Text(verbatim: "\(model.totalRecords) pts")
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}

/// One signal's min→avg→max band + sample count (a compact, chart-free series row).
struct SignalSeriesRow: View {
    let stat: WorkspaceSignalStat

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: stat.signal)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: SignalExplorerFormat.number(stat.avg))
                    .font(Font.TS.bodySm)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.accent)
            }
            band
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(stat.signal) average \(SignalExplorerFormat.number(stat.avg))"))
    }

    private var band: some View {
        GeometryReader { geo in
            let span = max(stat.max - stat.min, 0.0001)
            let ratio = min(max((stat.avg - stat.min) / span, 0), 1)
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.surfaceGlass)
                Capsule()
                    .fill(Color.TS.accent.opacity(0.35))
                    .frame(width: max(4, geo.size.width * ratio))
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

// MARK: - History table (web `SignalHistoryTable`)

/// The paginated historical-sample table (web `SignalHistoryTable`), with the web
/// per-page slice + prev/next pagination over `totalRecords`.
struct SignalHistoryTableView: View {
    @Bindable var model: SignalExplorerPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                headerRow
                Divider().overlay(Color.TS.border)
                if model.paginatedRows.isEmpty {
                    ExplorerStateEmpty(
                        title: SEText.pickSignalsTitle,
                        message: SEText.exploreHint,
                        systemImage: "tablecells"
                    )
                    .frame(maxWidth: .infinity, minHeight: 100)
                } else {
                    ForEach(model.paginatedRows) { row in
                        rowView(row)
                        Divider().overlay(Color.TS.border.opacity(0.5))
                    }
                    pagination
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var headerRow: some View {
        HStack {
            Text(verbatim: columnTime).frame(width: 150, alignment: .leading)
            Text(verbatim: columnSignal).frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: columnValue).frame(width: 100, alignment: .trailing)
        }
        .font(Font.TS.label)
        .foregroundStyle(Color.TS.textMuted)
        .textCase(.uppercase)
    }

    private func rowView(_ row: SignalHistoryEntry) -> some View {
        HStack {
            Text(verbatim: SignalExplorerFormat.timestamp(row.timestamp))
                .frame(width: 150, alignment: .leading)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: row.signal)
                .frame(maxWidth: .infinity, alignment: .leading)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Text(verbatim: row.value.display)
                .frame(width: 100, alignment: .trailing)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.accent)
        }
        .accessibilityElement(children: .combine)
    }

    private var pagination: some View {
        HStack(spacing: TSSpacing.md) {
            Button {
                model.setPage(model.page - 1)
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.bordered)
            .disabled(model.page <= 1)
            .accessibilityLabel(Text("pagination.previous"))

            Text(verbatim: "\(model.page) / \(model.totalPages)")
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)

            Button {
                model.setPage(model.page + 1)
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.bordered)
            .disabled(model.page >= model.totalPages)
            .accessibilityLabel(Text("pagination.next"))

            Spacer(minLength: 0)
            Text(verbatim: "\(model.totalRecords)")
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.top, TSSpacing.xs)
    }

    private var columnTime: String { "Time" }
    private var columnSignal: String { SEText.title }
    private var columnValue: String { "Value" }
}

// MARK: - Formatting (display boundary)

/// Display-boundary formatters for the results region. The aggregate values are
/// unit-free numbers carried verbatim from upstream, so no SI conversion applies.
enum SignalExplorerFormat {
    static func number(_ value: Double) -> String {
        String(format: "%.2f", value)
    }

    static func timestamp(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .standard)
    }
}
