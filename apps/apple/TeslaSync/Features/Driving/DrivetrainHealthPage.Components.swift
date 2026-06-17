import SwiftUI

// Shared building blocks for the Drivetrain Health panels (web `<h3>` section headers, the icon-tinted
// `MetricCard` tiles, the `LiveMotorStatus` stat tiles + inline metrics, the `MetricBar` rows, the
// temperature `RadialGauge` cells, and the `RangePicker`). Each maps a web micro-component to a native
// equivalent built on the P2 design tokens + the P3 component library, so the panels read declaratively.

// MARK: - Section header (web `<h3><Icon/> {title}</h3>`)

/// A panel section header: a tinted SF Symbol plus a panel title (web `<h3>` with a leading lucide icon).
struct DrivetrainSectionHeader: View {
    let systemImage: String
    let titleKey: String
    var tone: TSTone = .neutral

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(tone == .neutral ? Color.TS.textMuted : tone.color)
                .accessibilityHidden(true)
            TSPanelTitle(DrivetrainHealthPageStrings.key(titleKey))
        }
    }
}

// MARK: - Metric tile (web `MetricCard` with a tinted icon + subtitle)

/// A labeled metric tile with a tinted leading icon and an optional subtitle (web `MetricCard`).
struct DrivetrainMetricTile: View {
    let titleKey: String
    let value: String
    let systemImage: String
    let tone: TSTone
    var subtitle: String?

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(tone.color)
                        .accessibilityHidden(true)
                    Spacer(minLength: 0)
                }
                TSMetricLabel(DrivetrainHealthPageStrings.key(titleKey))
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                if let subtitle {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stat tile (web `LiveMotorStatus` centered value card)

/// A centered uppercase-label + tinted-value tile (web `LiveMotorStatus` `rounded-lg` cells).
struct DrivetrainStatTile: View {
    let labelKey: String
    let value: String
    let tone: TSTone

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            TSLabel(DrivetrainHealthPageStrings.key(labelKey))
                .multilineTextAlignment(.center)
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(tone.color)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Inline metric (web `InlineMetric` with a tinted icon)

/// An icon + label + value inline metric (web `InlineMetric`). The shared `TSInlineMetric` carries no
/// icon, so this adds the web's tinted lucide glyph.
struct DrivetrainInlineMetric: View {
    let systemImage: String
    let tone: TSTone
    let labelKey: String
    let value: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(DrivetrainHealthPageStrings.key(labelKey))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: value)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Thermal-load bar (web `MetricBar` with a label + sublabel)

/// A labeled proportion bar with a trailing reading (web `MetricBar label value max sublabel`).
struct DrivetrainThermalBar: View {
    let labelKey: String
    let fraction: Double
    let tone: TSTone
    let reading: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(DrivetrainHealthPageStrings.key(labelKey))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: reading)
                    .font(Font.TS.bodySm)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
            TSMetricBar(fraction: fraction, tone: tone)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Temperature gauge cell (web `RadialGauge` + Max caption)

/// A radial thermal-load gauge with the live reading and the critical ceiling (web `TemperatureGauges`
/// `RadialGauge` + the `Max:` caption). The ring shows the share of the ceiling; the reading shows the
/// converted temperature.
struct DrivetrainGaugeCell: View {
    let sensor: DrivetrainTempSensor
    let units: UnitPreferences

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            TSRadialGauge(
                value: sensor.loadFraction,
                label: DrivetrainHealthPageStrings.key(sensor.labelKey),
                colorIndex: gaugePaletteIndex
            )
            Text(verbatim: DrivetrainHealthPageFormat.temperature(sensor.valueC, units))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: maxCaption)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(DrivetrainHealthPageStrings.key(sensor.labelKey)))
        .accessibilityValue(Text(verbatim: DrivetrainHealthPageFormat.temperature(sensor.valueC, units)))
    }

    private var maxCaption: String {
        let label = DrivetrainHealthPageStrings.text("drivetrain.maxLabel", "Max")
        return "\(label): \(DrivetrainHealthPageFormat.temperatureMax(sensor.maxTempC, units))"
    }

    /// Web `tempSeverityColor` → a brand-palette slot for the ring (good 2 / warning 1 / critical 5).
    private var gaugePaletteIndex: Int {
        switch sensor.severity {
        case .danger: 5
        case .warning: 1
        default: 2
        }
    }
}

// MARK: - Date range control (web `RangePicker`)

/// The date-range filter (web `RangePicker`): native start/end `DatePicker`s reporting the new window
/// back to the model. SwiftUI announces each selected date, so no redundant text label.
struct DrivetrainRangeControl: View {
    let startDate: Date
    let endDate: Date
    let onChange: (Date, Date) -> Void

    @State private var start: Date
    @State private var end: Date

    init(startDate: Date, endDate: Date, onChange: @escaping (Date, Date) -> Void) {
        self.startDate = startDate
        self.endDate = endDate
        self.onChange = onChange
        _start = State(initialValue: startDate)
        _end = State(initialValue: endDate)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "calendar")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DatePicker(selection: $start, in: ...end, displayedComponents: .date) { EmptyView() }
                .labelsHidden()
                .onChange(of: start) { _, newValue in onChange(newValue, end) }
            Text(verbatim: "–").foregroundStyle(Color.TS.textMuted)
            DatePicker(selection: $end, in: start..., displayedComponents: .date) { EmptyView() }
                .labelsHidden()
                .onChange(of: end) { _, newValue in onChange(start, newValue) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(DrivetrainHealthPageStrings.key("drivetrain.col.date")))
    }
}

// MARK: - Adaptive grid columns

enum DrivetrainGrid {
    static func columns(_ count: Int, spacing: CGFloat = TSSpacing.md) -> [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: spacing, alignment: .top), count: count)
    }
}
