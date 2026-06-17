import SwiftUI

// MARK: - Current position stats (web "Current Position Stats" GlassPanel)

/// The live stat bar under the playhead (web `GlassPanel` + six `MetricCard`s). The grid reflows
/// across macOS / iPad regular width and compact iPhone (ADR-002/006); each card reads from the
/// bound model and rings when the playhead sits on a related marker (web `cardHighlight`).
struct TripsReplayStatsSection: View {
    let model: TripsReplayModel
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("replay.currentStats")
                LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                    ForEach(model.currentStats(units: units)) { stat in
                        TripsReplayStatCard(stat: stat)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - One stat card (web `MetricCard`)

/// A single current-position metric card: icon, label, and the display-unit value, with an accent
/// ring when its marker is active (web `cardHighlight`).
struct TripsReplayStatCard: View {
    let stat: TripsReplayStatValue

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                TSMetricLabel(stat.kind.titleKey)
                Spacer()
                Image(systemName: stat.kind.systemImage)
                    .font(.caption)
                    .foregroundStyle(Color.TS.accent)
            }
            Text(verbatim: stat.value)
                .font(Font.TS.panel)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(stat.isActive ? Color.TS.accent : Color.TS.border, lineWidth: stat.isActive ? 2 : 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(stat.isActive ? .isSelected : [])
    }
}
