//
//  BatteryRangeCharts.Views.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  The presentational chrome composed by `BatteryRangeCharts`: the two glass panels (Battery
//  Overview + Drive Distance Trend) with their icon + title headers, the radial battery gauge
//  (web `RadialGauge`), the Battery % / Range tiles (web `AnimatedNumber`), and the freshness chip
//  + stale/offline banner. The loading / empty / error states live in
//  BatteryRangeCharts.States.swift. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No networking and no Tailwind ports live here. Each
//  `BatteryRangeChartsTone` maps to a `Color.TS` token so the projection stays SwiftUI-free.
//

import SwiftUI

// MARK: - Tone → design-token color (P1/S9)

extension BatteryRangeChartsTone {
    /// The `Color.TS` token this tone resolves to. The token RGB matches the web hex the tone
    /// ports (success=#10b981, warning=#f59e0b, danger=#ef4444), so the native chrome reads
    /// identically without hardcoding a hex.
    var color: Color {
        switch self {
        case .accent: Color.TS.accent
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .muted: Color.TS.textMuted
        }
    }
}

// MARK: - Panel shell (web `<GlassPanel className="p-6">` with an icon + title header)

/// One glass panel with the web header (a tinted leading glyph + the bold title) over its body.
/// Used by both the Battery Overview and Drive Distance Trend panels, and by the loading state,
/// so the panel chrome is identical across phases.
struct BatteryRangeChartsPanel<PanelContent: View>: View {
    let systemImage: String
    let titleKey: String
    let titleFallback: String
    private let panelBody: () -> PanelContent

    init(
        systemImage: String,
        titleKey: String,
        titleFallback: String,
        @ViewBuilder panelBody: @escaping () -> PanelContent
    ) {
        self.systemImage = systemImage
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.panelBody = panelBody
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                panelBody()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            BatteryRangeChartsStrings.text(titleKey, titleFallback)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Battery Overview body (web gauge + tiles + bar chart)

/// The Battery Overview panel body: the radial gauge beside the Battery % / Range tiles, with the
/// Current-vs-Remaining bar chart beneath (web `flex items-center gap-4` over the `h-48` chart).
struct BatteryRangeChartsBatteryBody: View {
    let content: BatteryRangeChartsContent

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .center, spacing: TSSpacing.lg) {
                BatteryRangeChartsGaugeView(gauge: content.gauge)
                VStack(spacing: TSSpacing.sm) {
                    BatteryRangeChartsMetricTile(metric: content.batteryMetric)
                    BatteryRangeChartsMetricTile(metric: content.rangeMetric)
                }
                .frame(maxWidth: .infinity)
            }
            BatteryRangeChartsBatteryBarChart(bars: content.batteryBars)
        }
    }
}

// MARK: - Radial battery gauge (web `RadialGauge value={battery_level} max={100} unit="%"`)

/// The radial battery gauge: a faint track ring, the band-colored progress arc (Reduce-Motion
/// aware fill), the centered numeric percent, and the "Battery" label beneath. One VoiceOver
/// element reading "Battery: {n}%".
struct BatteryRangeChartsGaugeView: View {
    let gauge: BatteryRangeChartsGauge

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let diameter: CGFloat = 104
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
            BatteryRangeChartsStrings.text("common.battery", "Battery")
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

// MARK: - Metric tile (web `<GlassPanel><span>label</span><AnimatedNumber/></GlassPanel>`)

/// One metric tile — the muted label over the animated value (web `AnimatedNumber`), reusing the
/// shared `TSAnimatedNumber` (Reduce-Motion aware). One VoiceOver element reading "{label}:
/// {value}".
struct BatteryRangeChartsMetricTile: View {
    let metric: BatteryRangeChartsMetric

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: metric.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            TSAnimatedNumber(formatted: metric.value)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
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
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013). Shown only when the
/// source is not live, so the normal surface stays as clean as the web source (which has no
/// chrome).
struct BatteryRangeChartsFreshnessChip: View {
    let connection: BatteryRangeChartsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: BatteryRangeChartsStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: BatteryRangeChartsStrings.string(descriptor.key, descriptor.fallback))
        )
    }

    private static func descriptor(for connection: BatteryRangeChartsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "vehicles.detail.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "vehicles.detail.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "vehicles.detail.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the panels when the bound source is not live, so the
/// last-known snapshot is clearly labeled as cached. A manual refresh affordance accompanies the
/// stale state (offline has no connectivity to retry over).
struct BatteryRangeChartsBanner: View {
    let connection: BatteryRangeChartsConnection
    let onRefresh: () -> Void

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: descriptor.systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(descriptor.tone)
                .accessibilityHidden(true)
            Text(verbatim: BatteryRangeChartsStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            if connection == .stale {
                TSButton(variant: .ghost, size: .small, action: onRefresh) {
                    BatteryRangeChartsStrings.text("vehicles.detail.refresh", "Refresh")
                }
                .accessibilityLabel(BatteryRangeChartsStrings.text("vehicles.detail.refresh", "Refresh"))
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            descriptor.tone.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
        let systemImage: String
    }

    private static func descriptor(for connection: BatteryRangeChartsConnection) -> Descriptor {
        switch connection {
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                key: "vehicles.detail.offlineBanner",
                fallback: "Offline — showing the last loaded battery and drive data",
                systemImage: "wifi.slash"
            )
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                key: "vehicles.detail.staleBanner",
                fallback: "Reconnecting — battery and drive data may be stale",
                systemImage: "clock.arrow.circlepath"
            )
        case .live:
            Descriptor(
                tone: Color.TS.statusSuccess,
                key: "vehicles.detail.live",
                fallback: "Live",
                systemImage: "checkmark.circle"
            )
        }
    }
}
