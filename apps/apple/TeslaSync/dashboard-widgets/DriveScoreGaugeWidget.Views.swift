//
//  DriveScoreGaugeWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0039 · DriveScoreGaugeWidget (Apple)
//
//  The presentational subviews composed by `DriveScoreGaugeWidget`, each mapping a web shared
//  component onto an Apple-idiomatic primitive:
//    • `DriveScoreRadialGauge`   ← web `RadialGauge` (@/components/charts) inside `WidgetGaugeHero`
//    • `DriveScoreStatCluster`   ← web `WidgetGaugeHero` `stats` row
//    • `DriveScoreMetricBar`     ← web `MetricBar` (@/components/data-display)
//    • `DriveScoreGaugeLoadingView` / `GaugeDriveScoreConnectivityBanner` ← web `WidgetShell` chrome
//  All consume the pre-projected values + pre-localized strings (P1/S10) and the shared P1/S9 tokens
//  — no networking, no Tailwind.
//

import SwiftUI

// MARK: - Score band → colour (web `SCORE_COLORS`)

extension GaugeDriveScoreBand {
    /// The exact web `SCORE_COLORS` hex value for the band, expressed in sRGB so the native gauge +
    /// bars tint identically to the web widget (`#10b981` / `#22d3ee` / `#f59e0b` / `#ef4444`).
    var color: Color {
        switch self {
        case .excellent: Color(.sRGB, red: 16 / 255, green: 185 / 255, blue: 129 / 255, opacity: 1)
        case .good: Color(.sRGB, red: 34 / 255, green: 211 / 255, blue: 238 / 255, opacity: 1)
        case .fair: Color(.sRGB, red: 245 / 255, green: 158 / 255, blue: 11 / 255, opacity: 1)
        case .poor: Color(.sRGB, red: 239 / 255, green: 68 / 255, blue: 68 / 255, opacity: 1)
        }
    }
}

// MARK: - Radial gauge (web `RadialGauge`)

/// The Apple-idiomatic counterpart of the web `RadialGauge` SVG ring: a track + a banded value arc
/// starting at 12 o'clock, a centred score readout with the "Weekly score" unit beneath it, and the
/// grade caption below the ring. The arc fill animates on change unless Reduce Motion is on.
struct DriveScoreRadialGauge: View {
    let gauge: DriveScoreGaugeWidgetGauge
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

            Text(verbatim: gauge.gradeLabel)
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

// MARK: - Sub-score stat cluster (web `WidgetGaugeHero` `stats`)

/// The row of sub-score readouts beneath the gauge — the native counterpart of the web
/// `WidgetGaugeHero` `stats` cluster: each entry is a muted label over its value.
struct DriveScoreStatCluster: View {
    let stats: [DriveScoreGaugeWidgetStat]

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            ForEach(stats) { stat in
                VStack(spacing: 2) {
                    Text(verbatim: stat.label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(verbatim: stat.valueText)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Metric bar (web `MetricBar`)

/// A labelled, banded fill bar — the native counterpart of the web `MetricBar`. Renders the label +
/// value readout above a track whose fill width is the score fraction, tinted by the score band. The
/// fill animates in on appear unless Reduce Motion is on.
struct DriveScoreMetricBar: View {
    let bar: DriveScoreGaugeWidgetBar

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animatedFraction: Double = 0

    private var clampedFraction: Double {
        min(max(bar.fraction, 0), 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: bar.label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: bar.valueText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(bar.band.color)
            }
            track
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: bar.accessibilityLabel))
        .onAppear {
            guard !reduceMotion else { animatedFraction = clampedFraction; return }
            withAnimation(.easeOut(duration: TSMotion.slowDuration)) {
                animatedFraction = clampedFraction
            }
        }
        .onChange(of: clampedFraction) { _, newValue in
            withAnimation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration)) {
                animatedFraction = newValue
            }
        }
    }

    private var track: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.TS.border)
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [bar.band.color.opacity(0.6), bar.band.color],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(0, geo.size.width * animatedFraction))
            }
        }
        .frame(height: 8)
    }
}

// MARK: - Loading skeleton (web `WidgetShell` `loading`)

/// The initial-fetch skeleton: a circular gauge empty state over a stack of bar empty states, matching
/// the loaded hero's rhythm. Honors Reduce Motion via `TSSkeleton`.
struct DriveScoreGaugeLoadingView: View {
    var barCount = 3

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 100, height: 100, cornerRadius: 50)
            TSSkeleton(width: 56, height: 12, cornerRadius: TSRadius.sm)
            VStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< barCount, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(height: 10, cornerRadius: TSRadius.sm)
                        TSSkeleton(height: 8, cornerRadius: TSRadius.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: DriveScoreGaugeWidgetStrings.string(
            "widget.driveScoreGauge.loading",
            "Loading drive score"
        )))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the gauge when the bound source is not live, so the cached
/// score is clearly labeled (web freshness-indicator intent).
struct GaugeDriveScoreConnectivityBanner: View {
    let connection: DriveScoreGaugeWidgetConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.driveScoreGauge.offlineBanner" : "widget.driveScoreGauge.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known score"
            : "Reconnecting — score may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: DriveScoreGaugeWidgetStrings.string(key, fallback))
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
