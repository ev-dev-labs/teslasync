//
//  EnergyChargingPanel.Views.swift
//  TeslaSync — P4 feature view · 0279 · EnergyChargingPanel (Apple)
//
//  The presentational subviews composed by `EnergyChargingPanel`: the data body (the
//  charger voltage / current metric cards, the power / energy / battery / charge-rate
//  rows, and the charging-state pill) and the loading / empty / error chrome. All
//  consume the P1/S10 facade and the shared P1/S9 tokens + shared components
//  (`TSGlassPanel` / `TSMetricCard` / `TSSkeleton` / `TSButton` / `TSFadeIn`) — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the Charging pill → `chartSeriesRegen`
//  (the brand cyan that equals web `text-cyan-400`), Complete → `statusSuccess` (web
//  `text-green-400`), any other / unknown → `textMuted` (web `text-[var(--text-muted)]`).
//

import SwiftUI

// MARK: - Data body (web non-empty render: metric grid + rows + pill)

/// The resolved panel body — the two metric cards, the four labelled rows, and the
/// charging-state pill, wrapped in the shared fade-in (web `FadeIn`).
struct EnergyChargingContent: View {
    let projection: EnergyChargingProjection

    private var accessibilitySummary: String {
        EnergyChargingAccessibility.summary(
            state: EnergyChargingStatePill.label(for: projection),
            battery: projection.batteryLevelText,
            power: projection.powerText
        )
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                metricGrid
                EnergyChargingInfoRow(
                    labelKey: "telemetry.chargerPower",
                    fallback: "Charger Power",
                    value: projection.powerText
                )
                EnergyChargingInfoRow(
                    labelKey: "telemetry.energyAdded",
                    fallback: "Energy Added",
                    value: projection.energyAddedText
                )
                chargingStateRow
                EnergyChargingInfoRow(
                    labelKey: "telemetry.batteryLevel",
                    fallback: "Battery Level",
                    value: projection.batteryLevelText
                )
                EnergyChargingInfoRow(
                    labelKey: "telemetry.chargeRate",
                    fallback: "Charge Rate",
                    value: projection.chargeRateText,
                    systemImage: "bolt.fill"
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// The web `grid grid-cols-2 gap-3` of charger-voltage + charger-current cards.
    private var metricGrid: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            EnergyChargingMetricCard(
                labelKey: "telemetry.chargerVoltage",
                fallback: "Charger Voltage",
                value: projection.voltageValue,
                unit: projection.voltageUnit
            )
            EnergyChargingMetricCard(
                labelKey: "telemetry.chargerCurrent",
                fallback: "Charger Current",
                value: projection.currentValue,
                unit: projection.currentUnit
            )
        }
    }

    /// The web "Charging State" row: a muted label and the tone-tinted state pill.
    private var chargingStateRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(verbatim: EnergyChargingStrings.string("telemetry.chargingState", "Charging State"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            EnergyChargingStatePill(projection: projection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Metric card (web `MetricCard` → shared `TSMetricCard`)

/// One charger metric — the native counterpart of the web `MetricCard` (label / value
/// / unit subtitle), built on the shared data-display `TSMetricCard`.
struct EnergyChargingMetricCard: View {
    let labelKey: String
    let fallback: String
    let value: String
    let unit: String

    var body: some View {
        TSMetricCard(
            title: LocalizedStringKey(EnergyChargingStrings.string(labelKey, fallback)),
            value: value,
            caption: LocalizedStringKey(unit)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: EnergyChargingStrings.string(labelKey, fallback)))
        .accessibilityValue(Text(verbatim: "\(value) \(unit)"))
    }
}

// MARK: - Info row (web `flex items-center justify-between` rows)

/// One labelled telemetry row — a muted label (with an optional leading SF Symbol, the
/// web `<Zap/>` on the charge-rate row) and the mono value (web `text-sm font-mono`).
struct EnergyChargingInfoRow: View {
    let labelKey: String
    let fallback: String
    let value: String
    var systemImage: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                Text(verbatim: EnergyChargingStrings.string(labelKey, fallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(EnergyChargingStrings.string(labelKey, fallback)), \(value)"))
    }
}

// MARK: - Charging-state pill (web colour-branched badge)

/// The charging-state pill — a capsule chip whose accent follows the web ternary
/// (Charging → cyan, Complete → green, else → muted), showing the raw backend label or
/// the localized "Unknown" fallback (web `charging_state ?? t('common.unknown')`).
struct EnergyChargingStatePill: View {
    let projection: EnergyChargingProjection

    /// The displayed (and spoken) label: the raw backend value, else localized Unknown.
    static func label(for projection: EnergyChargingProjection) -> String {
        projection.stateRawLabel ?? EnergyChargingStrings.string("common.unknown", "Unknown")
    }

    private var tone: Color {
        switch projection.stateBadge {
        case .charging: Color.TS.chartSeriesRegen
        case .complete: Color.TS.statusSuccess
        case .other: Color.TS.textMuted
        }
    }

    var body: some View {
        Text(verbatim: Self.label(for: projection))
            .font(Font.TS.caption.weight(.semibold))
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.1), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: Self.label(for: projection)))
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: a skeleton metric grid over skeleton rows, so the panel
/// keeps its shape while the parent query resolves.
struct EnergyChargingLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
            }
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 110, height: 12)
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 72, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: EnergyChargingStrings.string(
            "energyCharging.loadingA11y", "Loading charging telemetry"
        )))
    }
}

/// The empty render (web `EmptyState`): a friendly state, never a blank panel.
struct EnergyChargingEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: EnergyChargingStrings.string(
                    "telemetry.noChargingTelemetry", "No charging telemetry available"
                ))
            } icon: {
                Image(systemName: "bolt.slash")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct EnergyChargingErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: EnergyChargingStrings.string(
                "energyCharging.errorTitle",
                "Couldn't load charging telemetry"
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
                Text(verbatim: EnergyChargingStrings.string("energyCharging.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: EnergyChargingStrings.string("energyCharging.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
