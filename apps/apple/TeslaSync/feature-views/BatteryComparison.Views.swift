//
//  BatteryComparison.Views.swift
//  TeslaSync — P4 feature view · 0275 · BatteryComparison (Apple)
//
//  Presentational chrome composed by `BatteryComparison`: the panel header (Activity glyph +
//  title) + freshness chip, the stale/offline connectivity banner, the per-vehicle battery bars
//  (web `linear-gradient` fill + glow → a tinted `LinearGradient` Capsule), and the loading /
//  empty / error states. All copy resolves through the P1/S10 facade; all chrome is token-driven
//  (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Tint → design token (web `batteryColor` hex → semantic role)

extension BatteryComparisonTint {
    /// The semantic design-token colour for the bar fill — the platform mapping of the web
    /// `batteryColor` hex constants (ADR-006 semantic colour parity), so light / dark / high
    /// contrast all resolve.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }
}

// MARK: - Header (title + Activity glyph + freshness chip)

/// The panel header: the web `<h3>` with the lucide `Activity` glyph (cyan) + the "Fleet Battery
/// Status" title, plus the live-state freshness chip.
struct BatteryComparisonHeader: View {
    let connection: BatteryComparisonConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            BatteryComparisonStrings.text("fleet.batteryStatus", "Fleet Battery Status")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            BatteryComparisonFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct BatteryComparisonFreshnessChip: View {
    let connection: BatteryComparisonConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            BatteryComparisonStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(BatteryComparisonStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: BatteryComparisonConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "fleet.battery.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "fleet.battery.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "fleet.battery.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the bars when the bound source is not live, so cached bars
/// are clearly labelled (web `DataFreshness` intent).
struct BatteryComparisonConnectivityBanner: View {
    let connection: BatteryComparisonConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "fleet.battery.offlineBanner" : "fleet.battery.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded battery levels"
            : "Reconnecting — battery levels may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            BatteryComparisonStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Bar track (web `linear-gradient` fill + glow)

/// One bar's fill track — the native parity of the web `h-3 rounded-full` track with a
/// `linear-gradient(90deg, color80, color)` fill and a `box-shadow` glow. The fill width is the
/// pre-clamped `fraction` of the available width.
struct BatteryComparisonTrack: View {
    let fraction: Double
    let tint: BatteryComparisonTint

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule(style: .continuous)
                    .fill(Color.TS.border.opacity(0.5))
                Capsule(style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [tint.color.opacity(0.5), tint.color],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(0, geo.size.width * fraction))
                    .shadow(color: tint.color.opacity(0.35), radius: 5)
            }
        }
        .frame(height: 12)
        .accessibilityHidden(true)
    }
}

// MARK: - Bar row (web row: name · track · percent · range)

/// One vehicle's battery row — the native mirror of a web row: the truncated vehicle label, the
/// tinted fill track, the percent readout, and the formatted rated range.
struct BatteryComparisonRow: View {
    let bar: BatteryComparisonBar

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: bar.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(width: 96, alignment: .leading)
            BatteryComparisonTrack(fraction: bar.fraction, tint: bar.tint)
            Text(verbatim: bar.percentText)
                .font(Font.TS.label)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .frame(width: 40, alignment: .trailing)
            Text(verbatim: bar.rangeText)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 64, alignment: .trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: BatteryComparisonAccessibility.rowValue(bar)))
    }
}

// MARK: - Bars list (content)

/// The stack of per-vehicle battery rows (web `div.space-y-3`).
struct BatteryComparisonList: View {
    let bars: [BatteryComparisonBar]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(bars) { bar in
                BatteryComparisonRow(bar: bar)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a few muted rows mirroring the bar layout, respecting Reduce
/// Motion (via `TSSkeleton`).
struct BatteryComparisonLoading: View {
    private let rowCount = 4

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< rowCount, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 96, height: 12, cornerRadius: 6)
                    TSSkeleton(height: 12, cornerRadius: 6)
                    TSSkeleton(width: 40, height: 12, cornerRadius: 6)
                    TSSkeleton(width: 64, height: 12, cornerRadius: 6)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(BatteryComparisonStrings.text("fleet.battery.loading", "Loading battery levels"))
    }
}

// MARK: - Empty state (web returns null → native friendly empty surface)

/// The resolved-but-empty state. The web component returns `null` when no vehicle state resolves;
/// the prompt requires a friendly empty surface here instead of a blank box.
struct BatteryComparisonEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                BatteryComparisonStrings.text("fleet.battery.emptyTitle", "No battery data")
            } icon: {
                Image(systemName: "minus.plus.batteryblock")
            }
        } description: {
            BatteryComparisonStrings.text(
                "fleet.battery.emptyHint",
                "Battery levels will appear here once your vehicles report their state."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 120)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline error
/// treatment used across the feature-view surfaces.
struct BatteryComparisonErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            BatteryComparisonStrings.text("fleet.battery.errorTitle", "Couldn't load battery levels")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                BatteryComparisonStrings.text("fleet.battery.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(BatteryComparisonStrings.text("fleet.battery.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
