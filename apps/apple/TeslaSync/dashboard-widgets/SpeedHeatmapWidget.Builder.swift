//
//  SpeedHeatmapWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0094 · SpeedHeatmapWidget (Apple)
//
//  The pure cached → heatmap adapter: a faithful Swift port of the web
//  SpeedHeatmapWidget.tsx computation — buildHeatmap (7×24 day×hour bucketing),
//  convertSpeedFromSI, the 4-stop speed→colour gradient (speedToColor +
//  lerpColor), and the max/total/peak reductions, plus the day/hour axis labels.
//  No SwiftUI / transport — this is the unit-tested core both platforms agree on.
//

import Foundation

// MARK: - SpeedHeatmapBuilder (port of the web widget's derive block)

/// Pure functions that turn the cached `/drives` snapshot into the 7×24 display
/// grid + its colour ramp. A 1:1 port of the web source so both platforms show
/// identical buckets and colours.
public enum SpeedHeatmapBuilder {
    /// 7 rows (Mon–Sun) — web `ROWS`.
    public static let rows = 7
    /// 24 cols (0h–23h) — web `COLS`.
    public static let cols = 24

    private static let secondsPerHour: Double = 3600

    // MARK: Speed conversion (web `convertSpeedFromSI`)

    /// Converts SI meters-per-second to the user's display unit
    /// (`mps * 3600 / metersPerUnit`).
    public static func convertSpeedFromSI(_ mps: Double, to unit: SpeedHeatmapWidgetUnit) -> Double {
        let value = mps.isFinite ? mps : 0
        return (value * secondsPerHour) / unit.metersPerUnit
    }

    // MARK: Heatmap (web `buildHeatmap`)

    /// Builds a 7×24 grid of average speeds from drive start times. Drives with
    /// no start instant or a non-positive speed are skipped (web parity). The
    /// JS `getDay()` (0=Sun…6=Sat) → Mon-first remap is reproduced with the
    /// Gregorian weekday (1=Sun…7=Sat): `day = (weekday + 5) % 7`. The calendar
    /// carries the locale + time zone, so bucketing matches the device-local
    /// `getDay()/getHours()` the web uses.
    public static func buildHeatmap(
        drives: [SpeedHeatmapDrive],
        speedUnit: SpeedHeatmapWidgetUnit,
        calendar: Calendar = .current
    ) -> [[HeatCell]] {
        var totals = Array(repeating: Array(repeating: 0.0, count: cols), count: rows)
        var samples = Array(repeating: Array(repeating: 0, count: cols), count: rows)

        for drive in drives {
            guard let start = drive.startDate else { continue }
            guard let speed = drive.effectiveSpeedMps, speed > 0 else { continue }
            let weekday = calendar.component(.weekday, from: start)
            let day = (weekday + 5) % 7
            let hour = calendar.component(.hour, from: start)
            guard day >= 0, day < rows, hour >= 0, hour < cols else { continue }
            totals[day][hour] += speed
            samples[day][hour] += 1
        }

        return (0 ..< rows).map { day in
            (0 ..< cols).map { hour in
                let tally = samples[day][hour]
                let mean = tally > 0 ? convertSpeedFromSI(totals[day][hour] / Double(tally), to: speedUnit) : 0
                return HeatCell(day: day, hour: hour, avgSpeed: mean, driveCount: tally)
            }
        }
    }

    // MARK: Reductions (web `maxSpeed` / `totalDrives` memos)

    /// The largest cell average across the grid (web `maxSpeed` memo).
    public static func maxSpeed(in grid: [[HeatCell]]) -> Double {
        grid.reduce(0) { rowMax, row in
            max(rowMax, row.reduce(0) { max($0, $1.avgSpeed) })
        }
    }

    /// The total number of contributing drives (web `totalDrives` memo).
    public static func totalDrives(in grid: [[HeatCell]]) -> Int {
        grid.reduce(0) { acc, row in
            acc + row.reduce(0) { $0 + $1.driveCount }
        }
    }

    /// The busiest/fastest populated cell — the peak slot — used for the
    /// accessibility summary. `nil` when no cell has drives.
    public static func peakCell(in grid: [[HeatCell]]) -> HeatCell? {
        grid.flatMap(\.self)
            .filter { $0.driveCount > 0 }
            .max { $0.avgSpeed < $1.avgSpeed }
    }

    // MARK: Colour ramp (web `speedToColor` / `lerpColor` / `COLOR_STOPS`)

    /// 4-stop gradient: cool teal → cyan → warm amber → hot red
    /// (web `COLOR_STOPS`, normalized to 0…1).
    static let colorStops: [RGBAColor] = [
        RGBAColor(red: 20 / 255, green: 184 / 255, blue: 166 / 255),
        RGBAColor(red: 6 / 255, green: 182 / 255, blue: 212 / 255),
        RGBAColor(red: 245 / 255, green: 158 / 255, blue: 11 / 255),
        RGBAColor(red: 239 / 255, green: 68 / 255, blue: 68 / 255)
    ]

    /// The empty-cell fill the web uses (`rgba(255,255,255,0.03)`). Returned by
    /// `speedColor` for non-positive speeds; the view substitutes a theme token
    /// for light-mode legibility (see the surface), but the value is pinned here
    /// for web parity.
    static let emptyCellColor = RGBAColor(red: 1, green: 1, blue: 1, alpha: 0.03)

    /// Maps a cell's speed to a gradient colour (web `speedToColor`). `t` is the
    /// speed fraction of the max; it is positioned across the 3 gradient segments
    /// and linearly interpolated between the two bounding stops.
    public static func speedColor(speed: Double, maxSpeed: Double) -> RGBAColor {
        guard speed > 0, maxSpeed > 0 else { return emptyCellColor }
        let fraction = min(speed / maxSpeed, 1)
        let segmentCount = colorStops.count - 1
        let segment = min(Int((fraction * Double(segmentCount)).rounded(.down)), segmentCount - 1)
        let localT = (fraction * Double(segmentCount)) - Double(segment)
        return lerp(colorStops[segment], colorStops[segment + 1], localT)
    }

    /// Interpolates between two colours, rounding each channel in 0…255 space to
    /// match the web `lerpColor` (`Math.round`), then normalizing back to 0…1.
    static func lerp(_ from: RGBAColor, _ to: RGBAColor, _ progress: Double) -> RGBAColor {
        RGBAColor(
            red: channel(from.red, to.red, progress),
            green: channel(from.green, to.green, progress),
            blue: channel(from.blue, to.blue, progress),
            alpha: 1
        )
    }

    private static func channel(_ from: Double, _ to: Double, _ progress: Double) -> Double {
        (((from + (to - from) * progress) * 255).rounded()) / 255
    }

    // MARK: Axis labels

    /// The hour ticks along the top: every 3h when wide, every 6h otherwise
    /// (web `hourLabels`).
    public static func hourLabels(wide: Bool) -> [Int] {
        wide ? [0, 3, 6, 9, 12, 15, 18, 21] : [0, 6, 12, 18]
    }

    /// The Monday-first day labels along the left. Derived from the calendar's
    /// locale weekday symbols (very-short when narrow, short when wide) so they
    /// are localized — the web hardcodes the English letters, but the platform
    /// idiom (and the no-hardcoded-string rule) is to read them from the locale.
    /// Symbols are Sunday-first; reorder to Mon…Sun.
    public static func dayLabels(wide: Bool, calendar: Calendar = .current) -> [String] {
        let symbols = wide ? calendar.shortWeekdaySymbols : calendar.veryShortWeekdaySymbols
        guard symbols.count == rows else { return [] }
        return [symbols[1], symbols[2], symbols[3], symbols[4], symbols[5], symbols[6], symbols[0]]
    }
}
