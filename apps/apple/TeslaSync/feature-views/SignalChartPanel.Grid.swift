//
//  SignalChartPanel.Grid.swift
//  TeslaSync — P4 feature view · 0266 · SignalChartPanel (Apple)
//
//  The small-multiples grid — the native counterpart of the web
//  `SmallMultiplesChart` the panel swaps in when many signals are pinned
//  (`effectiveMode === 'grid'`). One cell per series, each with its own auto y-scale
//  (the whole point of small multiples: a tiny-range series doesn't get flattened by
//  a large one), each projected to its finite points and stride-downsampled to the
//  web `maxPointsPerCell` cap. A color-coded monospace label heads each cell; a
//  series with no finite points in range shows the web "No data" empty cell. Cell
//  height honors the panel's `gridCellHeight`. Token-driven (P1/S9), localized
//  (P1/S10).
//

import Charts
import SwiftUI

// MARK: - Grid (web `SmallMultiplesChart`)

struct SignalChartGrid: View {
    let samples: [SignalChartSample]
    let selectedSignals: [String]
    let cellHeight: CGFloat

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md, alignment: .top)],
            alignment: .leading,
            spacing: TSSpacing.md
        ) {
            ForEach(Array(selectedSignals.enumerated()), id: \.element) { offset, name in
                SignalChartGridCell(
                    name: name,
                    colorIndex: offset,
                    values: SignalChartBuilder.cellValues(of: name, in: samples),
                    cellHeight: cellHeight
                )
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Grid cell (one series, own y-scale)

/// A single small-multiples cell: a color-coded label over a mini line chart with
/// its own auto y-scale, or the web "No data" empty cell when the series has no
/// finite points in range.
struct SignalChartGridCell: View {
    let name: String
    let colorIndex: Int
    let values: [Double]
    let cellHeight: CGFloat

    private var color: Color {
        TSChartPalette.color(at: colorIndex)
    }

    private var points: [SignalChartCellPoint] {
        values.enumerated().map { SignalChartCellPoint(index: $0.offset, value: $0.element) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            if values.isEmpty {
                emptyCell
            } else {
                chart
            }
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityValue(Text(verbatim: accessibilityValue))
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(verbatim: name)
                .font(.system(.caption, design: .monospaced))
                .fontWeight(.semibold)
                .foregroundStyle(color)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                LineMark(x: .value("i", point.index), y: .value("v", point.value))
                    .interpolationMethod(.monotone)
                    .lineStyle(StrokeStyle(lineWidth: 1.5))
                    .foregroundStyle(color)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis { yAxis }
        .chartLegend(.hidden)
        .frame(height: cellHeight)
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: TSChartFormat.axisLabel(number))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private var emptyCell: some View {
        Text(verbatim: SignalChartStrings.gridNoData)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity)
            .frame(height: cellHeight)
    }

    private var accessibilityValue: String {
        guard let last = values.last else { return SignalChartStrings.gridNoData }
        return SignalChartAccessibility.seriesLabel(name: name, value: SignalChartNumber.tooltip(last))
    }
}

// MARK: - Cell point

/// One mini-chart point (cell-local x index + value).
private struct SignalChartCellPoint: Identifiable {
    let index: Int
    let value: Double

    var id: Int {
        index
    }
}
