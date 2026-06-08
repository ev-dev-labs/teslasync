//
//  MotorEfficiencyInsights.Views.swift
//  TeslaSync — P4 feature view · 0171 · MotorEfficiencyInsights (Apple)
//
//  The presentational subviews composed by `MotorEfficiencyInsights`: the three glass
//  panels (Torque Distribution / Throttle Behavior / Motor Thermal), their shared
//  chrome (panel wrapper, header, metric row, tinted badge, empty body), and the
//  loading / error states. All consume the P1/S10 facade + the shared P1/S9 tokens —
//  no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web header icons use decorative
//  Tailwind tints (blue / cyan / amber); these map to the brand chart-series tokens
//  (speed = blue, regen = cyan, energy = amber). The Style + Thermal badges use the
//  web's SEMANTIC variants (success / warning / danger) via `TSTone`.
//

import SwiftUI

// MARK: - Semantic tone mapping (web `Badge variant` + `MetricBar color`)

extension MotorThrottleStyle {
    /// Web `variant={conservative ? success : moderate ? warning : danger}` + the
    /// matching `MetricBar` colour (#22c55e / #eab308 / #ef4444).
    var tone: TSTone {
        switch self {
        case .conservative: .success
        case .moderate: .warning
        case .aggressive: .danger
        }
    }
}

extension MotorThermalStatus {
    /// Web `variant={max < 100 ? success : max < 140 ? warning : danger}`.
    var tone: TSTone {
        switch self {
        case .good: .success
        case .warm: .warning
        case .hot: .danger
        }
    }
}

// MARK: - Tinted badge (web `Badge size="sm"`, rendered verbatim)

/// A compact tinted capsule label — the per-surface peer of `TSBadge` that renders an
/// already-localized (facade-resolved) string verbatim instead of a `LocalizedStringKey`.
struct MotorBadge: View {
    let text: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Panel chrome (web `GlassPanel p-5` + the `<Icon/> <h3>` header)

/// One glass panel with the web header (tinted SF Symbol + title) and a caller body.
struct MotorPanel<Body: View>: View {
    let systemImage: String
    let tint: Color
    let titleKey: String
    let titleFallback: String
    @ViewBuilder var content: () -> Body

    private var title: String {
        MotorEfficiencyStrings.string(titleKey, titleFallback)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(tint)
                        .accessibilityHidden(true)
                    Text(verbatim: title)
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 0)
                }
                content()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title))
    }
}

/// A label/value metric row (web `flex justify-between` with a mono value).
struct MotorMetricRow: View {
    let labelKey: String
    let labelFallback: String
    let value: String

    private var label: String {
        MotorEfficiencyStrings.string(labelKey, labelFallback)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.body)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: MotorEfficiencyAccessibility.metric(label, value)))
    }
}

/// The compact "no motor data recorded yet" body (web shared `EmptyState`), shown in
/// every panel when `motorStats` is null. Never a blank box.
struct MotorPanelEmpty: View {
    private var message: String {
        MotorEfficiencyStrings.string("dynamics.noMotorData", "No motor data recorded yet")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: message))
    }
}

// MARK: - Torque Distribution panel (web first `GlassPanel`)

struct MotorTorquePanel: View {
    let metrics: MotorMetrics?
    let locale: Locale

    var body: some View {
        MotorPanel(
            systemImage: "bolt.fill",
            tint: Color.TS.chartSeriesSpeed,
            titleKey: "dynamics.torqueDistribution",
            titleFallback: "Torque Distribution"
        ) {
            if let metrics {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    MotorMetricRow(
                        labelKey: "dynamics.avgTorque",
                        labelFallback: "Avg Torque",
                        value: MotorEfficiencyFormat.withUnit(metrics.averageTorqueNm, "Nm", locale: locale)
                    )
                    MotorMetricRow(
                        labelKey: "dynamics.maxTorque",
                        labelFallback: "Max Torque",
                        value: MotorEfficiencyFormat.withUnit(metrics.maxTorqueNm, "Nm", locale: locale)
                    )
                    MotorMetricRow(
                        labelKey: "dynamics.highTorqueTime",
                        labelFallback: "High Torque Time",
                        value: MotorEfficiencyFormat.percent(metrics.highTorquePercent, locale: locale)
                    )
                }
            } else {
                MotorPanelEmpty()
            }
        }
    }
}

// MARK: - Throttle Behavior panel (web second `GlassPanel`)

struct MotorThrottlePanel: View {
    let metrics: MotorMetrics?
    let style: MotorThrottleStyle
    let fraction: Double
    let locale: Locale

    private var styleLabel: String {
        MotorEfficiencyStrings.string(style.labelKey, style.labelFallback)
    }

    var body: some View {
        MotorPanel(
            systemImage: "gauge.medium",
            tint: Color.TS.chartSeriesRegen,
            titleKey: "dynamics.throttleBehavior",
            titleFallback: "Throttle Behavior"
        ) {
            if let metrics {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    MotorMetricRow(
                        labelKey: "dynamics.avgPower",
                        labelFallback: "Avg Power",
                        value: MotorEfficiencyFormat.withUnit(metrics.averagePowerKW, "kW", locale: locale)
                    )
                    HStack(spacing: TSSpacing.sm) {
                        Text(verbatim: MotorEfficiencyStrings.string("dynamics.drivingStyle", "Style"))
                            .font(Font.TS.body)
                            .foregroundStyle(Color.TS.textSecondary)
                        Spacer(minLength: TSSpacing.sm)
                        MotorBadge(text: styleLabel, tone: style.tone)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: MotorEfficiencyAccessibility.metric(
                        MotorEfficiencyStrings.string("dynamics.drivingStyle", "Style"),
                        styleLabel
                    )))
                    // Web `MetricBar value={avgPower} max={200} sublabel=""` — the bar
                    // carries no textual readout (Avg Power is already shown above), so
                    // no stray "0.00" is rendered (the web regression fix).
                    TSMetricBar(fraction: fraction, tone: style.tone)
                        .accessibilityLabel(Text(verbatim: MotorEfficiencyStrings.string(
                            "dynamics.avgPower", "Avg Power"
                        )))
                }
            } else {
                MotorPanelEmpty()
            }
        }
    }
}

// MARK: - Motor Thermal panel (web third `GlassPanel`)

struct MotorThermalPanel: View {
    let metrics: MotorMetrics?
    let thermal: MotorThermalStatus
    let unit: MotorTemperatureUnit
    let locale: Locale

    private var thermalLabel: String {
        MotorEfficiencyStrings.string(thermal.labelKey, thermal.labelFallback)
    }

    var body: some View {
        MotorPanel(
            systemImage: "thermometer.medium",
            tint: Color.TS.chartSeriesEnergy,
            titleKey: "dynamics.motorThermal",
            titleFallback: "Motor Thermal"
        ) {
            if let metrics {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    MotorMetricRow(
                        labelKey: "dynamics.avgMotorTemp",
                        labelFallback: "Avg Motor Temp",
                        value: MotorEfficiencyFormat.temperature(
                            celsius: metrics.averageMotorTempC,
                            unit: unit,
                            locale: locale
                        )
                    )
                    MotorMetricRow(
                        labelKey: "dynamics.maxMotorTemp",
                        labelFallback: "Max Motor Temp",
                        value: MotorEfficiencyFormat.temperature(
                            celsius: metrics.maxMotorTempC,
                            unit: unit,
                            locale: locale
                        )
                    )
                    HStack {
                        MotorBadge(text: thermalLabel, tone: thermal.tone)
                        Spacer(minLength: 0)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: thermalLabel))
                }
            } else {
                MotorPanelEmpty()
            }
        }
    }
}

// MARK: - Responsive grid (web `Grid cols={{default:1, md:3}} gap={4}`)

/// The three panels in a width-adaptive grid — one column on a compact iPhone, up to
/// three on iPad / macOS (the web `default:1 / md:3` responsive split).
struct MotorEfficiencyGrid: View {
    let resolved: MotorEfficiencyResolved
    let locale: Locale

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            MotorTorquePanel(metrics: resolved.metrics, locale: locale)
            MotorThrottlePanel(
                metrics: resolved.metrics,
                style: resolved.throttleStyle,
                fraction: resolved.powerFraction,
                locale: locale
            )
            MotorThermalPanel(
                metrics: resolved.metrics,
                thermal: resolved.thermalStatus,
                unit: resolved.temperatureUnit,
                locale: locale
            )
        }
    }
}

// MARK: - Loading / error chrome (P4 leaf states)

/// The initial-fetch chrome: three skeleton panels so the surface keeps its shape
/// while the parent query resolves.
struct MotorEfficiencyLoadingView: View {
    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        TSSkeleton(width: 140, height: 14)
                        ForEach(0 ..< 3, id: \.self) { _ in
                            TSSkeleton(height: 12)
                        }
                    }
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: MotorEfficiencyStrings.string(
            "motorEfficiency.loadingA11y", "Loading motor efficiency"
        )))
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct MotorEfficiencyErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(Color.TS.statusDanger)
                Text(verbatim: MotorEfficiencyStrings.string(
                    "motorEfficiency.errorTitle", "Couldn't load motor data"
                ))
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
                    Text(verbatim: MotorEfficiencyStrings.string("motorEfficiency.retry", "Retry"))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.md)
        }
        .accessibilityElement(children: .combine)
    }
}
