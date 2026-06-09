//
//  MonthlyCostTable.Views.swift
//  TeslaSync — P4 feature view · 0117 · MonthlyCostTable (Apple)
//
//  The presentational subviews composed by `MonthlyCostTable`: the sortable per-month
//  table (web `DataTable` → shared `TSDataTable` with the seven web columns) and the
//  loading / empty / error chrome. All consume the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): cost → `accent` (the brand cyan that
//  equals web `text-cyan-400`), gas-equivalent → `statusDanger` (web `text-red-400`),
//  savings → `statusSuccess` when non-negative / `statusDanger` when negative (web
//  `text-green-400` / `text-red-400`), and the month label uses `textPrimary` (web
//  `font-medium text-white`).
//
//  Currency parity: the web `Currency` maps to the shared `TSCurrency` for the two plain
//  precision-2 columns (cost, gas-equivalent). The blended-rate column needs precision 3
//  and the savings column needs the signed `+`, neither of which `TSCurrency` expresses,
//  so those two reuse the ported `MonthlyCostFormat.currency` / `.signedCurrency` — the
//  exact web `precision={3}` / `{value >= 0 ? '+' : ''}` behaviour.
//

import SwiftUI

// MARK: - Data body (web non-empty render: the sortable table)

/// The resolved table body — the sortable per-month `TSDataTable`, wrapped in the shared
/// fade-in (web `FadeIn`).
struct MonthlyCostContent: View {
    let rows: [MonthlyCostBucket]

    var body: some View {
        TSFadeIn {
            MonthlyCostTableView(rows: rows)
        }
    }
}

// MARK: - Sortable table (web `DataTable` → shared `TSDataTable`, seven columns)

/// The per-month cost table — the shared `TSDataTable` carrying the seven web columns
/// (month · sessions · energy · cost · avg $/kWh · gas equiv · savings). Rows arrive
/// pre-sorted month / descending (web default); each column stays re-sortable via the
/// shared header menu, the native peer of the web `DataTable` column controls.
struct MonthlyCostTableView: View {
    let rows: [MonthlyCostBucket]

    var body: some View {
        TSDataTable(rows: rows, columns: columns, density: .compact)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: MonthlyCostStrings.string(
                "monthlyCost.tableA11y", "Monthly cost breakdown table"
            )))
    }

    private var columns: [TSColumn<MonthlyCostBucket>] {
        [monthColumn, sessionsColumn, energyColumn, costColumn, avgRateColumn, gasEquivColumn, savingsColumn]
    }

    private func columnTitle(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(MonthlyCostStrings.string(key, fallback))
    }

    private var monthColumn: TSColumn<MonthlyCostBucket> {
        TSColumn(
            id: MonthlyCostSortKey.month.rawValue,
            title: columnTitle("costAnalysis.table.month", "Month"),
            comparator: MonthlyCostSort.comparator(for: .month),
            cell: { row in
                Text(verbatim: row.month)
                    .font(Font.TS.bodySm.weight(.medium))
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityLabel(Text(verbatim: MonthlyCostAccessibility.rowLabel(
                        month: row.month,
                        sessions: MonthlyCostFormat.int(row.sessions),
                        energy: MonthlyCostFormat.withUnit(row.energy, "kWh", decimals: 1),
                        cost: MonthlyCostFormat.currency(row.cost),
                        savings: MonthlyCostFormat.signedCurrency(row.savings)
                    )))
            }
        )
    }

    private var sessionsColumn: TSColumn<MonthlyCostBucket> {
        TSColumn(
            id: MonthlyCostSortKey.sessions.rawValue,
            title: columnTitle("costAnalysis.table.sessions", "Sessions"),
            comparator: MonthlyCostSort.comparator(for: .sessions),
            cell: { row in
                Text(verbatim: MonthlyCostFormat.int(row.sessions))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private var energyColumn: TSColumn<MonthlyCostBucket> {
        TSColumn(
            id: MonthlyCostSortKey.energy.rawValue,
            title: columnTitle("costAnalysis.table.energy", "Energy"),
            comparator: MonthlyCostSort.comparator(for: .energy),
            cell: { row in
                Text(verbatim: MonthlyCostFormat.withUnit(row.energy, "kWh", decimals: 1))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private var costColumn: TSColumn<MonthlyCostBucket> {
        TSColumn(
            id: MonthlyCostSortKey.cost.rawValue,
            title: columnTitle("costAnalysis.table.cost", "Cost"),
            comparator: MonthlyCostSort.comparator(for: .cost),
            cell: { row in
                TSCurrency(row.cost)
                    .foregroundStyle(Color.TS.accent)
            }
        )
    }

    private var avgRateColumn: TSColumn<MonthlyCostBucket> {
        TSColumn(
            id: MonthlyCostSortKey.avgCostPerKwh.rawValue,
            title: columnTitle("costAnalysis.table.avgRate", "Avg $/kWh"),
            comparator: MonthlyCostSort.comparator(for: .avgCostPerKwh),
            cell: { row in
                Text(verbatim: MonthlyCostFormat.currency(row.avgCostPerKwh, precision: 3))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private var gasEquivColumn: TSColumn<MonthlyCostBucket> {
        TSColumn(
            id: MonthlyCostSortKey.gasEquiv.rawValue,
            title: columnTitle("costAnalysis.table.gasEquiv", "Gas Equiv"),
            comparator: MonthlyCostSort.comparator(for: .gasEquiv),
            cell: { row in
                TSCurrency(row.gasEquiv)
                    .foregroundStyle(Color.TS.statusDanger)
            }
        )
    }

    private var savingsColumn: TSColumn<MonthlyCostBucket> {
        TSColumn(
            id: MonthlyCostSortKey.savings.rawValue,
            title: columnTitle("costAnalysis.table.savings", "Savings"),
            comparator: MonthlyCostSort.comparator(for: .savings),
            cell: { row in
                Text(verbatim: MonthlyCostFormat.signedCurrency(row.savings))
                    .font(Font.TS.bodySm.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(row.savings >= 0 ? Color.TS.statusSuccess : Color.TS.statusDanger)
            }
        )
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: skeleton table rows, so the panel keeps its shape while the
/// parent query resolves.
struct MonthlyCostLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 72, height: 12)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 56, height: 12)
                    TSSkeleton(width: 56, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: MonthlyCostStrings.string(
            "monthlyCost.loadingA11y", "Loading monthly cost breakdown"
        )))
    }
}

/// The empty render (web `noData` else-branch): a friendly state, never a blank panel.
struct MonthlyCostEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: MonthlyCostStrings.string("costAnalysis.table.noData", "No monthly data available"))
            } icon: {
                Image(systemName: "chart.bar.xaxis")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct MonthlyCostErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: MonthlyCostStrings.string("monthlyCost.errorTitle", "Couldn't load monthly costs"))
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
                Text(verbatim: MonthlyCostStrings.string("monthlyCost.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: MonthlyCostStrings.string("monthlyCost.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
