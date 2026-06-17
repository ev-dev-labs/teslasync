import SwiftUI

// Drivetrain Health panels — part 3 (web sections 11–12): the tiered health recommendations
// (`HealthRecommendations`) and the temperature + power detail cards (`DetailCards`). Values format from
// raw SI via `DrivetrainHealthPageFormat`; the recommendation tiers mirror the web priority styling.

// MARK: - Section 11 — Health recommendations (web `HealthRecommendations`)

/// The tiered tip list: critical-stop / urgent-service (high), load / coolant / charging (medium), and
/// the always-on maintenance tips (low), each in a priority-tinted card.
struct DrivetrainRecommendationsSection: View {
    let recommendations: [DrivetrainRecommendation]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivetrainSectionHeader(
                    systemImage: "shield.lefthalf.filled",
                    titleKey: "drivetrain.recommendations",
                    tone: .info
                )
                TSStaggerContainer(spacing: TSSpacing.sm) {
                    ForEach(Array(recommendations.enumerated()), id: \.element.id) { index, tip in
                        TSStaggerItem(index: index) {
                            recommendationCard(tip)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func recommendationCard(_ tip: DrivetrainRecommendation) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: tip.systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tip.tone.color)
                .accessibilityHidden(true)
            Text(DrivetrainHealthPageStrings.key(tip.textKey))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            tip.tone.color.opacity(tip.priority == .low ? 0.04 : 0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tip.tone.color.opacity(tip.priority == .low ? 0.15 : 0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Section 12 — Detail cards (web `DetailCards`)

/// The two-up detail cards: per-sensor temperature readings and the power summary (peak / avg / max
/// regen / total regen energy / CO₂ saved).
struct DrivetrainDetailCardsSection: View {
    let health: DrivetrainHealthSummary?
    let peakPowerKw: Double
    let avgPowerKw: Double
    let minRegenKw: Double
    let stats: DrivetrainDrivingStats?
    let units: UnitPreferences
    let isCompact: Bool

    var body: some View {
        LazyVGrid(columns: DrivetrainGrid.columns(isCompact ? 1 : 2), spacing: TSSpacing.md) {
            temperatureCard
            powerCard
        }
    }

    private var temperatureCard: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSCardHeader(DrivetrainHealthPageStrings.key("drivetrain.temperatures"))
                TSKVList(rows: [
                    row("drivetrain.frontMotorTemp", temperature(health?.frontMotorTempC)),
                    row("drivetrain.rearMotorTemp", temperature(health?.rearMotorTempC)),
                    row("drivetrain.inverterTemp", temperature(health?.inverterTempC)),
                    row("drivetrain.batteryTemp", temperature(health?.batteryTempC))
                ])
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var powerCard: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSCardHeader(DrivetrainHealthPageStrings.key("drivetrain.powerSummary"))
                TSKVList(rows: [
                    row("drivetrain.peakPowerLabel", DrivetrainHealthPageFormat.powerInt(peakPowerKw)),
                    row("drivetrain.avgPowerLabel", DrivetrainHealthPageFormat.powerDecimal(avgPowerKw)),
                    row("drivetrain.maxRegenLabel", maxRegen),
                    row("drivetrain.regenLabel", regenEnergy),
                    row("drivetrain.co2Label", co2)
                ])
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func temperature(_ celsius: Double?) -> String {
        DrivetrainHealthPageFormat.temperature(celsius, units)
    }

    /// Web `minRegenPower < 0 ? ${fmtNumber(abs(minRegenPower), 1)} kW : '—'`.
    private var maxRegen: String {
        guard minRegenKw < 0 else { return DrivetrainHealthPageFormat.emptyValue }
        return "\(DrivetrainHealthPageFormat.number(abs(minRegenKw), decimals: 1)) kW"
    }

    private var regenEnergy: String {
        guard let stats else { return DrivetrainHealthPageFormat.emptyValue }
        return DrivetrainHealthPageFormat.energy(stats.regenEnergyWh, units)
    }

    private var co2: String {
        guard let stats else { return DrivetrainHealthPageFormat.emptyValue }
        return DrivetrainHealthPageFormat.co2(stats.co2SavedKg)
    }

    private func row(_ key: String, _ value: String) -> TSKVRow {
        TSKVRow(id: key, key: DrivetrainHealthPageStrings.key(key), value: value)
    }
}
