import SwiftUI

// The Recent-Charging-Sessions panel for the Energy surface (web Sessions GlassPanel +
// `DataTable`), built on the shared `TSDataTable` (a real grid on macOS / regular width, a
// card list on compact iPhone). Energy/power convert through the shared SI `Units` facade at
// this boundary; the charger-type badge tone mirrors the web ring colours; the panel renders
// its own empty state when there are no sessions (web `energy.sessions.empty`).

struct EnergySessionsSection: View {
    let sessions: [EnergyChargingSession]
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "bolt.fill")
                        .foregroundStyle(Color.TS.statusWarning)
                        .accessibilityHidden(true)
                    TSSubhead("energy.sessions.title")
                }
                if sessions.isEmpty {
                    TSEmptyState(title: "energy.sessions.empty", systemImage: "bolt.slash")
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    TSDataTable(rows: sessions, columns: columns, density: .standard)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var columns: [TSColumn<EnergyChargingSession>] {
        [
            TSColumn(id: "date", title: "energy.table.date") { session in
                Text(verbatim: EnergyFormat.dateShort(session.startedAt))
                    .foregroundStyle(TSChartPalette.color(at: 4))
            },
            TSColumn(id: "energy", title: "energy.table.energy") { session in
                Text(verbatim: Units.formatEnergy(session.totalEnergyAddedWh, units))
                    .foregroundStyle(TSChartPalette.color(at: 4))
                    .fontWeight(.medium)
            },
            TSColumn(id: "battery", title: "energy.table.battery") { session in
                EnergySocCell(start: session.startSocPct, end: session.endSocPct)
            },
            TSColumn(id: "power", title: "energy.table.power") { session in
                Text(verbatim: Self.powerText(session.peakPowerW))
            },
            TSColumn(id: "type", title: "energy.table.type") { session in
                EnergyChargerBadge(chargerType: session.chargerType)
            },
            TSColumn(id: "cost", title: "energy.table.cost_decimal") { session in
                Text(verbatim: session.costDecimal.map { EnergyFormat.currency($0) } ?? EnergyFormat.emptyValue)
            },
            TSColumn(id: "perKwh", title: "energy.table.perKwh") { session in
                Text(verbatim: Self.perKwhText(session))
                    .foregroundStyle(Color.TS.textMuted)
            }
        ]
    }

    /// Web `${fmtNumber(convertPowerFromSI(peak_power_w, 'kW'))} kW`, an em dash when absent.
    static func powerText(_ peakPowerW: Double?) -> String {
        guard let peakPowerW else { return EnergyFormat.emptyValue }
        return "\(EnergyFormat.number(peakPowerW / 1000, decimals: 0)) kW"
    }

    /// Web `$/kWh = cost / (energy_kwh)`, an em dash when cost is missing or energy is zero.
    static func perKwhText(_ session: EnergyChargingSession) -> String {
        guard let cost = session.costDecimal, session.totalEnergyAddedWh > 0 else { return EnergyFormat.emptyValue }
        return EnergyFormat.currency(cost / (session.totalEnergyAddedWh / 1000))
    }
}

/// The battery cell (web `start_soc% → end_soc%`): start muted, arrow, end emphasised.
struct EnergySocCell: View {
    let start: Double?
    let end: Double?

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: socText(start))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: "→")
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: socText(end))
                .foregroundStyle(Color.TS.statusSuccess)
        }
        .monospacedDigit()
        .accessibilityElement(children: .combine)
    }

    private func socText(_ value: Double?) -> String {
        value.map { "\(EnergyFormat.integer($0))%" } ?? EnergyFormat.emptyValue
    }
}

/// The charger-type badge (web ring-tinted pill): Supercharger → danger, any other type →
/// warning, AC → success. The label is the charger type verbatim, or "Supercharger" / "AC".
struct EnergyChargerBadge: View {
    let chargerType: String?

    private var isTesla: Bool {
        chargerType?.lowercased().contains("tesla") ?? false
    }

    private var tone: TSTone {
        if isTesla { return .danger }
        return chargerType != nil ? .warning : .success
    }

    private var label: String {
        if isTesla { return "Supercharger" }
        return chargerType ?? "AC"
    }

    var body: some View {
        TSBadge(LocalizedStringKey(label), tone: tone)
    }
}
