import SwiftUI

// The metric-card grids and summary panels for the Battery Cells surface (web
// `MetricCard` cards, the Temperature-Summary `GlassPanel`, and the summary-stat
// tiles). Voltages/millivolts format directly via `BatteryCellsFormat`; absolute
// temperatures convert through the shared SI `Units` facade at this boundary; each
// panel renders its own empty state (never a blank region). The heatmap + table +
// insight panels live in `BatteryCellsPage.Heatmap.swift`; the charts live in
// `BatteryCellsPage.Charts.swift`.

// MARK: - Tone mapping

/// Maps the page's semantic severities + threshold bands to the shared status tones
/// (web `MetricCard color` + the threshold tints), kept in one place.
public enum BatteryCellsTone {
    /// Web `MetricCard color` for the imbalance card / V-spread tile.
    public static func imbalance(_ millivolts: Double) -> TSTone {
        if millivolts > 15 { return .danger }
        if millivolts > 5 { return .warning }
        return .success
    }

    /// Web `MetricCard color` for the temperature-spread card / tile.
    public static func tempSpread(_ celsius: Double) -> TSTone {
        if celsius > 5 { return .danger }
        if celsius > 3 { return .warning }
        return .success
    }
}

// MARK: - Metric card (web `MetricCard` — label + value + tinted icon)

/// One labeled metric with a tinted SF Symbol (web `MetricCard` with its `color`
/// prop). Composes the shared `TSCard` + `TSIconBox` + typography.
struct BatteryCellsMetricCard: View {
    let title: LocalizedStringKey
    let value: String
    let systemImage: String
    let tone: TSTone

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                TSMetricValue(value)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Summary metrics (web 6 MetricCards)

/// The six summary cards (web Total-Cells, Avg-Voltage, Min-Cell, Max-Cell,
/// Imbalance, Pack-Voltage). Labels use the web key names verbatim.
struct BatteryCellsSummarySection: View {
    let data: BatteryCellData

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    private var minCellValue: String {
        guard let cell = data.minCell else { return BatteryCellsFormat.emptyValue }
        return "#\(cell.cellID) \(BatteryCellsFormat.voltage(cell.voltage, decimals: 4))"
    }

    private var maxCellValue: String {
        guard let cell = data.maxCell else { return BatteryCellsFormat.emptyValue }
        return "#\(cell.cellID) \(BatteryCellsFormat.voltage(cell.voltage, decimals: 4))"
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            BatteryCellsMetricCard(
                title: "Total Cells",
                value: BatteryCellsFormat.integer(Double(data.totalCells)),
                systemImage: "square.grid.3x3.fill",
                tone: .accent
            )
            BatteryCellsMetricCard(
                title: "Avg Voltage",
                value: BatteryCellsFormat.voltage(data.avgVoltage, decimals: 4),
                systemImage: "minus.plus.batteryblock",
                tone: .success
            )
            BatteryCellsMetricCard(
                title: "Min Cell",
                value: minCellValue,
                systemImage: "arrow.down.right",
                tone: .warning
            )
            BatteryCellsMetricCard(
                title: "Max Cell",
                value: maxCellValue,
                systemImage: "arrow.up.right",
                tone: .info
            )
            BatteryCellsMetricCard(
                title: "Imbalance",
                value: BatteryCellsFormat.millivolts(data.imbalanceMv),
                systemImage: "waveform.path.ecg",
                tone: BatteryCellsTone.imbalance(data.imbalanceMv)
            )
            BatteryCellsMetricCard(
                title: "Pack Voltage",
                value: BatteryCellsFormat.voltage(data.packVoltage, decimals: 1),
                systemImage: "cpu",
                tone: .accent
            )
        }
    }
}

// MARK: - Temperature summary (web GlassPanel15 — 4 MetricCards, or empty)

/// The temperature-summary panel (web GlassPanel15): average, minimum, maximum, and
/// spread — or a no-temperature empty state. Absolute temps convert via the shared
/// `Units` facade; the spread (a delta) scales without the absolute offset.
struct BatteryCellsTemperatureSection: View {
    let data: BatteryCellData
    let units: UnitPreferences

    private let columns = [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]

    private var spreadValue: String {
        BatteryCellsFormat.temperatureSpread(
            data.tempSpreadC,
            fahrenheit: units.temperature == "°F",
            unitLabel: units.temperature
        )
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("battery.cells.temp.title")
                if data.hasTemperatureReadings {
                    grid
                } else {
                    TSEmptyState(title: "battery.cells.temp.empty", systemImage: "thermometer.medium")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var grid: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            BatteryCellsMetricCard(
                title: "battery.cells.temp.avg",
                value: Units.formatTemperature(data.avgTemperatureC, units),
                systemImage: "thermometer.medium",
                tone: .success
            )
            BatteryCellsMetricCard(
                title: "battery.cells.temp.min",
                value: Units.formatTemperature(data.minTemperatureC, units),
                systemImage: "arrow.down.right",
                tone: .accent
            )
            BatteryCellsMetricCard(
                title: "battery.cells.temp.max",
                value: Units.formatTemperature(data.maxTemperatureC, units),
                systemImage: "arrow.up.right",
                tone: .warning
            )
            BatteryCellsMetricCard(
                title: "battery.cells.temp.spread",
                value: spreadValue,
                systemImage: "waveform.path.ecg",
                tone: BatteryCellsTone.tempSpread(data.tempSpreadC)
            )
        }
    }
}

// MARK: - Loading skeleton (web Skeleton loading state)

/// Mirrors the page layout while the source loads (web `loading` → `Skeleton`): the
/// summary grid, the heatmap/bar blocks, the chart pair, and the table, all under
/// SwiftUI redaction (the manifest's `loading → redacted(reason:)`).
struct BatteryCellsSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            skeletonGrid(count: 6, minimum: 150)
            skeletonBlock(height: 220)
            skeletonBlock(height: 280)
            HStack(spacing: TSSpacing.lg) {
                skeletonBlock(height: 240)
                skeletonBlock(height: 240)
            }
            skeletonBlock(height: 300)
        }
        .batteryCellsRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("Battery Cells"))
    }

    private func skeletonGrid(count: Int, minimum: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 84)
            }
        }
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies skeleton redaction while `loading`, matching the web Skeleton loading
    /// state (the manifest's `loading → redacted(reason:)` requirement).
    func batteryCellsRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
