import SwiftUI

// The Recent-Drain-Events table for the Sleep Efficiency surface (web GlassPanel8 +
// `DataTable`). Split from `SleepEfficiencyPage.Sections.swift` to keep each file focused.
// Percentages / rates / hours format directly via `SleepEfficiencyFormat`; SI Celsius
// converts through the shared `Units` facade at this render boundary (ADR-005); the panel
// renders its own empty state (never a blank region).

// MARK: - Recent drain events (web Recent Drain Events — GlassPanel8 + DataTable)

/// The recent-drain-events panel (web GlassPanel8): a header plus a sortable six-column
/// table (Date / Duration / Battery Lost / Drain Rate / Sentry / Temp), or the
/// no-drain-events empty state.
struct SleepRecentDrainEventsSection: View {
    let sleep: SleepEfficiencyData
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "bolt.fill")
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSSubhead("sleep.recentDrainEvents")
                }
                if sleep.hasDrainEvents {
                    TSDataTable(rows: sleep.recentEvents, columns: columns, density: .compact)
                        .accessibilityLabel(Text("sleep.recentDrainEvents"))
                } else {
                    TSEmptyState(title: "sleep.noDrainEvents", systemImage: "bolt.slash")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var columns: [TSColumn<SleepDrainEvent>] {
        [
            TSColumn(
                id: "date",
                title: "sleep.date",
                comparator: { compareStrings($0.startDate, $1.startDate) },
                cell: { dateCell($0) }
            ),
            TSColumn(
                id: "duration",
                title: "sleep.duration",
                comparator: { compare($0.durationHours, $1.durationHours) },
                cell: { Text(verbatim: SleepEfficiencyFormat.durationHours($0.durationHours, units)) }
            ),
            TSColumn(
                id: "batteryLost",
                title: "sleep.batteryLost",
                comparator: { compare($0.batteryLost, $1.batteryLost) },
                cell: { batteryLostCell($0) }
            ),
            TSColumn(
                id: "drainRate",
                title: "sleep.drainRateCol",
                comparator: { compare($0.drainRate, $1.drainRate) },
                cell: { drainRateCell($0) }
            ),
            TSColumn(
                id: "sentry",
                title: "sleep.sentry",
                comparator: { compareBools($0.sentryMode, $1.sentryMode) },
                cell: { sentryCell($0) }
            ),
            TSColumn(
                id: "temp",
                title: "sleep.temp",
                comparator: { compareTemps($0.outsideTempC, $1.outsideTempC) },
                cell: { tempCell($0) }
            )
        ]
    }

    private func dateCell(_ event: SleepDrainEvent) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: SleepEfficiencyFormat.dateShort(event.startDate))
            Text(verbatim: SleepEfficiencyFormat.time(event.startDate))
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func batteryLostCell(_ event: SleepDrainEvent) -> some View {
        Text(verbatim: SleepEfficiencyFormat.percent(event.batteryLost, units))
            .foregroundStyle(Color.TS.statusDanger)
    }

    private func drainRateCell(_ event: SleepDrainEvent) -> some View {
        Text(verbatim: SleepEfficiencyFormat.percentPerHour(event.drainRate, units))
            .foregroundStyle(event.drainRateSeverity.tone.color)
    }

    private func sentryCell(_ event: SleepDrainEvent) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: event.sentryMode ? "eye.fill" : "moon.fill")
                .font(.caption2)
                .foregroundStyle(event.sentryMode ? Color.TS.statusWarning : Color.TS.statusInfo)
                .accessibilityHidden(true)
            TSBadge(event.sentryMode ? "common.on" : "common.off", tone: event.sentryMode ? .warning : .info)
        }
    }

    @ViewBuilder
    private func tempCell(_ event: SleepDrainEvent) -> some View {
        if event.outsideTempC != nil {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "thermometer.medium")
                    .font(.caption2)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: SleepEfficiencyFormat.temperature(event.outsideTempC, units))
            }
        } else {
            Text(verbatim: SleepEfficiencyFormat.emptyValue)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs == rhs { return .orderedSame }
        return lhs < rhs ? .orderedAscending : .orderedDescending
    }

    private func compareStrings(_ lhs: String, _ rhs: String) -> ComparisonResult {
        lhs.compare(rhs)
    }

    private func compareBools(_ lhs: Bool, _ rhs: Bool) -> ComparisonResult {
        if lhs == rhs { return .orderedSame }
        return lhs ? .orderedDescending : .orderedAscending
    }

    private func compareTemps(_ lhs: Double?, _ rhs: Double?) -> ComparisonResult {
        compare(lhs ?? -.greatestFiniteMagnitude, rhs ?? -.greatestFiniteMagnitude)
    }
}
