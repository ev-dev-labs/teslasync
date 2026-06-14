//
//  WatchSummaryWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0114 · WatchSummaryWidget (Apple)
//
//  The presentational subviews for the WatchSummaryWidget surface — the Apple-idiomatic parity of
//  the web shared components the widget composes:
//    • RadialGauge        → `WatchBatteryRing` (a trimmed-circle battery gauge, HIG-native)
//    • StatusBadge        → `WatchStatePill`   (tone dot + capitalized state)
//    • WidgetBigNumber    → `WatchBigNumber`   (hero battery value + label + state badge)
//    • Badge              → `WatchBadgeChip`   (tone pill used for state / lock)
//    • Lock / Unlock      → `WatchLockChip`    (SF Symbol + Locked/Unlocked chip)
//    • the detail tiles   → `WatchStatCell`    (uppercase caption + value / placeholder) // parity:allow ui
//    • Skeleton           → `WatchSummarySkeleton` (loading chrome)
//
//  All colours come from the P1/S9 design tokens (`Color.TS`), never hardcoded.
//

import SwiftUI

// MARK: - Tone → token palette

/// Maps the adapter's SwiftUI-free `WatchTone` onto the design-token palette, so colour selection
/// lives in exactly one place.
enum WatchTonePalette {
    static func color(_ tone: WatchTone) -> Color {
        switch tone {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        case .neutral: Color.TS.textMuted
        }
    }

    /// The battery arc colour — the web `getBatteryColor` bands plus the `null` grey track.
    static func batteryColor(_ tone: WatchBatteryTone) -> Color {
        switch tone {
        case .good: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        case .unknown: Color.TS.textMuted
        }
    }
}

// MARK: - Battery ring (RadialGauge parity)

/// A trimmed-circle battery gauge — the Apple-idiomatic parity of the web `RadialGauge`: a grey
/// track, a tone-coloured progress arc with a rounded cap starting at 12 o'clock, and the centred
/// `NN%` readout. Honours Reduce Motion by skipping the fill animation.
struct WatchBatteryRing: View {
    let value: Double
    let valueText: String
    let tone: WatchBatteryTone
    var diameter: CGFloat = 84
    var lineWidth: CGFloat = 8

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var fraction: CGFloat {
        let clamped = min(max(value, 0), 100)
        return CGFloat(clamped / 100)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.TS.border, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(
                    WatchTonePalette.batteryColor(tone),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(reduceMotion ? nil : .easeOut(duration: 0.4), value: fraction)
            centerLabel
        }
        .frame(width: diameter, height: diameter)
        .accessibilityHidden(true)
    }

    private var centerLabel: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: valueText)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: "%")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(Color.TS.textSecondary)
        }
        .monospacedDigit()
        .minimumScaleFactor(0.6)
        .lineLimit(1)
    }
}

// MARK: - Badge chip (web Badge parity)

/// A small tone-coloured pill — the parity of the web `Badge` (`bg-tone/10`, `border-tone/20`,
/// `text-tone`). Used for the standard-view state badge and the lock chip.
struct WatchBadgeChip: View {
    let text: String
    let tone: WatchTone

    var body: some View {
        let color = WatchTonePalette.color(tone)
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(color.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.22), lineWidth: 1))
            .lineLimit(1)
    }
}

// MARK: - State pill (compact StatusBadge parity)

/// The compact `StatusBadge` parity: a tone dot + the capitalized state label inside a subtle
/// pill.
struct WatchStatePill: View {
    let state: WatchStateView

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(WatchTonePalette.color(state.compactTone))
                .frame(width: 6, height: 6)
            Text(verbatim: state.compactLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
    }
}

// MARK: - Big number hero (WidgetBigNumber parity)

/// The standard-view hero — the parity of the web `WidgetBigNumber`: a large battery value with a
/// `%` unit, an uppercase label, and the state badge below.
struct WatchBigNumber: View {
    let valueText: String
    let label: String
    let badge: (text: String, tone: WatchTone)?

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: valueText)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(Color.TS.textPrimary)
                    .monospacedDigit()
                Text(verbatim: "%")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .minimumScaleFactor(0.6)
            .lineLimit(1)

            Text(verbatim: label)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)

            if let badge {
                WatchBadgeChip(text: badge.text, tone: badge.tone)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Lock chip (web Lock/Unlock + Badge parity)

/// The lock tile body — an SF Symbol (locked → success, unlocked → warning) plus the
/// `Locked`/`Unlocked` badge, or the em-dash placeholder when the lock state is unknown. // parity:allow ui
struct WatchLockChip: View {
    let lock: WatchLockState
    let lockedText: String
    let unlockedText: String

    var body: some View {
        switch lock {
        case .locked:
            chip(symbol: "lock.fill", text: lockedText, tone: .success)
        case .unlocked:
            chip(symbol: "lock.open.fill", text: unlockedText, tone: .warning)
        case .unknown:
            Text(verbatim: WatchSummaryProjection.placeholder) // parity:allow ui
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func chip(symbol: String, text: String, tone: WatchTone) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(WatchTonePalette.color(tone))
                .accessibilityHidden(true)
            WatchBadgeChip(text: text, tone: tone)
        }
    }
}

// MARK: - Stat cell (detail grid tile)

/// One detail tile in the standard 2-column grid: an uppercase caption over a centred value. The
/// value is supplied as content so callers can compose a number+unit, a lock chip, or a relative
/// timestamp.
struct WatchStatCell<Content: View>: View {
    let caption: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: caption)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            content
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .padding(TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}

/// A `value + unit` readout used by the range + cabin tiles. Renders the em-dash placeholder (no // parity:allow ui
/// unit) when there is no value.
struct WatchValueUnit: View {
    let valueText: String
    let unit: String
    let hasValue: Bool

    var body: some View {
        if hasValue {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: valueText)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.TS.textPrimary)
                    .monospacedDigit()
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        } else {
            Text(verbatim: WatchSummaryProjection.placeholder) // parity:allow ui
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Charging indicator (compact "⚡ Charging")

/// The compact "⚡ Charging" indicator — a pulsing bolt + label, shown when the complication
/// reports charging. Honours Reduce Motion by holding a steady opacity.
struct WatchChargingPip: View {
    let text: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 9, weight: .bold))
            Text(verbatim: text)
                .font(.system(size: 10, weight: .medium))
        }
        .foregroundStyle(Color.TS.statusSuccess)
        .opacity(pulsing ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
    }
}

// MARK: - Loading skeleton

/// The loading chrome — a redacted ring + label placeholders that mirror the eventual content // parity:allow ui
/// footprint (the web `WidgetShell` renders `<Skeleton className="h-full rounded-xl" />`).
struct WatchSummarySkeleton: View {
    var compact: Bool

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(Color.TS.surfaceGlass)
                .frame(width: compact ? 84 : 72, height: compact ? 84 : 72)
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(Color.TS.surfaceGlass)
                .frame(width: 64, height: 12)
            if !compact {
                HStack(spacing: TSSpacing.sm) {
                    skeletonTile
                    skeletonTile
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .redacted(reason: .placeholder) // parity:allow ui
    }

    private var skeletonTile: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(height: 44)
    }
}
