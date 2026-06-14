//
//  BatteryHealthAnalyticsWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0014 · BatteryHealthAnalyticsWidget (Apple)
//
//  The presentational subviews composed by `BatteryHealthAnalyticsWidget`, each mapping a web shared
//  component onto an Apple-idiomatic primitive:
//    • `BatteryHealthRadialGauge`    ← web `RadialGauge` (@/components/charts) inside `WidgetGaugeHero`
//    • `BatteryHealthStatCluster`    ← web `WidgetGaugeHero` `stats` cluster
//    • `BatteryHealthLoadingView` / `BatteryHealthConnectivityBanner` ← web `WidgetShell` chrome
//  All consume the pre-projected values + pre-localized strings (P1/S10) and the shared P1/S9 tokens
//  — no networking, no Tailwind.
//

import SwiftUI

// MARK: - Score band → colour (web `scoreColor`)

extension BatteryHealthScoreBand {
    /// The exact web `scoreColor` hex value for the band, expressed in sRGB so the native gauge tints
    /// identically to the web widget (`#10b981` / `#f59e0b` / `#ef4444`).
    var color: Color {
        switch self {
        case .good: Color(.sRGB, red: 16 / 255, green: 185 / 255, blue: 129 / 255, opacity: 1)
        case .fair: Color(.sRGB, red: 245 / 255, green: 158 / 255, blue: 11 / 255, opacity: 1)
        case .poor: Color(.sRGB, red: 239 / 255, green: 68 / 255, blue: 68 / 255, opacity: 1)
        }
    }
}

// MARK: - Radial gauge (web `RadialGauge`)

/// The Apple-idiomatic counterpart of the web `RadialGauge` SVG ring: a track + a banded value arc
/// starting at 12 o'clock, a centred state-of-health readout with the "health" unit beneath it, and
/// the integer score sub-label below the ring. The arc fill animates on change unless Reduce Motion
/// is on.
struct BatteryHealthRadialGauge: View {
    let gauge: BatteryHealthAnalyticsWidgetGauge
    var diameter: CGFloat = 100

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var lineWidth: CGFloat {
        max(6, diameter * 0.08)
    }

    private var clampedFraction: Double {
        min(max(gauge.fraction, 0), 1)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.6), style: StrokeStyle(lineWidth: lineWidth))
                Circle()
                    .trim(from: 0, to: clampedFraction)
                    .stroke(gauge.band.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration),
                        value: clampedFraction
                    )
                centerReadout
            }
            .frame(width: diameter, height: diameter)

            Text(verbatim: gauge.scoreLabel)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: gauge.accessibilityLabel))
    }

    private var centerReadout: some View {
        VStack(spacing: 0) {
            Text(verbatim: gauge.valueText)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: gauge.unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .padding(.horizontal, lineWidth)
    }
}

// MARK: - Stat cluster (web `WidgetGaugeHero` `stats`)

/// The wrapping grid of stat readouts beneath the gauge — the native counterpart of the web
/// `WidgetGaugeHero` `stats` cluster: each entry is a muted label over its value + optional unit
/// glyph. Uses an adaptive grid so the six stats reflow to the widget width like the web `flex-wrap`.
struct BatteryHealthStatCluster: View {
    let stats: [BatteryHealthAnalyticsWidgetStat]

    private let columns = [GridItem(.adaptive(minimum: 84), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.sm) {
            ForEach(stats) { stat in
                statCell(stat)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func statCell(_ stat: BatteryHealthAnalyticsWidgetStat) -> some View {
        VStack(spacing: 2) {
            Text(verbatim: stat.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: stat.valueText)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .monospacedDigit()
                if !stat.unit.isEmpty {
                    Text(verbatim: stat.unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: stat.accessibilityLabel))
    }
}

// MARK: - Loading skeleton (web `WidgetShell` `loading`)

/// The initial-fetch skeleton: a circular gauge empty state over a grid of stat empty states, matching
/// the loaded hero's rhythm. Honors Reduce Motion via `TSSkeleton`.
struct BatteryHealthLoadingView: View {
    var showStats = true
    var statCount = 6

    private let columns = [GridItem(.adaptive(minimum: 84), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 100, height: 100, cornerRadius: 50)
            TSSkeleton(width: 48, height: 12, cornerRadius: TSRadius.sm)
            if showStats {
                LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
                    ForEach(0 ..< statCount, id: \.self) { _ in
                        VStack(spacing: 4) {
                            TSSkeleton(width: 56, height: 10, cornerRadius: TSRadius.sm)
                            TSSkeleton(width: 40, height: 12, cornerRadius: TSRadius.sm)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: BatteryHealthAnalyticsWidgetStrings.string(
            "widget.batteryHealthAnalytics.loading",
            "Loading battery health"
        )))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the gauge when the bound source is not live, so the cached
/// health is clearly labeled (web freshness-indicator intent).
struct BatteryHealthConnectivityBanner: View {
    let connection: BatteryHealthAnalyticsWidgetConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline
            ? "widget.batteryHealthAnalytics.offlineBanner"
            : "widget.batteryHealthAnalytics.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known battery health"
            : "Reconnecting — battery health may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: BatteryHealthAnalyticsWidgetStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
