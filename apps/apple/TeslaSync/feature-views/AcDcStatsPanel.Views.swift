//
//  AcDcStatsPanel.Views.swift
//  TeslaSync — P4 feature view · 0096 · AcDcStatsPanel (Apple)
//
//  The presentational subviews composed by `AcDcStatsPanel`: the AC/DC energy-split
//  bar (web grid bar + the AC/Total/DC totals), the per-type stats table (web
//  `DataTable` → shared `TSDataTable` with the eight web columns), the free-charging
//  footer, and the loading / empty / error chrome. All consume the P1/S10 facade and
//  the shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): AC → `chartSeriesSpeed` (the brand
//  blue that equals web `#3b82f6`), DC → `chartSeriesEnergy` (the brand amber that
//  equals web `#f59e0b`), free → `statusSuccess`, cost → `statusWarning`. On the
//  saturated split segments the value text uses white for fixed legibility.
//

import SwiftUI

// MARK: - Data body (web non-empty render: split bar + table + free footer)

/// The resolved panel body — the energy-split bar, the per-type table, and the
/// optional free-charging footer, wrapped in the shared fade-in (web `FadeIn`).
struct AcDcContent: View {
    let resolved: AcDcStatsResolved

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                AcDcEnergySplit(resolved: resolved)
                AcDcStatsTable(rows: resolved.rows)
                if resolved.showFreeFooter {
                    AcDcFreeFooter(total: resolved.breakdown.total)
                }
            }
        }
    }
}

// MARK: - Energy split bar (web grid bar + AC/Total/DC totals)

/// The AC-vs-DC energy split — the label, the two-segment proportional bar (each
/// segment shown only when its bucket has energy, web `energy > 0`), and the
/// AC / Total / DC kWh-or-MWh totals beneath it.
struct AcDcEnergySplit: View {
    let resolved: AcDcStatsResolved

    private var breakdown: AcDcBreakdown {
        resolved.breakdown
    }

    private var acLabel: String {
        "\(AcDcStrings.string("acdc.acAbbrev", "AC")) \(AcDcFormat.percent(resolved.acFraction * 100))"
    }

    private var dcLabel: String {
        "\(AcDcStrings.string("acdc.dcAbbrev", "DC")) \(AcDcFormat.percent(resolved.dcFraction * 100))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: AcDcStrings.string("charging.stats.energySplitLabel", "Energy Split (AC vs DC)"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)

            bar
                .frame(height: 16)
                .clipShape(Capsule())
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: AcDcAccessibility.splitLabel(ac: acLabel, dc: dcLabel)))

            totals
        }
    }

    private var bar: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                if resolved.showACSegment {
                    segment(label: acLabel, color: Color.TS.chartSeriesSpeed)
                        .frame(width: max(proxy.size.width * resolved.acFraction, 0))
                }
                if resolved.showDCSegment {
                    segment(label: dcLabel, color: Color.TS.chartSeriesEnergy)
                        .frame(width: max(proxy.size.width * resolved.dcFraction, 0))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func segment(label: String, color: Color) -> some View {
        color.overlay(
            Text(verbatim: label)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Color.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.horizontal, 2)
        )
    }

    private var totals: some View {
        HStack {
            totalLabel(prefix: AcDcStrings.string("acdc.acAbbrev", "AC"), value: breakdown.ac.energy)
            Spacer(minLength: TSSpacing.xs)
            totalLabel(prefix: AcDcStrings.string("acdc.totalLabel", "Total"), value: breakdown.total.energy)
            Spacer(minLength: TSSpacing.xs)
            totalLabel(prefix: AcDcStrings.string("acdc.dcAbbrev", "DC"), value: breakdown.dc.energy)
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
    }

    private func totalLabel(prefix: String, value: Double) -> some View {
        Text(verbatim: "\(prefix): \(AcDcFormat.energyScaled(value))")
            .monospacedDigit()
    }
}

// MARK: - Stats table (web `DataTable` → shared `TSDataTable`, eight columns)

/// The per-type stats table — the shared `TSDataTable` carrying the eight web columns
/// (type · sessions · energy · cost · $/kWh · avg energy · avg time · free).
struct AcDcStatsTable: View {
    let rows: [AcDcTableRow]

    var body: some View {
        TSDataTable(rows: rows, columns: columns, density: .compact)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var columns: [TSColumn<AcDcTableRow>] {
        [typeColumn, sessionsColumn, energyColumn, costColumn, perKWhColumn, avgEnergyColumn, avgTimeColumn, freeColumn]
    }

    private func columnTitle(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(AcDcStrings.string(key, fallback))
    }

    private var typeColumn: TSColumn<AcDcTableRow> {
        TSColumn(
            id: "type",
            title: columnTitle("charging.table.type", "Type"),
            comparator: { lhs, rhs in lhs.kind.rawValue.localizedCompare(rhs.kind.rawValue) },
            cell: { row in
                Text(verbatim: AcDcStrings.string(row.labelKey, row.labelFallback))
                    .font(Font.TS.bodySm.weight(.medium))
                    .foregroundStyle(row.kind == .ac ? Color.TS.chartSeriesSpeed : Color.TS.chartSeriesEnergy)
                    .accessibilityLabel(Text(verbatim: AcDcAccessibility.rowLabel(
                        type: AcDcStrings.string(row.labelKey, row.labelFallback),
                        sessions: "\(row.sessionCount)",
                        energy: AcDcFormat.energyScaled(row.energy),
                        cost: AcDcFormat.number(row.cost)
                    )))
            }
        )
    }

    private var sessionsColumn: TSColumn<AcDcTableRow> {
        TSColumn(
            id: "sessions",
            title: columnTitle("charging.table.sessionCount", "Sessions"),
            comparator: { lhs, rhs in compare(Double(lhs.sessionCount), Double(rhs.sessionCount)) },
            cell: { row in
                Text(verbatim: "\(row.sessionCount)")
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private var energyColumn: TSColumn<AcDcTableRow> {
        TSColumn(
            id: "energy",
            title: columnTitle("charging.table.energy", "Energy"),
            comparator: { lhs, rhs in compare(lhs.energy, rhs.energy) },
            cell: { row in
                Text(verbatim: AcDcFormat.energyScaled(row.energy))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        )
    }

    private var costColumn: TSColumn<AcDcTableRow> {
        TSColumn(
            id: "cost",
            title: columnTitle("charging.table.cost", "Cost"),
            comparator: { lhs, rhs in compare(lhs.cost, rhs.cost) },
            cell: { row in
                TSCurrency(row.cost)
                    .foregroundStyle(Color.TS.statusWarning)
            }
        )
    }

    private var perKWhColumn: TSColumn<AcDcTableRow> {
        TSColumn(
            id: "perKwh",
            title: columnTitle("charging.table.costPerKwh", "$/kWh")
        ) { row in
            Group {
                if let perEnergy = row.costPerEnergy {
                    TSCurrency(perEnergy)
                } else {
                    Text(verbatim: AcDcFormat.dash)
                }
            }
            .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private var avgEnergyColumn: TSColumn<AcDcTableRow> {
        TSColumn(
            id: "avgEnergy",
            title: columnTitle("charging.table.avgEnergy", "Avg Energy")
        ) { row in
            Text(verbatim: AcDcFormat.withUnit(row.averageEnergy, "kWh"))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private var avgTimeColumn: TSColumn<AcDcTableRow> {
        TSColumn(
            id: "avgTime",
            title: columnTitle("charging.table.avgTime", "Avg Time")
        ) { row in
            Text(verbatim: AcDcFormat.duration(row.averageDuration))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private var freeColumn: TSColumn<AcDcTableRow> {
        TSColumn(
            id: "free",
            title: columnTitle("charging.table.free", "Free")
        ) { row in
            Text(verbatim: freeText(for: row))
                .foregroundStyle(Color.TS.statusSuccess)
        }
    }

    private func freeText(for row: AcDcTableRow) -> String {
        guard row.hasFree else { return AcDcFormat.dash }
        return "\(row.freeCount) (\(AcDcFormat.withUnit(row.freeEnergy, "kWh")))"
    }

    private func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs < rhs { return .orderedAscending }
        if lhs > rhs { return .orderedDescending }
        return .orderedSame
    }
}

// MARK: - Free-charging footer (web `total.freeCount > 0` block)

/// The free-charging summary — the session count + free energy, shown only when the
/// fleet has any free (zero-cost) sessions (web `breakdown.total.freeCount > 0`).
struct AcDcFreeFooter: View {
    let total: AcDcBreakdownTotal

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Divider().overlay(Color.TS.border)
            HStack(spacing: TSSpacing.lg) {
                stat(
                    label: AcDcStrings.string("charging.table.freeCharged", "Free charged"),
                    value: String(
                        format: AcDcStrings.string("acdc.freeSessions", "%lld sessions"),
                        total.freeCount
                    )
                )
                stat(
                    label: AcDcStrings.string("charging.table.freeEnergy", "Free energy"),
                    value: AcDcFormat.withUnit(total.freeEnergy, "kWh")
                )
            }
            .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func stat(label: String, value: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: "\(label):")
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.statusSuccess)
        }
        .font(Font.TS.caption)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: a skeleton split bar over skeleton table rows, so the
/// panel keeps its shape while the parent query resolves.
struct AcDcLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 16, cornerRadius: TSRadius.pill)
            ForEach(0 ..< 2, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 96, height: 12)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 64, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AcDcStrings.string("acdc.loadingA11y", "Loading charging stats")))
    }
}

/// The empty render (web `DataTable` empty): a friendly state, never a blank panel.
struct AcDcEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: AcDcStrings.string("acdc.empty", "No charging sessions to break down yet."))
            } icon: {
                Image(systemName: "bolt.slash")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct AcDcErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: AcDcStrings.string("acdc.errorTitle", "Couldn't load charging stats"))
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
                Text(verbatim: AcDcStrings.string("acdc.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: AcDcStrings.string("acdc.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
