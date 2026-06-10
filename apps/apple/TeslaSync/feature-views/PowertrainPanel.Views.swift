//
//  PowertrainPanel.Views.swift
//  TeslaSync — P4 feature view · 0283 · PowertrainPanel (Apple)
//
//  The presentational subviews composed by `PowertrainPanel`: the data body (the
//  shift-state pill, the bipolar power bar, the front/rear RPM and torque cards, the
//  peak-motor / inverter temperatures, and the regen row) and the loading / empty /
//  error chrome. All consume the P1/S10 facade and the shared P1/S9 tokens + shared
//  components (`TSGlassPanel` / `TSMetricCard` / `TSSkeleton` / `TSButton` / `TSFadeIn`)
//  — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the shift pill → drive `statusSuccess`
//  (web `text-green-400`), reverse `statusDanger` (web `text-red-400`), neutral
//  `statusWarning` (web `text-amber-400`), else `textMuted`. The power bar fills with
//  `statusSuccess` for drive and `statusDanger` for regen. The peak-motor hot branch
//  (>80 °C) tints `statusDanger`; the regen value reads `statusSuccess` (web
//  `text-green-400`).
//

import SwiftUI

// MARK: - Data body (web non-empty render: pill + bar + cards + rows)

/// The resolved panel body — the shift-state row, the power section (value row +
/// bipolar bar + axis), the RPM and torque card grids, and the temperature / regen
/// rows, wrapped in the shared fade-in (web `FadeIn`).
struct PowertrainContent: View {
    let projection: PowertrainProjection

    private var accessibilitySummary: String {
        PowertrainAccessibility.summary(
            shift: PowertrainShiftPill.label(for: projection),
            power: projection.powerText,
            regen: projection.regenText
        )
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                shiftStateRow
                powerSection
                rpmGrid
                torqueGrid
                PowertrainInfoRow(
                    labelKey: "telemetry.motorTemp",
                    fallback: "Motor Temp (peak)",
                    value: projection.motorTempText,
                    valueColor: projection.motorTempIsHot ? Color.TS.statusDanger : Color.TS.textPrimary
                )
                PowertrainInfoRow(
                    labelKey: "telemetry.inverterTemp",
                    fallback: "Inverter Temp",
                    value: projection.inverterTempText
                )
                PowertrainInfoRow(
                    labelKey: "telemetry.regen",
                    fallback: "Regen",
                    value: projection.regenText,
                    valueColor: Color.TS.statusSuccess
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// The web "Shift State" row: a muted label and the tone-tinted shift pill.
    private var shiftStateRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(verbatim: PowertrainStrings.string("telemetry.shiftState", "Shift State"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            PowertrainShiftPill(projection: projection)
        }
        .accessibilityElement(children: .combine)
    }

    /// The web "Power" block: the label/value row, the bipolar `±300` bar, and the
    /// "-300 / 0 / +300" axis markers.
    private var powerSection: some View {
        let label = PowertrainStrings.string("telemetry.power", "Power")
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: projection.powerText)
                    .font(Font.TS.bodySm)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
            PowertrainPowerBarView(bar: projection.powerBar)
            HStack {
                Text(verbatim: projection.powerAxisMinText)
                Spacer()
                Text(verbatim: projection.powerAxisMidText)
                Spacer()
                Text(verbatim: projection.powerAxisMaxText)
            }
            .font(Font.TS.caption)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label), \(projection.powerText)"))
    }

    /// The web `grid grid-cols-2` of front / rear motor RPM cards.
    private var rpmGrid: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            PowertrainMetricCard(
                labelKey: "telemetry.rpmFront",
                fallback: "Front RPM",
                value: projection.rpmFrontText,
                unit: "RPM"
            )
            PowertrainMetricCard(
                labelKey: "telemetry.rpmRear",
                fallback: "Rear RPM",
                value: projection.rpmRearText,
                unit: "RPM"
            )
        }
    }

    /// The web `grid grid-cols-2` of front / rear torque cards.
    private var torqueGrid: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            PowertrainMetricCard(
                labelKey: "telemetry.torqueFront",
                fallback: "Front Torque",
                value: projection.torqueFrontText,
                unit: "Nm"
            )
            PowertrainMetricCard(
                labelKey: "telemetry.torqueRear",
                fallback: "Rear Torque",
                value: projection.torqueRearText,
                unit: "Nm"
            )
        }
    }
}

// MARK: - Shift-state pill (web colour-branched badge)

/// The shift-state pill — a capsule chip whose accent follows the web ternary (D →
/// green, R → red, N → amber, else → muted), showing the raw backend gear or the
/// localized "Unknown" fallback (web `shift_state ?? t('common.unknown')`).
struct PowertrainShiftPill: View {
    let projection: PowertrainProjection

    /// The displayed (and spoken) label: the raw backend gear, else localized Unknown.
    static func label(for projection: PowertrainProjection) -> String {
        projection.shiftStateRawLabel ?? PowertrainStrings.string("common.unknown", "Unknown")
    }

    private var tone: Color {
        switch projection.shiftBadge {
        case .drive: Color.TS.statusSuccess
        case .reverse: Color.TS.statusDanger
        case .neutral: Color.TS.statusWarning
        case .other: Color.TS.textMuted
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "smallcircle.filled.circle")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: Self.label(for: projection))
                .font(Font.TS.caption.weight(.semibold))
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.1), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: Self.label(for: projection)))
    }
}

// MARK: - Power bar (web bipolar `±300` meter)

/// The bipolar power meter — a centre-anchored fill that extends toward the drive
/// (right, `statusSuccess`) or regen (left, `statusDanger`) side by the projected
/// fraction, over a muted track with a centre divider. Decorative: the numeric power
/// value is conveyed by the row text + the section summary, so this is a11y-hidden.
struct PowertrainPowerBarView: View {
    let bar: PowertrainPowerBar?

    var body: some View {
        GeometryReader { geo in
            let trackWidth = geo.size.width
            ZStack {
                Capsule()
                    .fill(Color.TS.border.opacity(0.25))
                if let bar {
                    let fill = trackWidth * bar.fillFraction
                    Capsule()
                        .fill((bar.isPositive ? Color.TS.statusSuccess : Color.TS.statusDanger).opacity(0.6))
                        .frame(width: fill)
                        .offset(x: bar.isPositive ? fill / 2 : -fill / 2)
                }
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(width: 1)
            }
        }
        .frame(height: 12)
        .accessibilityHidden(true)
    }
}

// MARK: - Metric card (web `MetricCard` → shared `TSMetricCard`)

/// One motor metric — the native counterpart of the web `MetricCard` (label / value /
/// unit subtitle), built on the shared data-display `TSMetricCard`. Used for the
/// front/rear RPM and front/rear torque cards.
struct PowertrainMetricCard: View {
    let labelKey: String
    let fallback: String
    let value: String
    let unit: String

    var body: some View {
        TSMetricCard(
            title: LocalizedStringKey(PowertrainStrings.string(labelKey, fallback)),
            value: value,
            caption: LocalizedStringKey(unit)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: PowertrainStrings.string(labelKey, fallback)))
        .accessibilityValue(Text(verbatim: "\(value) \(unit)"))
    }
}

// MARK: - Info row (web `flex items-center justify-between` rows)

/// One labelled telemetry row — a muted label and the mono value (web `text-sm
/// font-mono`). The value tone is overridable for the peak-motor hot branch and the
/// green regen reading.
struct PowertrainInfoRow: View {
    let labelKey: String
    let fallback: String
    let value: String
    var valueColor: Color = .TS.textPrimary

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: PowertrainStrings.string(labelKey, fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(valueColor)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(PowertrainStrings.string(labelKey, fallback)), \(value)"))
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: a skeleton shift row, power bar, card grids, and value
/// rows, so the panel keeps its shape while the parent query resolves.
struct PowertrainLoadingView: View {
    private var loadingLabel: String {
        PowertrainStrings.string("powertrain.loadingA11y", "Loading powertrain telemetry")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(width: 96, height: 12)
                Spacer(minLength: TSSpacing.sm)
                TSSkeleton(width: 64, height: 22, cornerRadius: TSRadius.pill)
            }
            TSSkeleton(height: 12, cornerRadius: TSRadius.pill)
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
            }
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
            }
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 110, height: 12)
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 72, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: loadingLabel))
    }
}

/// The empty render (web `EmptyState`): a friendly state, never a blank panel.
struct PowertrainEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: PowertrainStrings.string("telemetry.noMotorData", "No motor data available"))
            } icon: {
                Image(systemName: "gearshape.2")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct PowertrainErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: PowertrainStrings.string("powertrain.errorTitle", "Couldn't load powertrain telemetry"))
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
                Text(verbatim: PowertrainStrings.string("powertrain.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: PowertrainStrings.string("powertrain.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
