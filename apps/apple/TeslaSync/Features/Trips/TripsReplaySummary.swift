import SwiftUI

// MARK: - Drive summary (web "Drive Summary" GlassPanel)

/// The drive-summary panel (web `GlassPanel` + eight `StatCard`s): distance, duration, efficiency,
/// elevation gain / loss, max / avg speed, and the battery start → end. The grid reflows across
/// macOS / iPad regular width and compact iPhone (ADR-002/006); every tile reads its display-unit
/// value from the bound model.
struct TripsReplaySummarySection: View {
    let model: TripsReplayModel
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("replay.summary.title")
                LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                    ForEach(model.summaryItems(units: units)) { item in
                        TSStatCard(
                            title: item.kind.titleKey,
                            value: item.value,
                            systemImage: item.kind.systemImage
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}
