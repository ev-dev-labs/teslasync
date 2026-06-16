import SwiftUI

// The Daily-Energy-History panel for the Energy-Flow surface (web Section 6 `GlassPanel` +
// `DataTable`), built on the shared `TSDataTable` (a real grid on macOS / regular width, a card
// list on compact iPhone). Energy / distance convert through the shared SI `Units` facade at this
// boundary; the panel renders its own empty state when there are no rows (web outer `EmptyState`
// plus the table's own empty message).

struct EnergyFlowHistorySection: View {
    let rows: [EnergyFlowDailyPoint]
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "chart.bar.fill")
                        .foregroundStyle(TSChartPalette.color(at: 4))
                        .accessibilityHidden(true)
                    TSSubhead("Daily Energy History")
                }
                if rows.isEmpty {
                    TSEmptyState(
                        title: "No energy history records available.",
                        message: "No energy records found.",
                        systemImage: "tablecells"
                    )
                    .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    TSDataTable(rows: rows, columns: columns, density: .standard)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var columns: [TSColumn<EnergyFlowDailyPoint>] {
        [
            TSColumn(id: "date", title: "Date", comparator: byDate, cell: { row in
                Text(verbatim: EnergyFormat.dateShort(row.date))
                    .foregroundStyle(Color.TS.textSecondary)
            }),
            TSColumn(id: "energy", title: "Energy", comparator: byEnergy, cell: { row in
                Text(verbatim: Units.formatEnergy(row.energyWh, units))
                    .foregroundStyle(TSChartPalette.color(at: 4))
                    .fontWeight(.medium)
            }),
            TSColumn(id: "distance", title: "Distance", comparator: byDistance, cell: { row in
                Text(verbatim: Units.formatDistance(row.distanceM, units))
                    .foregroundStyle(Color.TS.textPrimary)
            }),
            TSColumn(id: "efficiency", title: efficiencyTitle, comparator: byEfficiency, cell: { row in
                Text(verbatim: efficiencyText(row))
                    .foregroundStyle(Color.TS.textPrimary)
            })
        ]
    }

    private var efficiencyTitle: LocalizedStringKey {
        LocalizedStringKey(EnergyFormat.efficiencyUnit(units))
    }

    private func efficiencyText(_ row: EnergyFlowDailyPoint) -> String {
        EnergyFormat.integer(EnergyFormat.efficiencyDisplay(row.efficiencyWhPerM, units))
    }

    private func byDate(_ lhs: EnergyFlowDailyPoint, _ rhs: EnergyFlowDailyPoint) -> ComparisonResult {
        compare(lhs.date, rhs.date)
    }

    private func byEnergy(_ lhs: EnergyFlowDailyPoint, _ rhs: EnergyFlowDailyPoint) -> ComparisonResult {
        compare(lhs.energyWh, rhs.energyWh)
    }

    private func byDistance(_ lhs: EnergyFlowDailyPoint, _ rhs: EnergyFlowDailyPoint) -> ComparisonResult {
        compare(lhs.distanceM, rhs.distanceM)
    }

    private func byEfficiency(_ lhs: EnergyFlowDailyPoint, _ rhs: EnergyFlowDailyPoint) -> ComparisonResult {
        compare(lhs.efficiencyWhPerM, rhs.efficiencyWhPerM)
    }

    private func compare(_ lhs: String, _ rhs: String) -> ComparisonResult {
        lhs < rhs ? .orderedAscending : (lhs > rhs ? .orderedDescending : .orderedSame)
    }

    private func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        lhs < rhs ? .orderedAscending : (lhs > rhs ? .orderedDescending : .orderedSame)
    }
}
