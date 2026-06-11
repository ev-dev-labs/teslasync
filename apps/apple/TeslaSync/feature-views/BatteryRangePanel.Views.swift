//
//  BatteryRangePanel.Views.swift
//  TeslaSync — P4 feature view · 0289 · BatteryRangePanel (Apple)
//
//  The presentational subviews composed by `BatteryRangePanel`: the radial battery gauge (web
//  `RadialGauge`), the responsive content layout (the gauge beside the metric grid, stacking on
//  narrow widths via `ViewThatFits`), and the metric card (web `MetricCard`). All consume
//  pre-localized strings from the P1/S10 facade and the shared P1/S9 design tokens — no networking,
//  no Tailwind ports. Each semantic tone maps to a `Color.TS` token here so the projection stays
//  SwiftUI-free.
//

import SwiftUI

// MARK: - Tone → design-token color

extension BatteryRangePanelTone {
    /// The `Color.TS` token for the gauge ring or a card accent. `.accent` is the web cyan;
    /// `.success` is the web green; `.muted` / `.primary` are the web muted / primary text.
    var color: Color {
        switch self {
        case .accent: Color.TS.accent
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .muted: Color.TS.textMuted
        case .primary: Color.TS.textPrimary
        }
    }
}

// MARK: - Content (web `flex flex-col sm:flex-row` → gauge + metric grid)

/// The resolved content body. The stale / offline banner appears above the row when the bound source
/// is not live; then the gauge beside the metric cards on wide widths, stacking vertically on narrow
/// ones (web `flex-col sm:flex-row`).
struct BatteryRangePanelContentView: View {
    let content: BatteryRangePanelContentModel
    let connection: BatteryRangePanelConnection
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if connection != .live {
                BatteryRangePanelConnectivityBanner(connection: connection, onRefresh: onRefresh)
            }
            ViewThatFits(in: .horizontal) {
                wideLayout
                narrowLayout
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var gauge: some View {
        BatteryRangePanelGauge(gauge: content.gauge)
    }

    private var metricCards: some View {
        ForEach(content.metrics) { BatteryRangePanelMetricCard(metric: $0) }
    }

    private var wideLayout: some View {
        HStack(alignment: .top, spacing: TSSpacing.x2xl) {
            gauge
            HStack(alignment: .top, spacing: TSSpacing.md) {
                metricCards
            }
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }

    private var narrowLayout: some View {
        VStack(alignment: .center, spacing: TSSpacing.lg) {
            gauge
            LazyVGrid(columns: Self.narrowColumns, alignment: .leading, spacing: TSSpacing.md) {
                metricCards
            }
        }
    }

    private static let narrowColumns = [
        GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
        GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top)
    ]
}

// MARK: - Radial gauge (web `RadialGauge value={battery_level} max={100} unit="%"`)

/// The radial battery gauge: a faint track ring, the band-colored progress arc (Reduce-Motion aware
/// fill), the centered numeric percent, and the "Battery" label beneath. One VoiceOver element
/// reading "Battery: {n}%".
struct BatteryRangePanelGauge: View {
    let gauge: BatteryRangePanelGaugeModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let diameter: CGFloat = 140
    private let strokeWidth: CGFloat = 8

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.4), lineWidth: strokeWidth)
                Circle()
                    .trim(from: 0, to: gauge.fraction)
                    .stroke(
                        gauge.band.tone.color,
                        style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration),
                        value: gauge.fraction
                    )
                centerLabel
            }
            .frame(width: diameter, height: diameter)
            Text(verbatim: gauge.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: gauge.accessibilityLabel))
    }

    private var centerLabel: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: gauge.valueText)
                .font(.system(size: diameter * 0.26, weight: .bold))
                .foregroundStyle(Color.TS.textPrimary)
            if gauge.hasValue {
                Text(verbatim: gauge.unit)
                    .font(.system(size: diameter * 0.13))
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .monospacedDigit()
        .minimumScaleFactor(0.6)
        .lineLimit(1)
    }
}

// MARK: - Metric card (web `MetricCard` — Rated Range / Ideal Range / Charging)

/// One metric card: the muted label and prominent value over an optional subtitle, with a tinted
/// leading-accent icon chip. The whole card is a single VoiceOver element reading "{label}: {value}"
/// (plus the subtitle when present).
struct BatteryRangePanelMetricCard: View {
    let metric: BatteryRangePanelMetricModel

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: metric.label)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: metric.value)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let subtitle = metric.subtitle {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            iconChip
        }
        .padding(TSSpacing.md)
        .frame(minWidth: 96, maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: metric.accessibilityLabel))
    }

    private var iconChip: some View {
        Image(systemName: metric.systemImage)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(metric.tone.color)
            .frame(width: 28, height: 28)
            .background(
                metric.tone.color.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(metric.tone.color.opacity(0.25), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}
