import SwiftUI

// MARK: - Temperature radial gauge (web `RadialGauge` — value + unit + label)

/// A circular value gauge (web `RadialGauge`): an arc filled to `value / max` with
/// the converted temperature + unit at the centre and below. Native SwiftUI
/// (`Circle().trim`), tokenized colors — never a WKWebView. Mirrors the visual of
/// the shared `TSRadialGauge` but renders a unit-bearing value instead of a percent.
struct ClimateTemperatureGauge: View {
    let celsius: Double
    let fahrenheit: Bool
    let label: LocalizedStringKey
    let unitLabel: String
    let colorIndex: Int

    private var displayValue: Double {
        ClimateFormat.displayTemperature(celsius, fahrenheit: fahrenheit)
    }

    private var fraction: Double {
        let max = ClimateFormat.gaugeMax(fahrenheit: fahrenheit)
        guard max > 0 else { return 0 }
        return min(Swift.max(displayValue / max, 0), 1)
    }

    private var valueText: String {
        "\(ClimateFormat.number(displayValue, decimals: 1))\(unitLabel)"
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.3), lineWidth: 10)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(
                        TSChartPalette.color(at: colorIndex),
                        style: StrokeStyle(lineWidth: 10, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 2) {
                    Text(verbatim: valueText)
                        .font(Font.TS.panel)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .monospacedDigit()
                    TSMetricLabel(label)
                }
            }
            .frame(width: 120, height: 120)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: valueText))
    }
}

// MARK: - Climate metric card (web `MetricCard` — icon + label + value + subtitle)

/// A tinted metric card (web `MetricCard`): leading-tinted SF Symbol, a label, a
/// value (localized or verbatim data, supplied by the caller as `Text`), and an
/// optional supporting subtitle. Built on the shared `TSCard` + P2 tokens.
struct ClimateMetricCard: View {
    let label: LocalizedStringKey
    let value: Text
    let systemImage: String
    let tone: TSTone
    let subtitle: Text?

    init(
        label: LocalizedStringKey,
        value: Text,
        systemImage: String,
        tone: TSTone = .accent,
        subtitle: Text? = nil
    ) {
        self.label = label
        self.value = value
        self.systemImage = systemImage
        self.tone = tone
        self.subtitle = subtitle
    }

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(alignment: .firstTextBaseline) {
                    TSMetricLabel(label)
                    Spacer(minLength: TSSpacing.sm)
                    Image(systemName: systemImage)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(tone.color)
                        .accessibilityHidden(true)
                }
                value
                    .font(Font.TS.title)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .monospacedDigit()
                if let subtitle {
                    subtitle
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Seat heat/cool level chip (web Badge "{label} ({n}/3)")

/// A capsule chip showing a seat level label + `(n/3)` count (web seat `Badge`),
/// styled like the shared `TSBadge`.
struct ClimateLevelChip: View {
    let labelKey: LocalizedStringKey
    let level: Int
    let tone: TSTone

    var body: some View {
        HStack(spacing: 2) {
            Text(labelKey)
            Text(verbatim: "(\(level)/3)")
        }
        .font(Font.TS.caption)
        .fontWeight(.medium)
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Seat heater card (web `SeatHeaterCard`)

/// One seat heater tile (web `SeatHeaterCard`): a tinted flame, the seat label,
/// and a level chip.
struct ClimateSeatHeaterCard: View {
    let label: LocalizedStringKey
    let level: Int

    var body: some View {
        let resolved = ClimateLevel.clamp(level)
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(resolved.heatTone.color)
                    .accessibilityHidden(true)
                Text(label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                ClimateLevelChip(labelKey: resolved.labelKey, level: level, tone: resolved.heatTone)
            }
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Seat cooling card (web `SeatCoolingCard`)

/// One seat cooler tile (web `SeatCoolingCard`): a tinted snowflake, the seat
/// label, and a level chip — or an em-dash when the level is unknown.
struct ClimateSeatCoolingCard: View {
    let label: LocalizedStringKey
    let level: Int?

    var body: some View {
        let resolved = ClimateLevel.clamp(level ?? 0)
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "snowflake")
                    .font(.system(size: 20))
                    .foregroundStyle(resolved.coolTone.color)
                    .accessibilityHidden(true)
                Text(label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                if let level {
                    ClimateLevelChip(labelKey: resolved.labelKey, level: level, tone: resolved.coolTone)
                } else {
                    Text(verbatim: ClimateFormat.dash)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Comfort score circle (web Thermal Comfort score / delta / status tiles)

/// A circular score/delta tile inside the Thermal Comfort panel (web inner
/// `GlassPanel`): a captioned title, a tinted circle holding a value or icon, and
/// a trailing badge/caption.
struct ClimateComfortTile<Center: View, Footer: View>: View {
    private let title: LocalizedStringKey
    private let tone: TSTone
    private let center: () -> Center
    private let footer: () -> Footer

    init(
        title: LocalizedStringKey,
        tone: TSTone,
        @ViewBuilder center: @escaping () -> Center,
        @ViewBuilder footer: @escaping () -> Footer
    ) {
        self.title = title
        self.tone = tone
        self.center = center
        self.footer = footer
    }

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Text(title)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
                ZStack {
                    Circle()
                        .fill(tone.color.opacity(0.2))
                        .frame(width: 80, height: 80)
                    center()
                }
                footer()
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .combine)
    }
}
