import SwiftUI

/// A single (x, y) sample in a `TSChartSeries`.
public struct TSChartPoint: Identifiable {
    public let id: String
    public let xValue: Double
    public let yValue: Double

    public init(x: Double, y: Double, id: String? = nil) {
        xValue = x
        yValue = y
        self.id = id ?? "\(x)-\(y)"
    }
}

/// A named series of points, colored from the brand chart palette.
public struct TSChartSeries: Identifiable {
    public let id: String
    public let name: LocalizedStringKey
    /// Plain-text name for the legend / VoiceOver (the localized `name` can't be
    /// stringified directly).
    public let nameText: String
    public let points: [TSChartPoint]
    public let colorIndex: Int

    public init(
        id: String,
        name: LocalizedStringKey,
        nameText: String,
        points: [TSChartPoint],
        colorIndex: Int = 0
    ) {
        self.id = id
        self.name = name
        self.nameText = nameText
        self.points = points
        self.colorIndex = colorIndex
    }

    public var color: Color {
        TSChartPalette.color(at: colorIndex)
    }
}

/// A category slice for `TSPieChart`.
public struct TSChartSlice: Identifiable {
    public let id: String
    public let name: LocalizedStringKey
    public let nameText: String
    public let value: Double
    public let colorIndex: Int

    public init(id: String, name: LocalizedStringKey, nameText: String, value: Double, colorIndex: Int = 0) {
        self.id = id
        self.name = name
        self.nameText = nameText
        self.value = value
        self.colorIndex = colorIndex
    }

    public var color: Color {
        TSChartPalette.color(at: colorIndex)
    }
}

/// Safe numeric helpers for axes/labels + responsible downsampling. Pure + tested.
public enum TSChartFormat {
    /// Abbreviated axis label; non-finite input renders an em dash (never "nan").
    public static func axisLabel(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        let magnitude = abs(value)
        switch magnitude {
        case 1_000_000...:
            return String(format: "%.1fM", value / 1_000_000)
        case 1000...:
            return String(format: "%.1fk", value / 1000)
        default:
            return String(format: "%.0f", value)
        }
    }

    /// Evenly strides a series down to at most `maxCount` points (keeps endpoints).
    public static func downsample(_ points: [TSChartPoint], maxCount: Int) -> [TSChartPoint] {
        guard maxCount > 1, points.count > maxCount else { return points }
        let step = Double(points.count - 1) / Double(maxCount - 1)
        return (0 ..< maxCount).map { points[Int((Double($0) * step).rounded())] }
    }

    /// Toggles a series id in the hidden set (legend visibility). Pure.
    public static func toggleHidden(_ hidden: Set<String>, _ seriesID: String) -> Set<String> {
        var next = hidden
        if next.contains(seriesID) { next.remove(seriesID) } else { next.insert(seriesID) }
        return next
    }

    /// Builds a concise accessible summary for a series (min / max / last).
    public static func summary(for series: TSChartSeries) -> String {
        let values = series.points.map(\.yValue).filter(\.isFinite)
        guard let first = values.first else { return "\(series.nameText): no data" }
        let minValue = values.min() ?? first
        let maxValue = values.max() ?? first
        let last = values.last ?? first
        return "\(series.nameText): min \(axisLabel(minValue)), max \(axisLabel(maxValue)), latest \(axisLabel(last))"
    }
}

/// Reusable area-fill gradient derived from a palette color (web `ChartGradient`).
public enum TSChartGradient {
    public static func fill(colorIndex: Int) -> LinearGradient {
        let color = TSChartPalette.color(at: colorIndex)
        return LinearGradient(
            colors: [color.opacity(0.35), color.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}
