//
//  SolarProductionWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0093 · SolarProductionWidget (Apple)
//
//  Domain value types for the solar-production surface — the cached DTO inputs
//  (Tesla Energy site + daily energy-history rows) and the chart/summary
//  projection (daily kWh points + the Today / 30-Day Total / Daily-Avg stats)
//  ported from features/dashboard/widgets/SolarProductionWidget.tsx plus
//  shared/WidgetChartSummary.tsx. No SwiftUI or transport here — this file is
//  pure Foundation so the adapter can be unit-tested (and host-executed) on its
//  own.
//

import Foundation

// MARK: - Cached DTO inputs (the shapes the P1/S8 source decodes for the view)

/// Value-typed projection of a `TeslaEnergySite` row (web `useTeslaEnergySites`).
/// The widget only needs the identity it resolves the history query with — the
/// web reads `sites[0].energy_site_id`; `siteName`/`hasSolar` are carried for the
/// accessible header + future labelling without re-fetching.
public struct SolarEnergySite: Sendable, Equatable, Identifiable {
    public let energySiteID: Int
    public var siteName: String?
    public var hasSolar: Bool

    public var id: Int {
        energySiteID
    }

    public init(energySiteID: Int, siteName: String? = nil, hasSolar: Bool = false) {
        self.energySiteID = energySiteID
        self.siteName = siteName
        self.hasSolar = hasSolar
    }
}

/// Value-typed projection of a `TeslaEnergyHistoryEntry` row (web
/// `useTeslaEnergyHistory(siteId, 'day', since)`). Only the two fields the widget
/// reads: the daily-bucket `timestamp` and the SI `solar_energy_wh` (nullable on
/// the wire → `nil` models the web `?? 0`).
public struct SolarHistoryEntry: Sendable, Equatable {
    public var timestamp: String
    public var solarEnergyWh: Double?

    public init(timestamp: String, solarEnergyWh: Double?) {
        self.timestamp = timestamp
        self.solarEnergyWh = solarEnergyWh
    }
}

// MARK: - Chart / summary projection (port of the web memoized derivations)

/// One day's solar generation (web `ChartDatum`). `index` is the stable x-position
/// in the series (Swift Charts plots on the numeric axis, then maps ticks back to
/// `dateLabel`); `isoDay` is the `yyyy-MM-dd` bucket used for the "today" match;
/// `dateLabel` is the web `shortDate` "M/D"; `solarKwh` is `solar_energy_wh / 1000`.
public struct SolarDailyPoint: Sendable, Equatable, Identifiable {
    public let index: Int
    public var isoDay: String
    public var dateLabel: String
    public var solarKwh: Double

    public var id: Int {
        index
    }

    public init(index: Int, isoDay: String, dateLabel: String, solarKwh: Double) {
        self.index = index
        self.isoDay = isoDay
        self.dateLabel = dateLabel
        self.solarKwh = solarKwh
    }
}

/// The fully-resolved chart + summary (web memoized `chartData` / `todayKwh` /
/// `totalKwh` / `avgKwh`). `hasData` mirrors the web
/// `chartData.length > 0 && chartData.some(d => d.solar_kwh > 0)` gate that drives
/// the "No solar data" empty branch.
public struct SolarProjection: Sendable, Equatable {
    public var points: [SolarDailyPoint]
    public var todayKwh: Double
    public var totalKwh: Double
    public var avgKwh: Double
    public var hasData: Bool

    public init(
        points: [SolarDailyPoint] = [],
        todayKwh: Double = 0,
        totalKwh: Double = 0,
        avgKwh: Double = 0,
        hasData: Bool = false
    ) {
        self.points = points
        self.todayKwh = todayKwh
        self.totalKwh = totalKwh
        self.avgKwh = avgKwh
        self.hasData = hasData
    }

    /// Empty projection — no history resolved yet (web `chartData.length === 0`).
    public static let empty = SolarProjection()

    /// The peak daily kWh in the window (drives the chart's accessible summary +
    /// the y-domain headroom). `0` when empty.
    public var peakKwh: Double {
        points.map(\.solarKwh).max() ?? 0
    }
}
