//
//  DriveScoreWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0040 · DriveScoreWidget (Apple)
//
//  The presentational subviews composed by `DriveScoreWidget`: the gauge hero (web
//  `WidgetGaugeHero`), the radial score gauge (web `RadialGauge`), the efficiency stat,
//  the stale/offline connectivity banner, and the friendly "No data yet" empty state.
//  All consume pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens —
//  no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Gauge hero (web `WidgetGaugeHero`)

/// The score gauge plus the efficiency stat — the native port of the web
/// `WidgetGaugeHero`. In compact mode the gauge shrinks and the stat is dropped (web
/// `compact` hides the stats row). The whole hero is one VoiceOver element speaking the
/// score, band, and efficiency.
struct DriveScoreGaugeHero: View {
    let readout: DriveScoreReadout
    var compact: Bool = false

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            DriveScoreWidgetGauge(readout: readout, diameter: compact ? 84 : 116)
            if !compact {
                DriveScoreStatRow(readout: readout)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: DriveScoreAccessibility.gaugeSummary(
            readout: readout,
            scoreLabel: DriveScoreStrings.string("widget.score", "Score"),
            efficiencyLabel: DriveScoreStrings.string("widget.efficiency", "Efficiency"),
            band: DriveScoreStrings.string(readout.band.localization.key, readout.band.localization.fallback)
        )))
    }
}

// MARK: - Radial gauge (web `RadialGauge`)

/// The circular score gauge — the native port of the web `RadialGauge`. A muted track
/// ring with a rounded value arc trimmed to `score / 100`, tinted by the score band, the
/// score number centered, and the "Score" label beneath. Decorative — the enclosing hero
/// owns the spoken summary.
struct DriveScoreWidgetGauge: View {
    let readout: DriveScoreReadout
    var diameter: CGFloat = 116
    private let lineWidth: CGFloat = 10

    private var fraction: Double {
        max(0, min(Double(readout.score) / 100.0, 1))
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.4), lineWidth: lineWidth)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(readout.band.tone.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text(verbatim: readout.formattedScore)
                    .font(.system(size: diameter * 0.28, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
            .frame(width: diameter, height: diameter)
            DriveScoreStrings.text("widget.score", "Score")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Efficiency stat (web `GaugeHeroStat`)

/// The single efficiency stat beneath the gauge — the native port of the web
/// `GaugeHeroStat` (label + value + unit). Decorative — the hero speaks it.
struct DriveScoreStatRow: View {
    let readout: DriveScoreReadout

    var body: some View {
        VStack(spacing: 2) {
            DriveScoreStrings.text("widget.efficiency", "Efficiency")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: readout.formattedEfficiency)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: readout.efficiencyUnit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the gauge when the bound source is not live, so
/// the cached score is clearly labeled (web freshness-indicator intent).
struct DriveScoreConnectivityBanner: View {
    let connection: DriveScoreConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.driveScore.offlineBanner" : "widget.driveScore.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded score"
            : "Refreshing — this score may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            DriveScoreStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty state (web `EmptyState` "No data yet")

/// The "No data yet" empty state — always rendered in place of a blank panel (web
/// `EmptyState` with the `TrendingUp` glyph).
struct DriveScoreEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                DriveScoreStrings.text("widget.noScore", "No data yet")
            } icon: {
                Image(systemName: "chart.line.uptrend.xyaxis")
            }
        } description: {
            DriveScoreStrings.text(
                "widget.driveScore.emptyHint",
                "Your weekly driving score appears once there are drives to analyze."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
