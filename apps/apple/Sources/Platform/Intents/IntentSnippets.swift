import SwiftUI

/// Glanceable snippet shown beneath the spoken charging-status result. Self
/// contained SwiftUI (no networking, no PII) so it renders inside the Siri /
/// Shortcuts result card.
struct ChargingStatusSnippet: View {
    let summary: ChargingSummary

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .stroke(.secondary.opacity(0.25), lineWidth: 6)
                Circle()
                    .trim(from: 0, to: summary.batteryFraction)
                    .stroke(.green, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Image(systemName: summary.isActive ? "bolt.fill" : "bolt.slash")
                    .foregroundStyle(summary.isActive ? .green : .secondary)
            }
            .frame(width: 48, height: 48)

            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: summary.batteryDisplay)
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                if let power = summary.powerDisplay {
                    Text(verbatim: power)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let added = summary.addedDisplay {
                    Text(verbatim: added)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
    }
}

/// Glanceable snippet for the latest open alert.
struct LatestAlertSnippet: View {
    let summary: AlertSummary

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: summary.criticalCount > 0 ? "exclamationmark.triangle.fill" : "bell.fill")
                .font(.title2)
                .foregroundStyle(summary.criticalCount > 0 ? .red : .yellow)
                .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 2) {
                if let title = summary.latestTitle {
                    Text(verbatim: title)
                        .font(.headline)
                        .lineLimit(2)
                }
                Text("intent.alert.openCount \(summary.openCount)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
    }
}
