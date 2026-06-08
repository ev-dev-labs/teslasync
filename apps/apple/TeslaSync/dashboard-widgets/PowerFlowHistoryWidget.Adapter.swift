//
//  PowerFlowHistoryWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0073 · PowerFlowHistoryWidget (Apple)
//
//  The testable projection core: cached Tesla Energy live-status samples (watts)
//  → the view-ready `PowerFlowPoint`/`PowerFlowSummary` projection in kilowatts,
//  the four power-routing series catalog (solar / battery / grid / home) with the
//  exact web hex colors + i18n keys, the stacked-area sample flattener, the
//  number/time formatters (parity with web `fmtNumber` / `shortTime`), and the
//  VoiceOver summary builders. All pure + dependency-free (only SwiftUI's `Color`)
//  so the adapter can be unit-tested without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Series catalog (web `<Area>` solar / battery / grid / home)

/// One of the four stacked power-routing series. The raw value is the web
/// `dataKey`; `color` reproduces the exact web hex so the chart reads identically
/// on both apps, and `i18nKey`/`fallbackLabel` mirror the web `name={t(...)}`.
public enum PowerFlowSeries: String, CaseIterable, Identifiable, Sendable {
    case solar
    case battery
    case grid
    case home

    public var id: String {
        rawValue
    }

    /// The i18n key for the series name (web `widget.powerFlowHistory.{series}`).
    public var i18nKey: String {
        "widget.powerFlowHistory.\(rawValue)"
    }

    /// The web English fallback label (web `t(key, 'Solar' | 'Battery' | …)`).
    public var fallbackLabel: String {
        switch self {
        case .solar: "Solar"
        case .battery: "Battery"
        case .grid: "Grid"
        case .home: "Home"
        }
    }

    /// The series color — the exact web stroke hex (`#facc15` / `#22c55e` /
    /// `#3b82f6` / `#9ca3af`).
    public var color: Color {
        switch self {
        case .solar: Color(.sRGB, red: 0.980, green: 0.800, blue: 0.082, opacity: 1)
        case .battery: Color(.sRGB, red: 0.133, green: 0.773, blue: 0.369, opacity: 1)
        case .grid: Color(.sRGB, red: 0.231, green: 0.510, blue: 0.965, opacity: 1)
        case .home: Color(.sRGB, red: 0.612, green: 0.639, blue: 0.686, opacity: 1)
        }
    }

    /// The localized series name resolved through the injected localizer.
    public func localizedName(_ localize: (String, String) -> String) -> String {
        localize(i18nKey, fallbackLabel)
    }
}

// MARK: - Point projection (web `chartData` row)

/// One time bucket of the routing chart — the native port of the web `ChartDatum`,
/// carrying the four series in kilowatts (web divides the watt samples by 1000).
public struct PowerFlowPoint: Identifiable, Equatable, Sendable {
    public let id: String
    public let date: Date
    public let solarKw: Double
    public let batteryKw: Double
    public let gridKw: Double
    public let homeKw: Double

    public init(date: Date, solarKw: Double, batteryKw: Double, gridKw: Double, homeKw: Double) {
        id = String(date.timeIntervalSince1970)
        self.date = date
        self.solarKw = solarKw
        self.batteryKw = batteryKw
        self.gridKw = gridKw
        self.homeKw = homeKw
    }

    /// The kilowatt value for a given series (drives the stacked area marks).
    public func value(for series: PowerFlowSeries) -> Double {
        switch series {
        case .solar: solarKw
        case .battery: batteryKw
        case .grid: gridKw
        case .home: homeKw
        }
    }
}

// MARK: - Summary projection (web `avgSolarKw` / `peakHomeKw` / `netGridKwh`)

/// The three header stats — mean solar, peak home, and net grid (all kilowatts,
/// matching the web `unit: 'kW'`), projected from the chart points.
public struct PowerFlowSummary: Equatable, Sendable {
    public let avgSolarKw: Double
    public let peakHomeKw: Double
    public let netGridKw: Double

    public init(avgSolarKw: Double, peakHomeKw: Double, netGridKw: Double) {
        self.avgSolarKw = avgSolarKw
        self.peakHomeKw = peakHomeKw
        self.netGridKw = netGridKw
    }

    /// The neutral summary shown before any data resolves.
    public static let zero = PowerFlowSummary(avgSolarKw: 0, peakHomeKw: 0, netGridKw: 0)
}

/// One flattened (point × series) datum for the stacked Swift Chart. Keeping the
/// flatten pure + public lets the chart body stay declarative and the stacking
/// order stay unit-tested.
public struct PowerFlowChartSample: Identifiable, Equatable, Sendable {
    public let id: String
    public let date: Date
    public let series: PowerFlowSeries
    public let valueKw: Double

    public init(date: Date, series: PowerFlowSeries, valueKw: Double) {
        id = "\(series.rawValue)-\(date.timeIntervalSince1970)"
        self.date = date
        self.series = series
        self.valueKw = valueKw
    }
}

// MARK: - Projection core

/// Pure projection from cached watt samples to the view-ready kilowatt points,
/// summary stats, stacked samples, and the has-data predicate. Mirrors the web
/// `chartData`/`avgSolarKw`/`peakHomeKw`/`netGridKwh`/`hasData` memos.
public enum PowerFlowHistoryWidgetProjection {
    /// Converts the cached live-status samples to chart points, applying the web
    /// `(x ?? 0) / 1000` watt→kilowatt conversion + null-coalescing per field.
    public static func points(from history: [PowerFlowHistoryEntryInput]) -> [PowerFlowPoint] {
        history.map { entry in
            PowerFlowPoint(
                date: entry.timestamp,
                solarKw: (entry.solarPowerW ?? 0) / 1000,
                batteryKw: (entry.batteryPowerW ?? 0) / 1000,
                gridKw: (entry.gridPowerW ?? 0) / 1000,
                homeKw: (entry.loadPowerW ?? 0) / 1000
            )
        }
    }

    /// Projects the header stats: mean solar, peak home, summed net grid.
    public static func summary(for points: [PowerFlowPoint]) -> PowerFlowSummary {
        guard !points.isEmpty else { return .zero }
        let solarTotal = points.reduce(0) { $0 + $1.solarKw }
        let avgSolar = solarTotal / Double(points.count)
        let peakHome = points.reduce(0) { max($0, $1.homeKw) }
        let netGrid = points.reduce(0) { $0 + $1.gridKw }
        return PowerFlowSummary(avgSolarKw: avgSolar, peakHomeKw: peakHome, netGridKw: netGrid)
    }

    /// Flattens the points into stacked (point × series) samples in series order
    /// (solar → battery → grid → home), matching the web `<Area>` stacking order.
    public static func samples(for points: [PowerFlowPoint]) -> [PowerFlowChartSample] {
        points.flatMap { point in
            PowerFlowSeries.allCases.map { series in
                PowerFlowChartSample(date: point.date, series: series, valueKw: point.value(for: series))
            }
        }
    }

    /// Whether any series carries a non-zero value (web
    /// `chartData.some(d => d.solar !== 0 || …)`); gates the noData empty surface.
    public static func hasData(_ points: [PowerFlowPoint]) -> Bool {
        points.contains { point in
            point.solarKw != 0 || point.batteryKw != 0 || point.gridKw != 0 || point.homeKw != 0
        }
    }
}

// MARK: - Formatters (web `fmtNumber` / `shortTime`)

/// Locale-aware number + time formatting for the surface, kept pure so the
/// rendered strings can be asserted deterministically with an explicit locale.
public enum PowerFlowHistoryWidgetFormat {
    /// One-decimal kilowatt value (web `fmtNumber(value, 1)`). Non-finite input
    /// renders an em dash rather than "nan".
    public static func kilowatts(_ value: Double, locale: Locale = .current) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = 1
        formatter.maximumFractionDigits = 1
        // Half-up (away from zero) so display matches the web `Intl`/`toFixed`
        // rounding rather than `NumberFormatter`'s default banker's rounding.
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.1f", value)
    }

    /// Zero-padded 24-hour `HH:mm` bucket label (web `shortTime`). `calendar` is
    /// injectable for deterministic tests.
    public static func shortTime(_ date: Date, calendar: Calendar = .current) -> String {
        let components = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the chart + stat row. Pure + public so the
/// spoken content can be unit-tested without rendering the view.
public enum PowerFlowAccessibility {
    /// One spoken stat fragment, e.g. "Avg Solar 1.2 kW".
    public static func statLabel(
        labelKey: String,
        fallback: String,
        valueKw: Double,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let label = localize(labelKey, fallback)
        let value = PowerFlowHistoryWidgetFormat.kilowatts(valueKw, locale: locale)
        let unit = localize("widget.powerFlowHistory.unitKw", "kW")
        return "\(label): \(value) \(unit)"
    }

    /// The combined VoiceOver summary for the routing chart (title + three stats).
    public static func chartSummary(
        summary: PowerFlowSummary,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let parts = [
            localize("widget.powerFlowHistory.title", "Power Flow History"),
            statLabel(
                labelKey: "widget.powerFlowHistory.avgSolar", fallback: "Avg Solar",
                valueKw: summary.avgSolarKw, localize: localize, locale: locale
            ),
            statLabel(
                labelKey: "widget.powerFlowHistory.peakHome", fallback: "Peak Home",
                valueKw: summary.peakHomeKw, localize: localize, locale: locale
            ),
            statLabel(
                labelKey: "widget.powerFlowHistory.netGrid", fallback: "Net Grid",
                valueKw: summary.netGridKw, localize: localize, locale: locale
            )
        ]
        return parts.joined(separator: ". ")
    }
}
