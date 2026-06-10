//
//  ChargingTelemetrySection.Views.swift
//  TeslaSync — P4 feature view · 0290 · ChargingTelemetrySection (Apple)
//
//  The presentational chrome composed by `ChargingTelemetrySection`: the responsive
//  metric grid (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`), one metric tile (the
//  web `MetricCard`: a muted label over a bold value with a tinted icon chip), and the
//  loading / empty / error states. All copy resolves through the P1/S10 facade; all
//  chrome is token-driven (P1/S9). No networking and no Tailwind ports live here.
//
//  Colour parity (ADR-006 semantic, not literal): the web `MetricCard` `color` accents
//  (`green` / `cyan` / `purple`, which tint the icon chip only) map onto the shared
//  brand chart-series tokens — green → `chartSeriesBattery`, cyan → `chartSeriesRegen`,
//  purple → `chartSeriesPower`.
//

import SwiftUI

// MARK: - Tint mapping (web `MetricCard` `color` → shared chart-series tokens)

extension ChargingTelemetrySectionTint {
    /// The accent colour for the tile's icon chip, mapped onto the brand chart-series
    /// tokens that equal the web Tailwind neon accents used by the source.
    var color: Color {
        switch self {
        case .green: Color.TS.chartSeriesBattery
        case .cyan: Color.TS.chartSeriesRegen
        case .purple: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Glyph mapping (web lucide `Zap` / `Activity` / `BatteryCharging` / `Battery`)

extension ChargingTelemetrySectionMetricKind {
    /// The SF Symbol for the tile, mirroring the web lucide glyphs: Charger Power +
    /// Range Added use `Zap`; Voltage / Current / Charge Rate use `Activity`; Energy
    /// Added uses `BatteryCharging`; Charging State + Battery Level use `Battery`.
    var systemImage: String {
        switch self {
        case .chargerPower, .rangeAdded: "bolt.fill"
        case .voltage, .current, .chargeRate: "waveform.path.ecg"
        case .energyAdded: "battery.100.bolt"
        case .chargingState, .batteryLevel: "battery.100"
        }
    }
}

// MARK: - Grid sizing (web responsive `grid-cols-2 / sm:3 / lg:4`)

private enum ChargingTelemetryGridLayout {
    /// Adaptive columns: ~2 on a phone, scaling up toward four on iPad / Mac, mirroring
    /// the web breakpoints without hard-coding a device class.
    static let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]
}

// MARK: - Data body (web eight-tile metric grid)

/// The resolved section body — the responsive metric grid, wrapped in the shared
/// fade-in.
struct ChargingTelemetryGrid: View {
    let metrics: [ChargingTelemetrySectionMetric]

    var body: some View {
        TSFadeIn {
            LazyVGrid(columns: ChargingTelemetryGridLayout.columns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(metrics) { metric in
                    ChargingTelemetryTile(metric: metric)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Metric tile (web `MetricCard`)

/// One metric tile — a muted label over a bold value, with a tinted icon chip on the
/// trailing edge (web `MetricCard`). Combined into a single VoiceOver element.
struct ChargingTelemetryTile: View {
    let metric: ChargingTelemetrySectionMetric

    private var label: String {
        ChargingTelemetrySectionStrings.string(metric.kind.localizationKey, metric.kind.fallback)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: metric.value)
                    .font(Font.TS.section.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            Spacer(minLength: TSSpacing.xs)
            iconChip
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityValue(Text(verbatim: metric.value))
    }

    private var iconChip: some View {
        let tint = metric.kind.tint.color
        return Image(systemName: metric.kind.systemImage)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: 28, height: 28)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(tint.opacity(0.25), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Loading state (web `Skeleton` chrome)

/// The initial-fetch chrome: a skeleton grid that keeps the section shape while the
/// parent query resolves. Respects Reduce Motion (via `TSSkeleton`).
struct ChargingTelemetryLoadingView: View {
    var body: some View {
        LazyVGrid(columns: ChargingTelemetryGridLayout.columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 8, id: \.self) { _ in
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    VStack(alignment: .leading, spacing: 6) {
                        TSSkeleton(width: 64, height: 10)
                        TSSkeleton(width: 84, height: 18)
                    }
                    Spacer(minLength: TSSpacing.xs)
                    TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.sm)
                }
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
                .background(
                    Color.TS.surfaceGlass,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: ChargingTelemetrySectionStrings.string(
            "chargingTelemetry.loadingA11y", "Loading charging telemetry"
        )))
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-empty state — a native `ContentUnavailableView` with a bolt glyph
/// and the web message. Never a blank box.
struct ChargingTelemetryEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: ChargingTelemetrySectionStrings.string(
                    "vehicles.detail.noChargingTelemetry", "No charging telemetry available"
                ))
            } icon: {
                Image(systemName: "bolt.slash")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError` peer). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct ChargingTelemetryErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: ChargingTelemetrySectionStrings.string(
                "chargingTelemetry.errorTitle", "Couldn't load charging telemetry"
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
                Text(verbatim: ChargingTelemetrySectionStrings.string("chargingTelemetry.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: ChargingTelemetrySectionStrings.string(
                "chargingTelemetry.retry", "Retry"
            )))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
