import SwiftUI

// The voltage heatmap (web `CellHeatmap` — GlassPanel1 / GlassPanel8) and the
// sortable cell-details table (web GlassPanel13). The heatmap colors each cell by
// its deviation from the pack average; the table mirrors the web `DataTable`
// columns (Cell # / Voltage / Delta / Status) and its per-section empty states.

// MARK: - Severity → tone + deviation → color

extension BatterySeverity {
    /// The shared status tone for a cell-status badge (web `statusVariant`).
    var tone: TSTone {
        switch self {
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .neutral: .neutral
        }
    }
}

/// The heatmap tint for a deviation band (web `cellColor`: green / amber / red).
func batteryDeviationColor(_ level: CellDeviationLevel) -> Color {
    switch level {
    case .nominal: Color.TS.statusSuccess
    case .slight: Color.TS.statusWarning
    case .significant: Color.TS.statusDanger
    }
}

// MARK: - Heatmap section (web Cell-Voltage-Heatmap header + CellHeatmap / empty)

/// The heatmap section: a header with the bar/grid toggle (web `showHeatmap`), then
/// either the deviation-colored cell grid (GlassPanel1) or the no-readings empty
/// (GlassPanel8). Toggling to "Bar View" collapses the grid (web renders `null`),
/// leaving the dedicated bar chart below as the bar representation.
struct BatteryCellsHeatmapSection: View {
    let data: BatteryCellData
    @Binding var showHeatmap: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            if data.cells.isEmpty {
                emptyPanel
            } else if showHeatmap {
                BatteryHeatmapGrid(cells: data.cells)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var header: some View {
        HStack {
            TSSubhead("Cell Voltage Heatmap")
            Spacer()
            TSButton(
                variant: .ghost,
                size: .small,
                action: { showHeatmap.toggle() },
                label: {
                    Label(
                        showHeatmap ? "Bar View" : "Grid View",
                        systemImage: showHeatmap ? "chart.bar.fill" : "square.grid.3x3.fill"
                    )
                }
            )
        }
    }

    /// Web GlassPanel8 — the no-readings empty state.
    private var emptyPanel: some View {
        TSGlassPanel {
            TSEmptyState(title: "No cell readings available.", systemImage: "square.grid.3x3")
                .frame(maxWidth: .infinity)
        }
    }
}

/// The deviation-colored cell grid (web `CellHeatmap` GlassPanel1): a square-ish
/// grid of per-cell chips, a legend, and the deviation caption.
struct BatteryHeatmapGrid: View {
    let cells: [BatteryCellReading]

    private var columns: [GridItem] {
        let count = max(1, Int(ceil(Double(cells.count).squareRoot())))
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.xs), count: count)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSubhead("Cells colored by deviation from average")
                LazyVGrid(columns: columns, spacing: TSSpacing.xs) {
                    ForEach(cells) { cell in
                        BatteryHeatmapCell(reading: cell)
                    }
                }
                BatteryHeatmapLegend()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One heatmap chip: the cell id over its voltage, tinted by deviation band, with a
/// VoiceOver label carrying the cell id, voltage, and signed delta (web `title`).
struct BatteryHeatmapCell: View {
    let reading: BatteryCellReading

    private var color: Color {
        batteryDeviationColor(reading.deviationLevel)
    }

    private var voiceOver: String {
        let voltage = BatteryCellsFormat.voltage(reading.voltage, decimals: 3)
        let delta = BatteryCellsFormat.signedMillivolts(reading.deltaMillivolts)
        return "\(String(localized: "Cell")) \(reading.cellID): \(voltage) (\(delta) mV)"
    }

    var body: some View {
        VStack(spacing: 1) {
            Text(verbatim: "\(reading.cellID)")
                .font(.system(size: 9, weight: .semibold).monospaced())
            Text(verbatim: BatteryCellsFormat.number(reading.voltage, decimals: 3))
                .font(.system(size: 9).monospaced())
        }
        .foregroundStyle(color)
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xs)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: voiceOver))
    }
}

/// The heatmap legend (web Nominal / Slight Deviation / Significant Deviation).
struct BatteryHeatmapLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            item(color: Color.TS.statusSuccess, label: "Nominal")
            item(color: Color.TS.statusWarning, label: "Slight Deviation")
            item(color: Color.TS.statusDanger, label: "Significant Deviation")
        }
        .frame(maxWidth: .infinity)
    }

    private func item(color: Color, label: LocalizedStringKey) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Cell details table (web GlassPanel13 — DataTable / empty)

/// The sortable cell-details table (web GlassPanel13): the Cell # / Voltage / Delta
/// / Status columns over `TSDataTable`, with the cell-count badge and the no-details
/// empty state.
struct BatteryCellsDetailsSection: View {
    let data: BatteryCellData

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if data.cells.isEmpty {
                    TSEmptyState(title: "No cell details available.", systemImage: "minus.plus.batteryblock")
                        .frame(maxWidth: .infinity)
                } else {
                    TSDataTable(rows: data.cells, columns: columns, density: .compact)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack {
            TSSubhead("Cell Details")
            Spacer()
            (Text(verbatim: "\(data.cells.count) ") + Text("cells"))
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, 2)
                .background(Color.TS.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
    }

    private var columns: [TSColumn<BatteryCellReading>] {
        [
            TSColumn(
                id: "cell_id",
                title: "Cell #",
                comparator: { compare($0.cellID, $1.cellID) },
                cell: { row in
                    Text(verbatim: "#\(row.cellID)").font(.system(.body, design: .monospaced).weight(.semibold))
                }
            ),
            TSColumn(
                id: "voltage",
                title: "Voltage (V)",
                comparator: { compare($0.voltage, $1.voltage) },
                cell: { row in
                    Text(verbatim: BatteryCellsFormat.number(row.voltage, decimals: 4))
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(batteryDeviationColor(row.deviationLevel))
                }
            ),
            TSColumn(
                id: "delta",
                title: "Delta (mV)",
                comparator: { compare($0.deltaMillivolts, $1.deltaMillivolts) },
                cell: { row in
                    Text(verbatim: BatteryCellsFormat.signedMillivolts(row.deltaMillivolts))
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(deltaColor(row.deltaMillivolts))
                }
            ),
            TSColumn(
                id: "status",
                title: "Status",
                comparator: { compare($0.status.rawValue, $1.status.rawValue) },
                cell: { row in
                    TSBadge(LocalizedStringKey(row.status.displayKey), tone: row.status.severity.tone)
                }
            )
        ]
    }

    private func deltaColor(_ millivolts: Double) -> Color {
        if millivolts > 0 { return Color.TS.statusSuccess }
        if millivolts < 0 { return Color.TS.statusDanger }
        return Color.TS.textPrimary
    }

    private func compare<Value: Comparable>(_ lhs: Value, _ rhs: Value) -> ComparisonResult {
        if lhs < rhs { return .orderedAscending }
        if lhs > rhs { return .orderedDescending }
        return .orderedSame
    }
}
