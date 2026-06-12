import SwiftUI

// The lifetime stats comparison table (web `DataTable` — GlassPanel8) and the four key-highlight
// stat cards (web "Key Highlights"). Values format from raw SI via `FleetCompareFormat`; the
// winning side is highlighted (web `winnerCell`).

// MARK: - Lifetime comparison table (web `DataTable` — GlassPanel8)

/// The lifetime stats comparison table (web `DataTable`): a metric column plus the two vehicles'
/// formatted values, with the winning side highlighted (web `winnerCell`). Shows a redacted
/// skeleton while either side's stats are loading.
struct FleetCompareComparisonTable: View {
    let rows: [FleetCompareRow]
    let nameA: String
    let nameB: String
    let isLoading: Bool
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "info.circle")
                        .foregroundStyle(Color.TS.textMuted)
                        .font(Font.TS.caption)
                        .accessibilityHidden(true)
                    TSCaption("comparison.lifetimeNote")
                }
                table
                    .fleetCompareRedacted(while: isLoading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var table: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                Text("comparison.metric")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                headerName(nameA, fallback: "comparison.vehicleA")
                headerName(nameB, fallback: "comparison.vehicleB")
            }
            Divider().overlay(Color.TS.border).gridCellColumns(3)
            ForEach(rows) { row in
                GridRow {
                    Text(row.metric.titleKey)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    winnerCell(value(row, raw: row.rawA), side: .sideA, row: row)
                    winnerCell(value(row, raw: row.rawB), side: .sideB, row: row)
                }
            }
        }
    }

    private func value(_ row: FleetCompareRow, raw: Double) -> String {
        FleetCompareFormat.tableValue(row.metric, raw: raw, prefs: units)
    }

    private func headerName(_ name: String, fallback: LocalizedStringKey) -> some View {
        Group {
            if name.isEmpty {
                Text(fallback)
            } else {
                Text(verbatim: name)
            }
        }
        .font(Font.TS.label)
        .foregroundStyle(Color.TS.textSecondary)
    }

    private func winnerCell(_ value: String, side: FleetCompareWinner, row: FleetCompareRow) -> some View {
        let isWinner = row.winnerSide == side
        return HStack(spacing: TSSpacing.xs) {
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(isWinner ? Color.TS.statusSuccess : Color.TS.textPrimary)
            if isWinner {
                Image(systemName: "checkmark")
                    .font(.caption2)
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
            }
        }
    }
}

// MARK: - Key highlights (web "Key Highlights" StatCards — Battery/Efficiency/Cost/CO2)

/// The four key-highlight stat cards (web "Key Highlights"): battery, efficiency, charging cost,
/// and CO₂ saved, each comparing the two vehicles side by side.
struct FleetCompareHighlights: View {
    let sideA: FleetCompareSide
    let sideB: FleetCompareSide
    let units: UnitPreferences
    let isStateLoading: Bool
    let isStatsLoading: Bool

    private let columns = [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "comparison.batteryDiff",
                value: FleetCompareFormat.batteryHighlight(sideA.state?.batteryLevel, sideB.state?.batteryLevel),
                systemImage: "battery.100"
            )
            .fleetCompareRedacted(while: isStateLoading)

            TSStatCard(
                title: "comparison.efficiencyDiff",
                value: FleetCompareFormat.efficiencyHighlight(
                    sideA.stats?.avgEfficiencyWhKm ?? 0,
                    sideB.stats?.avgEfficiencyWhKm ?? 0,
                    units
                ),
                systemImage: "bolt.fill"
            )
            .fleetCompareRedacted(while: isStatsLoading)

            TSStatCard(
                title: "comparison.costDiff",
                value: FleetCompareFormat.costHighlight(
                    sideA.cost?.totalChargingCost ?? 0,
                    sideB.cost?.totalChargingCost ?? 0
                ),
                systemImage: "dollarsign.circle"
            )

            TSStatCard(
                title: "comparison.co2Diff",
                value: FleetCompareFormat.co2Highlight(
                    sideA.stats?.co2SavedKg ?? 0,
                    sideB.stats?.co2SavedKg ?? 0
                ),
                systemImage: "leaf.fill"
            )
            .fleetCompareRedacted(while: isStatsLoading)
        }
    }
}
