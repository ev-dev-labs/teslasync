import SwiftUI

// MARK: - GlassPanel8 — Fleet Battery Status (web "Fleet Battery Status" panel)

/// The fleet battery panel: a header (activity glyph + title + `{n}% avg`) over a battery bar per
/// resolved vehicle (name, SI-derived level bar, percent, SI-converted range). When no vehicle state
/// resolved it shows the `common.noData` empty state (web `fleet.entries.length > 0` branch). The
/// rows iterate the model's resolved entries in fleet order (web `fleet.entries`).
struct FleetBatteryPanel: View {
    let model: VehicleListPageModel
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if model.hasFleetState {
                    VStack(spacing: TSSpacing.md) {
                        ForEach(model.resolvedEntries) { entry in
                            row(entry)
                        }
                    }
                } else {
                    TSEmptyState(title: VehicleListStrings.commonNoData, systemImage: "waveform.path.ecg")
                        .frame(maxWidth: .infinity, minHeight: 140)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TSPanelTitle(VehicleListStrings.batteryStatus)
            Spacer(minLength: TSSpacing.sm)
            avgLabel
        }
    }

    /// Web `{Math.round(avgBattery)}% avg`.
    private var avgLabel: some View {
        (
            Text(verbatim: "\(VehicleListFormat.roundedPercent(model.avgBattery))% ")
                + Text(VehicleListStrings.avgLabel)
        )
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textSecondary)
    }

    private func row(_ entry: VehicleListEntry) -> some View {
        let level = entry.state.batteryLevel
        let tone = VehicleListFormat.batteryTone(level)
        return HStack(spacing: TSSpacing.md) {
            Text(verbatim: entry.vehicle.title)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .frame(width: 96, alignment: .leading)
            VehicleBatteryBar(level: level, tone: tone, height: 10)
            Text(verbatim: "\(level)%")
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .frame(width: 44, alignment: .trailing)
            Text(verbatim: VehicleListFormat.distanceText(meters: entry.state.ratedRangeM, units: units))
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 72, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(entry.vehicle.title), \(level)%"))
    }
}
