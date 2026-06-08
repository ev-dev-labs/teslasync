import SwiftUI

// MARK: - Freshness chip

/// Header chip flagging stale / offline data (reuses the native widget-chrome
/// `widget.freshness.*` catalog keys shared with the WidgetKit surfaces).
struct BatteryCellsFreshnessChip: View {
    let freshness: BatteryCellsFreshness

    private var labelKey: LocalizedStringKey {
        switch freshness {
        case .live: "widget.freshness.live"
        case .stale: "widget.freshness.stale"
        case .offline: "widget.freshness.offline"
        }
    }

    private var tone: TSTone {
        switch freshness {
        case .live: .success
        case .stale: .warning
        case .offline: .neutral
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(labelKey).font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("widget.freshness.accessibility"))
        .accessibilityValue(Text(labelKey))
    }
}

// MARK: - Loaded content

/// The loaded body: voltage heatmap grid + min/max/avg/spread stats + optional
/// per-module temperature summary (web content branch).
struct BatteryCellsContentView: View {
    let projection: BatteryCellsProjection

    private var statusColumns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm),
            count: max(1, projection.gridColumns)
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            heatmap
            voltageStats
            if projection.showTemperatures {
                temperatureStats
            }
        }
    }

    @ViewBuilder private var heatmap: some View {
        if projection.statusItems.isEmpty {
            TSEmptyState(title: "translation.widget.batteryCells.noCells", systemImage: "cpu")
                .frame(maxWidth: .infinity, minHeight: 64)
        } else {
            LazyVGrid(columns: statusColumns, spacing: TSSpacing.sm) {
                ForEach(projection.statusItems) { item in
                    BatteryCellTile(item: item, compact: projection.isCompact)
                }
            }
        }
    }

    private var voltageStats: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2),
            spacing: TSSpacing.sm
        ) {
            BatteryCellsStatTile(labelKey: "translation.widget.batteryCells.minV", value: projection.minVoltageText)
            BatteryCellsStatTile(labelKey: "translation.widget.batteryCells.maxV", value: projection.maxVoltageText)
            BatteryCellsStatTile(labelKey: "translation.widget.batteryCells.avgV", value: projection.avgVoltageText)
            BatteryCellsStatTile(labelKey: "translation.widget.batteryCells.spread", value: projection.spreadText)
        }
    }

    private var temperatureStats: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 3),
            spacing: TSSpacing.sm
        ) {
            BatteryCellsStatTile(
                labelKey: "translation.widget.batteryCells.minTemp",
                value: projection.minTemperatureText
            )
            BatteryCellsStatTile(
                labelKey: "translation.widget.batteryCells.avgTemp",
                value: projection.avgTemperatureText
            )
            BatteryCellsStatTile(
                labelKey: "translation.widget.batteryCells.maxTemp",
                value: projection.maxTemperatureText
            )
        }
    }
}

/// One cell tile in the voltage heatmap (web `WidgetStatusGrid` cell).
struct BatteryCellTile: View {
    let item: BatteryCellStatusItem
    let compact: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if !compact {
                    Text(verbatim: item.value)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            Spacer(minLength: 0)
            Circle()
                .fill(item.status.tone.color)
                .frame(width: 8, height: 8)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, compact ? TSSpacing.xs : TSSpacing.sm)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(
            item.status.tone.color.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(item.status.tone.color.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: BatteryCellsAccessibility.tileLabel(for: item)))
    }
}

/// A compact metric tile for the summary rows (web `StatCard` with `!p-2`).
struct BatteryCellsStatTile: View {
    let labelKey: LocalizedStringKey
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(labelKey)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// Skeleton chrome shown during the initial fetch (web `Skeleton`).
struct BatteryCellsLoadingView: View {
    let columns: Int

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: max(2, columns))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            LazyVGrid(columns: gridColumns, spacing: TSSpacing.sm) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    TSSkeleton(height: 44, cornerRadius: TSRadius.sm)
                }
            }
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2),
                spacing: TSSpacing.sm
            ) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 40, cornerRadius: TSRadius.sm)
                }
            }
        }
        .accessibilityLabel(Text("translation.common.loading"))
    }
}
