import SwiftUI

/// The hero battery ring on the watch glance: a trimmed circle that fills with the
/// charge fraction, a bolt when charging, and the percent + range stacked in the
/// centre. Tinted by the same thresholds as the web watch face.
struct WatchBatteryRing: View {
    let fraction: Double
    let centerText: String
    let subText: String?
    let isCharging: Bool

    private var clamped: Double {
        min(1, max(0, fraction))
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.TS.surface, lineWidth: 10)
            Circle()
                .trim(from: 0, to: max(0.004, clamped))
                .stroke(
                    WatchFormat.batteryColor(fraction),
                    style: StrokeStyle(lineWidth: 10, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            VStack(spacing: 1) {
                if isCharging {
                    Image(systemName: "bolt.fill")
                        .font(.caption2)
                        .foregroundStyle(Color.TS.statusSuccess)
                }
                Text(centerText)
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                if let subText {
                    Text(subText)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(centerText))
        .accessibilityValue(Text(subText ?? ""))
    }
}
