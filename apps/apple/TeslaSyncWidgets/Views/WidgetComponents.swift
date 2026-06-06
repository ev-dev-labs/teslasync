import SwiftUI
import WidgetKit

/// Brand tint for a battery level: red when low, amber when moderate, green when
/// charging or healthy. Pure mapping so it can be reasoned about and reused.
enum WidgetBatteryStyle {
    static func tint(fraction: Double, isCharging: Bool) -> Color {
        if isCharging { return Color.TS.statusSuccess }
        if fraction < 0.15 { return Color.TS.statusDanger }
        if fraction < 0.30 { return Color.TS.statusWarning }
        return Color.TS.accent
    }
}

/// A circular battery gauge. Works in every family; the ring thickness scales with
/// the available size.
struct WidgetBatteryRing: View {
    let fraction: Double
    let centerText: String
    var isCharging = false
    var lineWidth: CGFloat = 8

    private var tint: Color {
        WidgetBatteryStyle.tint(fraction: fraction, isCharging: isCharging)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.TS.border, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0.001, fraction))
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                if isCharging {
                    Image(systemName: "bolt.fill")
                        .font(.caption2)
                        .foregroundStyle(tint)
                }
                Text(verbatim: centerText)
                    .font(Font.TS.panel.monospacedDigit())
                    .foregroundStyle(Color.TS.textPrimary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("widget.vehicle.battery"))
        .accessibilityValue(Text(verbatim: centerText))
    }
}

/// A rounded linear progress bar (charging progress, energy split).
struct WidgetLinearProgress: View {
    let fraction: Double
    var tint: Color = .TS.accent

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.TS.border)
                Capsule()
                    .fill(tint)
                    .frame(width: max(0, min(1, fraction)) * proxy.size.width)
            }
        }
        .frame(height: 6)
        .accessibilityValue(Text(verbatim: "\(Int((fraction * 100).rounded()))%"))
    }
}

/// A compact label-over-value metric cell.
struct WidgetMetric: View {
    let titleKey: LocalizedStringKey
    let value: String
    var alignment: HorizontalAlignment = .leading

    var body: some View {
        VStack(alignment: alignment, spacing: 1) {
            Text(titleKey)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.panel.monospacedDigit())
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
        .accessibilityElement(children: .combine)
    }
}

/// A prominent value with a small caption beneath it.
struct WidgetBigValue: View {
    let value: String
    let captionKey: LocalizedStringKey

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: value)
                .font(Font.TS.title.monospacedDigit())
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(captionKey)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}
