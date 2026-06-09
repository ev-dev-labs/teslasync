//
//  ChargeStatusLiveWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0020 · ChargeStatusLiveWidget (Apple)
//
//  The loaded-content sub-views for ChargeStatusLiveWidget, split out of the surface file so each
//  stays focused and within the file-length budget. Each is the SwiftUI parity of a render branch
//  from features/dashboard/widgets/ChargeStatusLiveWidget.tsx (FullChargingView / IdleView /
//  CompactChargingView / CompactIdleView / MetricCell / Badge / AnimatedNumber / animate-pulse).
//

import SwiftUI

// MARK: - Full: actively charging (web `FullChargingView`)

struct ChargeStatusFullChargingView: View {
    let projection: ChargeStatusProjection
    let isTall: Bool

    private var metricColumns: [GridItem] {
        [
            GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .leading),
            GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .leading)
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            statusHeader
            primaryPower
            LazyVGrid(columns: metricColumns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(projection.chargingMetrics) { ChargeStatusMetricCell(metric: $0) }
            }
            if isTall {
                Divider().overlay(Color.TS.border)
                LazyVGrid(columns: metricColumns, alignment: .leading, spacing: TSSpacing.sm) {
                    ForEach(projection.tallMetrics) { ChargeStatusMetricCell(metric: $0) }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var statusHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                ChargeStatusPulsingIcon(systemName: "battery.100.bolt", color: Color.TS.statusSuccess)
                ChargeStatusChargingBadge()
            }
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: projection.batteryText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .monospacedDigit()
        }
    }

    private var primaryPower: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            ChargeStatusAnimatedValue(
                text: projection.powerValueText,
                font: Font.TS.title,
                color: Color.TS.statusSuccess
            )
            Text(verbatim: projection.powerUnit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(projection.powerValueText) \(projection.powerUnit)"))
    }
}

// MARK: - Full: not charging (web `IdleView`)

struct ChargeStatusIdleView: View {
    let projection: ChargeStatusProjection

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "powerplug")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VStack(spacing: 2) {
                ChargeStatusLiveStrings.text("widget.notCharging", "Not Charging")
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: projection.batteryText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .monospacedDigit()
            }
            if let last = projection.lastSessionEnergyText {
                lastSessionPanel(last)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }

    private func lastSessionPanel(_ last: String) -> some View {
        VStack(spacing: 2) {
            ChargeStatusLiveStrings.text("widget.lastSession", "Last Session")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: last)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
                .monospacedDigit()
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Compact: charging (web `CompactChargingView`)

struct ChargeStatusCompactChargingView: View {
    let projection: ChargeStatusProjection

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ChargeStatusPulsingIcon(systemName: "battery.100.bolt", color: Color.TS.statusSuccess)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                ChargeStatusAnimatedValue(
                    text: projection.powerValueText,
                    font: Font.TS.panel,
                    color: Color.TS.statusSuccess
                )
                Text(verbatim: projection.powerUnit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusSuccess)
            }
            Text(verbatim: projection.batteryText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Compact: idle (web `CompactIdleView`)

struct ChargeStatusCompactIdleView: View {
    let projection: ChargeStatusProjection

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "powerplug")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: projection.batteryText)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .monospacedDigit()
            ChargeStatusLiveStrings.text("widget.notCharging", "Not Charging")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Metric cell (web `MetricCell`)

struct ChargeStatusMetricCell: View {
    let metric: ChargeMetric

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: metric.systemImage)
                .font(.system(size: 11))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: metric.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: metric.value)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(metric.label) \(metric.value)"))
    }
}

// MARK: - Charging badge (web `<Badge variant="success">Charging</Badge>`)

struct ChargeStatusChargingBadge: View {
    var body: some View {
        ChargeStatusLiveStrings.text("widget.charging", "Charging")
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.statusSuccess)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusSuccess.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.statusSuccess.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(ChargeStatusLiveStrings.text("widget.charging", "Charging"))
    }
}

// MARK: - Animated value (web `AnimatedNumber`)

/// A monospaced numeric value that animates between renders via `numericText` content transition,
/// the native parity of the web `AnimatedNumber`. Honors Reduce Motion.
struct ChargeStatusAnimatedValue: View {
    let text: String
    let font: Font
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(verbatim: text)
            .font(font)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(color)
            .contentTransition(.numericText())
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: text)
    }
}

// MARK: - Pulsing icon (web `animate-pulse`)

/// An SF Symbol with a gentle opacity pulse, the native parity of the web `animate-pulse` applied
/// to the charging glyph. Pulsing is disabled under Reduce Motion.
struct ChargeStatusPulsingIcon: View {
    let systemName: String
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(color)
            .opacity(reduceMotion ? 1 : (pulsing ? 0.45 : 1))
            .animation(
                reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
                value: pulsing
            )
            .onAppear { pulsing = true }
            .accessibilityHidden(true)
    }
}
