//
//  CostHeatmap.Grid.swift
//  TeslaSync — P4 feature view · 0100 · CostHeatmap (Apple)
//
//  The leaf view the CostHeatmap panel composes: the `Canvas`-drawn 7×24 day×hour
//  heatmap (port of the web flex-grid of `aspect-square` cells). Geometry mirrors
//  the web layout (a day-label gutter + an hour-label strip above the cells) and
//  scales to fit the panel width while preserving aspect ratio. Populated cells take
//  the cheap→expensive ramp from the adapter; empty cells take a theme track so the
//  surface stays legible in light mode. Decorative for VoiceOver — the panel speaks
//  a combined summary (`CostHeatmapAccessibility.summary`).
//

import SwiftUI

// MARK: - Colour bridge (adapter `CostHeatmapColor` → SwiftUI `Color`)

extension CostHeatmapColor {
    /// Maps the web-faithful 0…255 channels + 0…1 alpha to a SwiftUI sRGB colour at
    /// the render boundary (the adapter stays SwiftUI-free for testability).
    var swiftUIColor: Color {
        Color(
            .sRGB,
            red: Double(red) / 255,
            green: Double(green) / 255,
            blue: Double(blue) / 255,
            opacity: alpha
        )
    }
}

// MARK: - Heatmap canvas (port of the web `aspect-square` cell grid)

/// The 7×24 day×hour cost grid, drawn with `Canvas` for crisp, cheap cells. The
/// design geometry (a `leftMargin` day gutter + a `topMargin` hour strip, then a
/// `strideX`/`strideY` lattice of rounded cells) is laid out in a fixed view-box and
/// scaled to fit while centred, so it reads at any panel width.
struct CostHeatmapCanvas: View {
    let cells: [CostHeatmapCell]
    let dayLabels: [String]
    let hourLabels: [Int]

    private let leftMargin: CGFloat = 26
    private let topMargin: CGFloat = 12
    private let strideX: CGFloat = 13
    private let strideY: CGFloat = 15
    private let cellWidth: CGFloat = 12
    private let cellHeight: CGFloat = 13
    private let cellRadius: CGFloat = 2
    private let labelSize: CGFloat = 7

    private var viewBoxWidth: CGFloat {
        leftMargin + CGFloat(CostHeatmapProjection.hourCount) * strideX + 2
    }

    private var viewBoxHeight: CGFloat {
        topMargin + CGFloat(CostHeatmapProjection.dayCount) * strideY + 2
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
        .aspectRatio(viewBoxWidth / viewBoxHeight, contentMode: .fit)
        .accessibilityHidden(true)
    }

    private func drawCells(in context: inout GraphicsContext, scale: CGFloat, originX: CGFloat, originY: CGFloat) {
        for cell in cells {
            let xPos = originX + (leftMargin + CGFloat(cell.hour) * strideX) * scale
            let yPos = originY + (topMargin + CGFloat(cell.day) * strideY) * scale
            let rect = CGRect(x: xPos, y: yPos, width: cellWidth * scale, height: cellHeight * scale)
            let path = Path(roundedRect: rect, cornerRadius: cellRadius * scale, style: .continuous)
            context.fill(path, with: .color(color(for: cell)))
        }
    }

    private func color(for cell: CostHeatmapCell) -> Color {
        guard let fill = cell.fill else { return Color.TS.border.opacity(0.18) }
        return fill.swiftUIColor
    }

    private func drawHourLabels(in context: inout GraphicsContext, scale: CGFloat, originX: CGFloat, originY: CGFloat) {
        for hour in hourLabels {
            let xPos = originX + (leftMargin + CGFloat(hour) * strideX + cellWidth / 2) * scale
            let yPos = originY + (topMargin - 4) * scale
            var resolved = context.resolve(Text(verbatim: String(hour)).font(.system(size: labelSize * scale)))
            resolved.shading = .color(Color.TS.textMuted)
            context.draw(resolved, at: CGPoint(x: xPos, y: yPos), anchor: .center)
        }
    }

    private func drawDayLabels(in context: inout GraphicsContext, scale: CGFloat, originX: CGFloat, originY: CGFloat) {
        for (index, label) in dayLabels.enumerated() where index < CostHeatmapProjection.dayCount {
            let xPos = originX + (leftMargin - 4) * scale
            let yPos = originY + (topMargin + CGFloat(index) * strideY + cellHeight / 2) * scale
            var resolved = context.resolve(Text(verbatim: label).font(.system(size: labelSize * scale)))
            resolved.shading = .color(Color.TS.textSecondary)
            context.draw(resolved, at: CGPoint(x: xPos, y: yPos), anchor: .trailing)
        }
    }
}
