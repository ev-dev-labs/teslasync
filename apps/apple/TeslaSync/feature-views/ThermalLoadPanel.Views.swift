//
//  ThermalLoadPanel.Views.swift
//  TeslaSync — P4 feature view · 0163 · ThermalLoadPanel (Apple)
//
//  The presentational subviews composed by `ThermalLoadPanel`: the per-sensor severity
//  bars (web `MetricBar` → label + colour-graded readout over a `TSMetricBar`), the
//  2-/4-column inline-metric grid (web `InlineMetric` → glyph + value + label), and the
//  loading / empty / error chrome. All consume the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the severity readout + bar map the web
//  `tempSeverityColor` ladder to the status tones (good → success green, warning → amber,
//  critical → danger red, unknown → muted). The four inline-metric glyphs mirror the web
//  lucide accents (Zap → power purple, TrendingUp → accent cyan, Activity → success
//  green, Shield → warning amber).
//

import SwiftUI

// MARK: - Severity → tone (web `tempSeverityColor`)

/// Maps a `ThermalSeverity` to the shared `TSTone` used by the readout text and the
/// `TSMetricBar` fill, so the web colour ladder is reproduced through design tokens.
enum ThermalToneMap {
    static func tone(for severity: ThermalSeverity) -> TSTone {
        switch severity {
        case .unknown: .neutral
        case .good: .success
        case .warning: .warning
        case .critical: .danger
        }
    }
}

// MARK: - Data body (web non-empty render: bars + inline-metric grid)

/// The resolved panel body — the per-sensor severity bars and the inline-metric grid,
/// wrapped in the shared fade-in (web `FadeIn delay={0.2}`).
struct ThermalLoadContent: View {
    let resolved: ThermalLoadResolved

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(resolved.sensors) { sensor in
                        ThermalLoadBar(sensor: sensor, units: resolved.units)
                    }
                }
                ThermalInlineMetricGrid(resolved: resolved)
            }
        }
    }
}

// MARK: - Severity bar (web `MetricBar`: label + readout + value/max bar)

/// One sensor's severity row — the label, the unit-formatted temperature readout
/// (coloured by severity), and the proportional bar beneath it (web `MetricBar`).
struct ThermalLoadBar: View {
    let sensor: ThermalSensorReading
    let units: ThermalUnitContext

    private var label: String {
        ThermalStrings.string(sensor.labelKey, sensor.labelFallback)
    }

    private var readout: String {
        ThermalFormat.temperature(
            sensor.valueCelsius,
            unit: units.temperature,
            precision: units.precision,
            locale: units.resolvedLocale
        )
    }

    private var tone: TSTone {
        ThermalToneMap.tone(for: sensor.severity)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: label)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: readout)
                    .font(Font.TS.bodySm)
                    .monospacedDigit()
                    .foregroundStyle(tone.color)
            }
            TSMetricBar(fraction: sensor.fraction, tone: tone)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ThermalAccessibility.sensorLabel(name: label, value: readout)))
    }
}

// MARK: - Inline-metric grid (web `grid grid-cols-2 sm:grid-cols-4`)

/// One inline-metric descriptor — the glyph, its accent tint, the resolved value, and
/// the label key (web `InlineMetric` props).
struct ThermalMetricItem: Identifiable {
    let id: String
    let systemImage: String
    let tint: Color
    let value: String
    let labelKey: String
    let labelFallback: String
}

/// The four inline metrics (Peak Power · Avg Power · Drives · Regen Ratio) in an
/// adaptive grid that lays out two-up on a narrow panel and four-up when wide — the
/// native equivalent of the web `grid-cols-2 sm:grid-cols-4`.
struct ThermalInlineMetricGrid: View {
    let resolved: ThermalLoadResolved

    private var items: [ThermalMetricItem] {
        let locale = resolved.units.resolvedLocale
        return [
            ThermalMetricItem(
                id: "peakPower",
                systemImage: "bolt.fill",
                tint: Color.TS.chartSeriesPower,
                value: ThermalFormat.powerInteger(resolved.peakPower, locale: locale),
                labelKey: "drivetrain.peakPower",
                labelFallback: "Peak Power"
            ),
            ThermalMetricItem(
                id: "avgPower",
                systemImage: "chart.line.uptrend.xyaxis",
                tint: Color.TS.accent,
                value: ThermalFormat.powerDecimal(resolved.avgPower, locale: locale),
                labelKey: "drivetrain.avgPower",
                labelFallback: "Avg Power"
            ),
            ThermalMetricItem(
                id: "drives",
                systemImage: "waveform.path.ecg",
                tint: Color.TS.statusSuccess,
                value: ThermalFormat.drives(resolved.stats, locale: locale),
                labelKey: "drivetrain.drivesLabel",
                labelFallback: "Drives"
            ),
            ThermalMetricItem(
                id: "regenRatio",
                systemImage: "shield.fill",
                tint: Color.TS.statusWarning,
                value: ThermalFormat.regenRatio(resolved.stats, locale: locale),
                labelKey: "drivetrain.regenRatio",
                labelFallback: "Regen Ratio"
            )
        ]
    }

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: TSSpacing.md, alignment: .leading)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(items) { item in
                ThermalInlineMetric(item: item)
            }
        }
    }
}

/// One compact glyph + value + label metric (web `InlineMetric`).
struct ThermalInlineMetric: View {
    let item: ThermalMetricItem

    private var label: String {
        ThermalStrings.string(item.labelKey, item.labelFallback)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: item.systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(item.tint)
                .accessibilityHidden(true)
            Text(verbatim: item.value)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ThermalAccessibility.metricLabel(label: label, value: item.value)))
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: four skeleton severity rows over a skeleton metric row, so
/// the panel keeps its shape while the parent query resolves.
struct ThermalLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        HStack {
                            TSSkeleton(width: 96, height: 12)
                            Spacer()
                            TSSkeleton(width: 48, height: 12)
                        }
                        TSSkeleton(height: 8, cornerRadius: TSRadius.pill)
                    }
                }
            }
            HStack(spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 14)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: ThermalStrings.string("thermal.loadingA11y", "Loading thermal load")))
    }
}

/// The empty render (web page `EmptyState` peer): a friendly state, never a blank panel.
struct ThermalEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: ThermalStrings.string("thermal.empty", "No thermal load data available yet"))
            } icon: {
                Image(systemName: "thermometer.medium")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct ThermalErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: ThermalStrings.string("thermal.errorTitle", "Couldn't load thermal data"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: ThermalStrings.string("thermal.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: ThermalStrings.string("thermal.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
