import Foundation
import SwiftUI

/// One spoke of a `TSRadarChart`.
public struct TSRadarAxis: Identifiable {
    public let id: String
    public let label: LocalizedStringKey
    public let labelText: String
    /// Normalized 0...1 magnitude.
    public let value: Double

    public init(id: String, label: LocalizedStringKey, labelText: String, value: Double) {
        self.id = id
        self.label = label
        self.labelText = labelText
        self.value = value
    }
}

/// Radar/spider chart (web `RadarChart`). Swift Charts has no radar mark, so this
/// is drawn with `Canvas`; the values are exposed as an accessible summary.
public struct TSRadarChart: View {
    private let axes: [TSRadarAxis]
    private let colorIndex: Int

    public init(axes: [TSRadarAxis], colorIndex: Int = 0) {
        self.axes = axes
        self.colorIndex = colorIndex
    }

    private var color: Color {
        TSChartPalette.color(at: colorIndex)
    }

    public var body: some View {
        Canvas { context, size in
            let count = axes.count
            guard count >= 3 else { return }
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let maxRadius = min(size.width, size.height) / 2 - 16

            for fraction in [0.25, 0.5, 0.75, 1.0] {
                context.stroke(
                    Self.polygon(count: count, fraction: fraction, center: center, maxRadius: maxRadius),
                    with: .color(Color.TS.border.opacity(0.3)),
                    lineWidth: 1
                )
            }
            for index in 0 ..< count {
                var spoke = Path()
                spoke.move(to: center)
                let tip = Self.vertex(index: index, count: count, fraction: 1, center: center, maxRadius: maxRadius)
                spoke.addLine(to: tip)
                context.stroke(spoke, with: .color(Color.TS.border.opacity(0.2)), lineWidth: 1)
            }

            let dataPath = Self.dataPolygon(axes: axes, center: center, maxRadius: maxRadius)
            context.fill(dataPath, with: .color(color.opacity(0.25)))
            context.stroke(dataPath, with: .color(color), lineWidth: 2)
        }
        .frame(minHeight: 200)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("chart.radar"))
        .accessibilityValue(Text(verbatim: summary))
    }

    private var summary: String {
        axes.map { "\($0.labelText) \(Int(($0.value * 100).rounded()))%" }.joined(separator: ", ")
    }

    private static func vertex(
        index: Int,
        count: Int,
        fraction: Double,
        center: CGPoint,
        maxRadius: CGFloat
    ) -> CGPoint {
        let angle = (Double(index) / Double(count)) * 2 * .pi - .pi / 2
        let radius = maxRadius * fraction
        return CGPoint(x: center.x + cos(angle) * radius, y: center.y + sin(angle) * radius)
    }

    private static func polygon(count: Int, fraction: Double, center: CGPoint, maxRadius: CGFloat) -> Path {
        var path = Path()
        for index in 0 ..< count {
            let point = vertex(
                index: index, count: count, fraction: fraction,
                center: center, maxRadius: maxRadius
            )
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }

    private static func dataPolygon(axes: [TSRadarAxis], center: CGPoint, maxRadius: CGFloat) -> Path {
        var path = Path()
        for (index, axis) in axes.enumerated() {
            let fraction = min(max(axis.value, 0), 1)
            let point = vertex(
                index: index, count: axes.count, fraction: fraction,
                center: center, maxRadius: maxRadius
            )
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }
}
