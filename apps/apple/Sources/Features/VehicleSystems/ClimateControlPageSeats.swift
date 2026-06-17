import SwiftUI

// MARK: - Seat Heaters (web GlassPanel — front/rear seats, auto climate, cooling, legend)

/// The Seat Heaters panel (web `GlassPanel`): the front + rear seat heater tiles,
/// the auto-seat-climate toggles, the seat-cooling header + tiles, and the heat
/// level legend.
struct ClimateSeatHeaters: View {
    let latest: ClimateSnapshot?

    var body: some View {
        ClimateSectionPanel(systemImage: "flame.fill", title: "Seat Heaters") {
            VStack(spacing: TSSpacing.lg) {
                frontRow
                autoClimateRow
                rearRow
                seatCoolingHeader
                seatCoolingRow
                legend
            }
        }
    }

    // MARK: Front / rear heater rows

    private var frontRow: some View {
        HStack(spacing: TSSpacing.md) {
            ClimateSeatHeaterCard(label: "Front Left", level: latest?.seatHeaterLeft ?? 0)
            ClimateSeatHeaterCard(label: "Front Right", level: latest?.seatHeaterRight ?? 0)
        }
    }

    private var rearRow: some View {
        HStack(spacing: TSSpacing.md) {
            ClimateSeatHeaterCard(label: "Rear Left", level: latest?.seatHeaterRearLeft ?? 0)
            ClimateSeatHeaterCard(label: "Rear Center", level: latest?.seatHeaterRearCenter ?? 0)
            ClimateSeatHeaterCard(label: "Rear Right", level: latest?.seatHeaterRearRight ?? 0)
        }
    }

    // MARK: Auto seat climate

    private var autoClimateRow: some View {
        HStack(spacing: TSSpacing.md) {
            autoClimateTile("Auto Climate (Left)", latest?.autoSeatClimateLeft)
            autoClimateTile("Auto Climate (Right)", latest?.autoSeatClimateRight)
        }
    }

    private func autoClimateTile(_ label: LocalizedStringKey, _ value: Bool?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            if let value {
                TSBadge(value ? "Auto" : "Manual", tone: value ? .success : .neutral)
            } else {
                Text(verbatim: ClimateFormat.dash)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    // MARK: Seat cooling

    private var seatCoolingHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "snowflake")
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text("Seat Cooling")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            ventilationBadge
        }
    }

    private var ventilationBadge: some View {
        let vent = latest?.seatVentEnabled
        let tone: TSTone = vent == true ? .success : .neutral
        let valueText = vent.map { Text($0 ? "On" : "Off") } ?? Text(verbatim: ClimateFormat.dash)
        return (Text("Ventilation") + Text(verbatim: ": ") + valueText)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .combine)
    }

    private var seatCoolingRow: some View {
        HStack(spacing: TSSpacing.md) {
            ClimateSeatCoolingCard(label: "Front Left", level: latest?.climateSeatCoolingFrontLeft)
            ClimateSeatCoolingCard(label: "Front Right", level: latest?.climateSeatCoolingFrontRight)
        }
    }

    // MARK: Heat level legend

    private var legend: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(ClimateLevel.allCases, id: \.rawValue) { level in
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "flame.fill")
                        .font(.caption2)
                        .foregroundStyle(level.heatTone.color)
                        .accessibilityHidden(true)
                    (Text(verbatim: "\(level.rawValue) — ") + Text(level.labelKey))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
