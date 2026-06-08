//
//  SpeedHeatmapWidget.Grid.swift
//  TeslaSync — P4 dashboard widget · 0094 · SpeedHeatmapWidget (Apple)
//
//  The leaf views the SpeedHeatmapWidget surface composes: the Canvas-drawn
//  7×24 heatmap (port of the web SVG grid), the Slow→Fast legend, the
//  drives/peak summary row, and the compact peak number. Kept in their own file
//  so the surface file stays within the house file-length limit.
//

import SwiftUI

// MARK: - Colour bridge

extension Color {
    /// Maps a normalized adapter colour (`RGBAColor`, 0…1 channels) to a SwiftUI
    /// sRGB colour at the render boundary.
    init(rgba: RGBAColor) {
        self.init(.sRGB, red: rgba.red, green: rgba.green, blue: rgba.blue, opacity: rgba.alpha)
    }
}

// MARK: - Heatmap canvas (port of the web SVG `HeatmapGrid`)

/// The 7×24 day×hour speed grid, drawn with `Canvas` for crisp, cheap cells.
/// Geometry mirrors the web SVG viewBox (`leftMargin + cols*10`, `topMargin +
/// rows*12`) and scales to fit while preserving aspect ratio (`xMidYMid meet`).
/// Populated cells take the speed→colour gradient; empty cells take a theme
/// track so the surface stays legible in light mode. Decorative for VoiceOver —
/// the surface speaks a combined summary.
struct HeatmapCanvas: View {
    let grid: [[HeatCell]]
    let maxSpeed: Double
    let dayLabels: [String]
    let hourLabels: [Int]
    let isWide: Bool

    private var leftMargin: CGFloat {
        isWide ? 30 : 14
    }

    private let topMargin: CGFloat = 14
    private let strideX: CGFloat = 10
    private let strideY: CGFloat = 12
    private let cellWidth: CGFloat = 9
    private let cellHeight: CGFloat = 11
    private let cellRadius: CGFloat = 1.5
    private let labelSize: CGFloat = 6

    private var viewBoxWidth: CGFloat {
        leftMargin + CGFloat(SpeedHeatmapBuilder.cols) * strideX + 2
    }

    private var viewBoxHeight: CGFloat {
        topMargin + CGFloat(SpeedHeatmapBuilder.rows) * strideY + 2
    }

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width / viewBoxWidth, size.height / viewBoxHeight)
            guard scale > 0, scale.isFinite else { return }
            let originX = (size.width - viewBoxWidth * scale) / 2
            let originY = (size.height - viewBoxHeight * scale) / 2
            drawCells(in: &context, scale: scale, originX: originX, originY: originY)
            drawHourLabels(in: &context, scale: scale, originX: originX, originY: originY)
            drawDayLabels(in: &context, scale: scale, originX: originX, originY: originY)
        }
        .accessibilityHidden(true)
    }

    private func drawCells(in context: inout GraphicsContext, scale: CGFloat, originX: CGFloat, originY: CGFloat) {
        for row in grid {
            for cell in row {
                let xPos = originX + (leftMargin + CGFloat(cell.hour) * strideX) * scale
                let yPos = originY + (topMargin + CGFloat(cell.day) * strideY) * scale
                let rect = CGRect(x: xPos, y: yPos, width: cellWidth * scale, height: cellHeight * scale)
                let path = Path(roundedRect: rect, cornerRadius: cellRadius * scale, style: .continuous)
                context.fill(path, with: .color(cellColor(cell)))
            }
        }
    }

    private func cellColor(_ cell: HeatCell) -> Color {
        guard cell.driveCount > 0 else { return Color.TS.border.opacity(0.18) }
        return Color(rgba: SpeedHeatmapBuilder.speedColor(speed: cell.avgSpeed, maxSpeed: maxSpeed))
    }

    private func drawHourLabels(in context: inout GraphicsContext, scale: CGFloat, originX: CGFloat, originY: CGFloat) {
        for hour in hourLabels {
            let xPos = originX + (leftMargin + CGFloat(hour) * strideX + strideX / 2) * scale
            let yPos = originY + (topMargin - 5) * scale
            var resolved = context.resolve(Text(verbatim: String(hour)).font(.system(size: labelSize * scale)))
            resolved.shading = .color(Color.TS.textMuted)
            context.draw(resolved, at: CGPoint(x: xPos, y: yPos), anchor: .center)
        }
    }

    private func drawDayLabels(in context: inout GraphicsContext, scale: CGFloat, originX: CGFloat, originY: CGFloat) {
        for (index, label) in dayLabels.enumerated() {
            let xPos = originX + (leftMargin - 3) * scale
            let yPos = originY + (topMargin + CGFloat(index) * strideY + cellHeight / 2) * scale
            var resolved = context.resolve(Text(verbatim: label).font(.system(size: labelSize * scale)))
            resolved.shading = .color(Color.TS.textSecondary)
            context.draw(resolved, at: CGPoint(x: xPos, y: yPos), anchor: .trailing)
        }
    }
}

// MARK: - Legend (port of the web Slow→gradient→Fast strip)

/// The colour legend: a "Slow" label, five gradient swatches sampled the same
/// way the cells are coloured, and a "Fast" label.
struct SpeedHeatmapLegend: View {
    let maxSpeed: Double

    private let stops: [Double] = [0, 0.25, 0.5, 0.75, 1]

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            SpeedHeatmapStrings.text("widget.speedHeatmap.slow", "Slow")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.xs)
            HStack(spacing: 1) {
                ForEach(stops, id: \.self) { stop in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(color(for: stop))
                        .frame(width: 16, height: 8)
                }
            }
            Spacer(minLength: TSSpacing.xs)
            SpeedHeatmapStrings.text("widget.speedHeatmap.fast", "Fast")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityHidden(true)
    }

    private func color(for stop: Double) -> Color {
        let denominator = maxSpeed > 0 ? maxSpeed : 1
        guard stop > 0 else { return Color.TS.border.opacity(0.18) }
        return Color(rgba: SpeedHeatmapBuilder.speedColor(speed: stop * denominator, maxSpeed: denominator))
    }
}

// MARK: - Summary row (port of the web drives + peak-avg line)

/// The summary line above the grid: the contributing drive count and the peak
/// average speed, separated by a middot.
struct SpeedHeatmapSummaryRow: View {
    let totalDrives: Int
    let maxSpeed: Double
    let unit: SpeedUnit

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: SpeedHeatmapStrings.count("widget.speedHeatmap.drives", "%lld drives", totalDrives))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: "·")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: peakText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var peakText: String {
        SpeedHeatmapStrings.format(
            "widget.speedHeatmap.peakSpeed",
            "Peak avg %1$@ %2$@",
            SpeedNumberFormat.integer(maxSpeed),
            unit.symbol
        )
    }
}

// MARK: - Compact peak number (web compact big number)

/// The compact layout's hero: the peak average speed (or an em dash when there
/// is no data) with a "Peak {unit}" caption. Honors Reduce Motion.
struct SpeedHeatmapPeakNumber: View {
    let maxSpeed: Double
    let unit: SpeedUnit
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var formatted: String {
        maxSpeed > 0 ? SpeedNumberFormat.integer(maxSpeed) : "—"
    }

    private var caption: String {
        "\(SpeedHeatmapStrings.string("widget.speedHeatmap.peak", "Peak")) \(unit.symbol)"
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: formatted)
                .font(Font.TS.display)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: formatted)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(verbatim: caption)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(caption) \(formatted)"))
    }
}
