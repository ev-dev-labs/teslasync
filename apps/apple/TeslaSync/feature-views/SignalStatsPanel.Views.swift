//
//  SignalStatsPanel.Views.swift
//  TeslaSync — P4 feature view · 0272 · SignalStatsPanel (Apple)
//
//  The presentational subviews composed by `SignalStatsPanel`: the "Hide empty (N)"
//  toggle (web `Toggle size="sm"`), the per-signal stat table (web `DataTable` →
//  shared `TSDataTable` with the five web columns), and the loading / empty / error
//  chrome. All consume the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the per-signal name uses the brand
//  categorical palette indexed exactly as the web (`CHART_COLORS[max(0, idx) % len]`)
//  via `TSChartPalette`; the numeric cells use the text-primary / -secondary / -muted
//  roles the web `renderNumeric` assigns.
//

import SwiftUI

// MARK: - Hide-empty toggle (web `<Toggle size="sm" label="Hide empty (N)">`)

/// The compact switch that collapses the em-dash rows once the user has confirmed
/// the data gap — the native mirror of the web `Toggle`. Shown only when at least
/// one row is empty (the parent gates it on `emptyCount > 0`).
struct SignalStatsHideEmptyToggle: View {
    @Binding var isOn: Bool
    let count: Int

    private var label: String {
        SignalStatsStrings.hideEmpty(count: count)
    }

    var body: some View {
        Toggle(isOn: $isOn) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .toggleStyle(.switch)
        .controlSize(.small)
        .tint(Color.TS.accent)
        .fixedSize()
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Data body (web non-empty render: the stat table or the empty fallback)

/// The resolved panel body — the per-signal stat table, wrapped in the shared
/// fade-in (web `FadeIn`). When the hide-empty toggle filters every row away, it
/// falls back to the same "No stats available" text the web shows, so the surface
/// is never a blank box.
struct SignalStatsContent: View {
    let rows: [SignalStatRow]
    let hideEmpty: Bool

    private var visibleRows: [SignalStatRow] {
        SignalStatRows.visible(rows, hideEmpty: hideEmpty)
    }

    var body: some View {
        TSFadeIn {
            if visibleRows.isEmpty {
                SignalStatsEmptyText()
            } else {
                SignalStatsTable(rows: visibleRows)
            }
        }
    }
}

// MARK: - Stat table (web `DataTable` → shared `TSDataTable`, five columns)

/// The per-signal stat table — the shared `TSDataTable` carrying the five web
/// columns (signal · min · max · avg · count). The signal cell colours the name
/// from the brand palette and surfaces the "no data in range" hint for empty rows;
/// the numeric cells render the em-dash for non-finite values.
struct SignalStatsTable: View {
    let rows: [SignalStatRow]

    var body: some View {
        TSDataTable(rows: rows, columns: columns, density: .compact)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var columns: [TSColumn<SignalStatRow>] {
        [signalColumn, minColumn, maxColumn, avgColumn, countColumn]
    }

    private func columnTitle(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(SignalStatsStrings.string(key, fallback))
    }

    private var signalColumn: TSColumn<SignalStatRow> {
        TSColumn(
            id: "signal",
            title: columnTitle("signalStats.signal", "Signal"),
            comparator: { lhs, rhs in lhs.signal.localizedCompare(rhs.signal) },
            cell: { row in signalCell(row) }
        )
    }

    private func signalCell(_ row: SignalStatRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: row.signal)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(TSChartPalette.color(at: row.colorIndex))
            if row.isEmpty {
                Text(verbatim: SignalStatsStrings.string("signalStats.noDataInRange", "No data in range"))
                    .font(.system(size: 10))
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: rowAccessibilityLabel(row)))
    }

    private var minColumn: TSColumn<SignalStatRow> {
        TSColumn(
            id: "min",
            title: columnTitle("signalStats.min", "Min"),
            comparator: { lhs, rhs in compare(lhs.min, rhs.min) },
            cell: { row in numericCell(row.min, color: Color.TS.textSecondary) }
        )
    }

    private var maxColumn: TSColumn<SignalStatRow> {
        TSColumn(
            id: "max",
            title: columnTitle("signalStats.max", "Max"),
            comparator: { lhs, rhs in compare(lhs.max, rhs.max) },
            cell: { row in numericCell(row.max, color: Color.TS.textSecondary) }
        )
    }

    private var avgColumn: TSColumn<SignalStatRow> {
        TSColumn(
            id: "avg",
            title: columnTitle("signalStats.avg", "Avg"),
            comparator: { lhs, rhs in compare(lhs.avg, rhs.avg) },
            cell: { row in numericCell(row.avg, color: Color.TS.textPrimary) }
        )
    }

    private var countColumn: TSColumn<SignalStatRow> {
        TSColumn(
            id: "count",
            title: columnTitle("signalStats.count", "Count"),
            comparator: { lhs, rhs in compare(Double(lhs.sampleCount), Double(rhs.sampleCount)) },
            cell: { row in
                Text(verbatim: SignalStatsFormat.int(row.sampleCount))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
        )
    }

    /// Web `renderNumeric`: a finite value renders the 2-decimal number in the given
    /// role colour; a non-finite value renders the em-dash with a "No data" label.
    @ViewBuilder
    private func numericCell(_ value: Double, color: Color) -> some View {
        if value.isFinite {
            Text(verbatim: SignalStatsFormat.number(value))
                .monospacedDigit()
                .foregroundStyle(color)
        } else {
            Text(verbatim: SignalStatsFormat.dash)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityLabel(Text(verbatim: SignalStatsStrings.string("signalStats.noData", "No data")))
        }
    }

    private func rowAccessibilityLabel(_ row: SignalStatRow) -> String {
        guard !row.isEmpty else {
            return SignalStatsAccessibility.rowLabel(
                signal: row.signal,
                detail: SignalStatsStrings.string("signalStats.noDataInRange", "No data in range")
            )
        }
        let minLabel = SignalStatsStrings.string("signalStats.min", "Min")
        let maxLabel = SignalStatsStrings.string("signalStats.max", "Max")
        let avgLabel = SignalStatsStrings.string("signalStats.avg", "Avg")
        let countLabel = SignalStatsStrings.string("signalStats.count", "Count")
        let detail = SignalStatsAccessibility.statDetail([
            (label: minLabel, value: SignalStatsFormat.numeric(row.min)),
            (label: maxLabel, value: SignalStatsFormat.numeric(row.max)),
            (label: avgLabel, value: SignalStatsFormat.numeric(row.avg)),
            (label: countLabel, value: SignalStatsFormat.int(row.sampleCount))
        ])
        return SignalStatsAccessibility.rowLabel(signal: row.signal, detail: detail)
    }

    private func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        // Non-finite values (the "no data" rows) sort below any real number.
        switch (lhs.isFinite, rhs.isFinite) {
        case (false, false): return .orderedSame
        case (false, true): return .orderedAscending
        case (true, false): return .orderedDescending
        case (true, true):
            if lhs < rhs { return .orderedAscending }
            if lhs > rhs { return .orderedDescending }
            return .orderedSame
        }
    }
}

// MARK: - Empty fallback text (web `<span>No stats available</span>`)

/// The small inline "No stats available" text the web shows when there are no
/// visible rows. Used by the data body when the hide-empty toggle filters every
/// row away (the `.empty` phase uses the friendlier `SignalStatsEmptyView`).
struct SignalStatsEmptyText: View {
    var body: some View {
        Text(verbatim: SignalStatsStrings.string("signalStats.noStats", "No stats available"))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: a 2×2 grid of skeleton tiles, mirroring the web
/// `loading` branch (`[1,2,3,4].map(<Skeleton className="h-20" />)`).
struct SignalStatsLoadingView: View {
    private let columns = Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 2)

    private var loadingLabel: String {
        SignalStatsStrings.string("signalStats.loadingA11y", "Loading signal stats")
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                TSSkeleton(height: 80, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: loadingLabel))
    }
}

/// The resolved-but-empty state — a friendly state, never a blank panel. The web
/// leaf renders a one-line "No stats available"; the native surface uses the HIG
/// `ContentUnavailableView` so the empty surface is clearly intentional.
struct SignalStatsEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: SignalStatsStrings.string("signalStats.empty", "No signal statistics to show yet."))
            } icon: {
                Image(systemName: "chart.bar.xaxis")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct SignalStatsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: SignalStatsStrings.string("signalStats.errorTitle", "Couldn't load signal stats"))
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
                Text(verbatim: SignalStatsStrings.string("signalStats.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: SignalStatsStrings.string("signalStats.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
