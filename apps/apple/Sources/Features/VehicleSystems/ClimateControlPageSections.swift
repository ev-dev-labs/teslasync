import SwiftUI

// MARK: - HVAC status banner (web GlassPanel banner)

/// A tinted status chip inside the HVAC banner (web trailing `Badge dot`s).
struct ClimateBannerChip: View {
    let systemImage: String
    let label: Text
    let tone: TSTone

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.caption2)
                .accessibilityHidden(true)
            label
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// The HVAC status banner (web first `GlassPanel`): the system power state, an
/// Active/Off badge, a comfort badge, and trailing condition chips (Climate
/// Keeper, Defrost, Battery Heater, Insufficient Power to Heat).
struct ClimateHvacBanner: View {
    let latest: ClimateSnapshot?
    let notEnoughPowerToHeat: Bool
    let isCompact: Bool

    private var acOn: Bool {
        latest?.isAcOn == true
    }

    private var comfort: ClimateComfort {
        ClimateComfort.evaluate(inside: latest?.insideTemp, target: latest?.driverTempSetting)
    }

    var body: some View {
        TSGlassPanel {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    primaryRow
                    VStack(alignment: .leading, spacing: TSSpacing.sm) { chips }
                }
            } else {
                HStack(alignment: .center, spacing: TSSpacing.md) {
                    primaryRow
                    Spacer(minLength: TSSpacing.md)
                    HStack(spacing: TSSpacing.sm) { chips }
                }
            }
        }
    }

    private var primaryRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "power")
                .font(.system(size: 22))
                .foregroundStyle(acOn ? Color.TS.accent : Color.TS.textMuted)
                .accessibilityHidden(true)
            Text("HVAC System")
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
            TSBadge(acOn ? "Active" : "Off", tone: acOn ? .success : .neutral)
            TSBadge(comfort.labelKey, tone: comfort.tone)
        }
    }

    @ViewBuilder
    private var chips: some View {
        if ClimateKeeper.isActive(latest?.climateKeeperMode) {
            ClimateBannerChip(
                systemImage: "thermometer.snowflake",
                label: Text(ClimateKeeper.labelKey(latest?.climateKeeperMode)),
                tone: ClimateKeeper.tone(latest?.climateKeeperMode)
            )
        }
        if let mode = latest?.defrostMode, mode != "Off" {
            ClimateBannerChip(systemImage: "snowflake", label: defrostLabel(mode), tone: .info)
        }
        if latest?.batteryHeater == true {
            ClimateBannerChip(systemImage: "battery.100.bolt", label: Text("Battery Heater"), tone: .warning)
        }
        if notEnoughPowerToHeat {
            ClimateBannerChip(
                systemImage: "exclamationmark.triangle.fill",
                label: Text("Insufficient Power to Heat"),
                tone: .danger
            )
        }
    }

    /// Web `Defrost` chip label, suffixed with the mode when it is not `Normal`.
    private func defrostLabel(_ mode: String) -> Text {
        if mode == "Normal" {
            return Text("Defrost")
        }
        return Text("Defrost") + Text(verbatim: " (\(mode))")
    }
}

// MARK: - Temperature gauges (web 3× RadialGauge GlassPanels)

/// The three temperature `RadialGauge`s (web Inside / Outside / Driver Set Temp),
/// each in its own glass panel with an empty-state fallback when the reading is
/// missing.
struct ClimateTemperatureGauges: View {
    let latest: ClimateSnapshot?
    let fahrenheit: Bool
    let unitLabel: String

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            gauge(latest?.insideTemp, label: "Inside Temp", icon: "thermometer.medium", colorIndex: 0)
            gauge(latest?.outsideTemp, label: "Outside Temp", icon: "thermometer.medium", colorIndex: 1)
            gauge(latest?.driverTempSetting, label: "Driver Set Temp", icon: "thermometer.sun.fill", colorIndex: 2)
        }
    }

    private func gauge(
        _ celsius: Double?,
        label: LocalizedStringKey,
        icon: String,
        colorIndex: Int
    ) -> some View {
        TSGlassPanel {
            if let celsius {
                ClimateTemperatureGauge(
                    celsius: celsius,
                    fahrenheit: fahrenheit,
                    label: label,
                    unitLabel: unitLabel,
                    colorIndex: colorIndex
                )
                .frame(maxWidth: .infinity)
            } else {
                TSEmptyState(title: label, systemImage: icon)
                    .frame(maxWidth: .infinity)
            }
        }
    }
}
