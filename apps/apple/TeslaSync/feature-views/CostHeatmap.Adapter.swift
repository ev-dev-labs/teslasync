//
//  CostHeatmap.Adapter.swift
//  TeslaSync — P4 feature view · 0100 · CostHeatmap (Apple)
//
//  The testable projection core for the charging cost-heatmap surface: the decoded
//  domain models (parity with the web `ChargingOptimizerData['weekly_heatmap']`
//  slice — `OptimizerHeatmapEntry { day, hour, sessions, avg_cost_per_kwh }`), the
//  `safe()` numeric guard (port of the web `?? 0` defaults), the `maxCost`
//  resolution (web `peakCostPerKwh || 0.30`), the dense 7×24 grid build (web
//  `heatmap.find((e) => e.day === d && e.hour === h)`), the cheap→expensive cell /
//  legend colour ramp (web `rgba(round(t*239), round((1-t)*187), round((1-t)*100),
//  …)`), and the VoiceOver summary builder. Everything here is pure + Foundation
//  only so it unit-tests without a store or a rendered view.
//

import Foundation

// MARK: - Numeric guard (port of the web `?? 0` / `safe`)

/// Numeric helpers shared by the projection. `safe` is the native port of the web
/// `entry?.sessions ?? 0` / `avg_cost_per_kwh ?? 0` defaults so a `NaN` /
/// `Infinity` / missing value never reaches a colour channel, an alpha, or a label.
public enum CostHeatmapNumeric {
    /// Returns the value when it is finite, else `0`.
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }
}

// MARK: - Domain models (port of `weekly_heatmap` / `OptimizerHeatmapEntry`)

/// One recorded heatmap slot (web `OptimizerHeatmapEntry` — `{ day, hour,
/// sessions, avg_cost_per_kwh }`). `day` is `0=Sun … 6=Sat`, `hour` is `0…23`.
public struct CostHeatmapEntry: Identifiable, Equatable, Sendable {
    public var day: Int
    public var hour: Int
    public var sessions: Double
    public var avgCostPerKwh: Double

    /// Stable identity from the slot coordinate (one entry per day×hour).
    public var id: Int {
        day * CostHeatmapProjection.hourCount + hour
    }

    public init(day: Int, hour: Int, sessions: Double, avgCostPerKwh: Double) {
        self.day = day
        self.hour = hour
        self.sessions = sessions
        self.avgCostPerKwh = avgCostPerKwh
    }
}

/// The full input the surface renders (web `CostHeatmap` props): the sparse
/// `weekly_heatmap` entries plus the `peak_cost_per_kwh` used to scale intensity.
public struct CostHeatmapData: Equatable, Sendable {
    public var entries: [CostHeatmapEntry]
    public var peakCostPerKwh: Double

    public init(entries: [CostHeatmapEntry] = [], peakCostPerKwh: Double = 0) {
        self.entries = entries
        self.peakCostPerKwh = peakCostPerKwh
    }

    /// Whether no slot has any recorded session — drives the friendly empty state
    /// (the web renders the heatmap only when `weekly_heatmap.length > 0`).
    public var isEmpty: Bool {
        !entries.contains { CostHeatmapNumeric.safe($0.sessions) > 0 }
    }

    /// Total recorded sessions across every slot (for the accessible summary).
    public var totalSessions: Double {
        entries.reduce(0) { $0 + CostHeatmapNumeric.safe($1.sessions) }
    }
}

// MARK: - Cell colour ramp (port of the web `rgba(...)` cheap→expensive gradient)

/// A resolved cell / legend colour with web-faithful 0…255 integer channels and a
/// 0…1 alpha. Kept SwiftUI-free so the ramp math is unit-testable; the view maps it
/// to a SwiftUI `Color` at the render boundary.
public struct CostHeatmapColor: Equatable, Sendable {
    public var red: Int
    public var green: Int
    public var blue: Int
    public var alpha: Double

    public init(red: Int, green: Int, blue: Int, alpha: Double) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    /// The cheap→expensive ramp for a cost `intensity` (clamped to `0…1`) at a given
    /// alpha. Port of the web `rgb(round(t*239), round((1-t)*187), round((1-t)*100))`.
    private static func ramp(intensity: Double, alpha: Double) -> CostHeatmapColor {
        let clamped = Swift.max(0, Swift.min(1, intensity))
        return CostHeatmapColor(
            red: Int((clamped * 239).rounded()),
            green: Int(((1 - clamped) * 187).rounded()),
            blue: Int(((1 - clamped) * 100).rounded()),
            alpha: alpha
        )
    }

    /// A populated cell's fill (web `sessions > 0` branch): the cheap→expensive ramp
    /// at an alpha that grows with the session count (`min(0.9, 0.15 + sessions * 0.12)`).
    public static func cell(intensity: Double, sessions: Double) -> CostHeatmapColor {
        let safeSessions = Swift.max(0, CostHeatmapNumeric.safe(sessions))
        let alpha = Swift.min(0.9, 0.15 + safeSessions * 0.12)
        return ramp(intensity: intensity, alpha: alpha)
    }

    /// A legend swatch for a fixed intensity (web legend alpha is a constant `0.6`).
    public static func legend(intensity: Double) -> CostHeatmapColor {
        ramp(intensity: intensity, alpha: 0.6)
    }
}

// MARK: - Resolved grid cell (one dense day×hour slot the canvas draws)

/// One slot of the dense 7×24 grid: its coordinate, the resolved session count and
/// average cost, the `0…1` cost intensity, and the fill colour (`nil` when the slot
/// has no sessions, so the view draws the empty track — web `rgba(255,255,255,.02)`).
public struct CostHeatmapCell: Identifiable, Equatable, Sendable {
    public var day: Int
    public var hour: Int
    public var sessions: Double
    public var cost: Double
    public var intensity: Double
    public var fill: CostHeatmapColor?

    public var id: Int {
        day * CostHeatmapProjection.hourCount + hour
    }

    public init(
        day: Int,
        hour: Int,
        sessions: Double,
        cost: Double,
        intensity: Double,
        fill: CostHeatmapColor?
    ) {
        self.day = day
        self.hour = hour
        self.sessions = sessions
        self.cost = cost
        self.intensity = intensity
        self.fill = fill
    }
}

// MARK: - Projection (port of the web render computations)

/// The pure projection from the decoded `CostHeatmapData` to the grid, legend, and
/// labels the view renders. Each function mirrors a web computation exactly.
public enum CostHeatmapProjection {
    /// Grid rows (web `['Sun' … 'Sat']`, day index `0…6`).
    public static let dayCount = 7
    /// Grid columns (web `Array.from({ length: 24 })`, hour `0…23`).
    public static let hourCount = 24
    /// Hours that carry a visible tick label (web `i % 3 === 0`).
    public static let labelledHours: [Int] = Array(stride(from: 0, to: hourCount, by: 3))
    /// The five legend intensities (web `[0.15, 0.3, 0.5, 0.7, 0.9]`).
    public static let legendIntensities: [Double] = [0.15, 0.3, 0.5, 0.7, 0.9]

    /// Resolves the web `maxCost = peakCostPerKwh || 0.30`: a positive (or negative,
    /// JS-truthy) peak is kept; `0` / `NaN` falls back to `0.30`.
    public static func maxCost(peakCostPerKwh: Double) -> Double {
        let safe = CostHeatmapNumeric.safe(peakCostPerKwh)
        return safe != 0 ? safe : 0.30
    }

    /// Builds the dense 7×24 grid from the sparse `weekly_heatmap` entries. Mirrors
    /// the web `heatmap.find((e) => e.day === d && e.hour === h)` (first match wins),
    /// the `sessions ?? 0` / `cost ?? 0` defaults, and `intensity = maxCost > 0 ?
    /// min(1, cost / maxCost) : 0`. Empty slots carry a `nil` fill.
    public static func grid(_ data: CostHeatmapData) -> [CostHeatmapCell] {
        let maxCost = maxCost(peakCostPerKwh: data.peakCostPerKwh)
        var lookup: [Int: CostHeatmapEntry] = [:]
        for entry in data.entries {
            let key = entry.day * hourCount + entry.hour
            if lookup[key] == nil {
                lookup[key] = entry
            }
        }
        var cells: [CostHeatmapCell] = []
        cells.reserveCapacity(dayCount * hourCount)
        for day in 0 ..< dayCount {
            for hour in 0 ..< hourCount {
                let entry = lookup[day * hourCount + hour]
                let sessions = CostHeatmapNumeric.safe(entry?.sessions)
                let cost = CostHeatmapNumeric.safe(entry?.avgCostPerKwh)
                let intensity = maxCost > 0 ? Swift.min(1, cost / maxCost) : 0
                let fill = sessions > 0
                    ? CostHeatmapColor.cell(intensity: intensity, sessions: sessions)
                    : nil
                cells.append(
                    CostHeatmapCell(
                        day: day,
                        hour: hour,
                        sessions: sessions,
                        cost: cost,
                        intensity: intensity,
                        fill: fill
                    )
                )
            }
        }
        return cells
    }

    /// The five cheap→expensive legend swatches (web `[0.15…0.9].map(...)`).
    public static func legendSwatches() -> [CostHeatmapColor] {
        legendIntensities.map { CostHeatmapColor.legend(intensity: $0) }
    }

    /// Short weekday symbols, Sunday-first to match the web day index (`0=Sun`),
    /// localized by the supplied locale so no English day literal is hardcoded.
    public static func dayLabels(locale: Locale = .current) -> [String] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = locale
        return calendar.shortWeekdaySymbols
    }
}

// MARK: - Accessibility summary (testable seam)

/// The pre-localized words the spoken summary stitches together, bundled so the
/// builder stays a small function (and avoids a wide parameter list).
public struct CostHeatmapSummaryLabels: Equatable, Sendable {
    public var title: String
    public var sessions: String
    public var cheapest: String
    public var priciest: String
    public var busiest: String
    public var perKwh: String
    public var empty: String

    public init(
        title: String,
        sessions: String,
        cheapest: String,
        priciest: String,
        busiest: String,
        perKwh: String,
        empty: String
    ) {
        self.title = title
        self.sessions = sessions
        self.cheapest = cheapest
        self.priciest = priciest
        self.busiest = busiest
        self.perKwh = perKwh
        self.empty = empty
    }
}

/// Builds the VoiceOver string for the grid so the canvas is not an opaque image to
/// assistive tech and the spoken content is unit-testable without a rendered view.
public enum CostHeatmapAccessibility {
    /// The slot with the most sessions (ties resolved to the earliest), or `nil`.
    public static func busiestEntry(_ entries: [CostHeatmapEntry]) -> CostHeatmapEntry? {
        entries.max { CostHeatmapNumeric.safe($0.sessions) < CostHeatmapNumeric.safe($1.sessions) }
    }

    /// "Charging Cost Heatmap. 142 sessions. Cheapest $0.110/kWh, Most expensive
    /// $0.480/kWh. Busiest Tue 18:00." — built from pre-localized words + formatters
    /// so no literal is hardcoded; falls back to the empty copy when nothing recorded.
    public static func summary(
        _ data: CostHeatmapData,
        dayLabels: [String],
        labels: CostHeatmapSummaryLabels,
        formatCurrency: (Double) -> String,
        formatInt: (Double) -> String
    ) -> String {
        let active = data.entries.filter { CostHeatmapNumeric.safe($0.sessions) > 0 }
        guard !active.isEmpty else { return labels.empty }
        let total = active.reduce(0.0) { $0 + CostHeatmapNumeric.safe($1.sessions) }
        let costs = active.map { CostHeatmapNumeric.safe($0.avgCostPerKwh) }
        let cheapest = costs.min() ?? 0
        let priciest = costs.max() ?? 0
        var sentences: [String] = [
            "\(labels.title).",
            "\(formatInt(total)) \(labels.sessions).",
            "\(labels.cheapest) \(formatCurrency(cheapest))\(labels.perKwh), "
                + "\(labels.priciest) \(formatCurrency(priciest))\(labels.perKwh)."
        ]
        if let busiest = busiestEntry(active), dayLabels.indices.contains(busiest.day) {
            let hour = Swift.max(0, Swift.min(23, busiest.hour))
            sentences.append("\(labels.busiest) \(dayLabels[busiest.day]) \(hour):00.")
        }
        return sentences.joined(separator: " ")
    }
}
