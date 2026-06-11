//
//  ChargingTab.Adapter.swift
//  TeslaSync — P4 feature view · 0054 · ChargingTab (Apple)
//
//  The testable projection core: the SI/derived `ChargingTab*Input` DTOs (parity with the
//  web `FleetAnalytics` totals + `charging_analytics` slice the tab reads) → the view-ready
//  datasets the six summary cards and three charts render. Reproduces the web source's exact
//  behavior: the `safe(v)` finite-or-zero guard (`@/components/charts`), the `powerStats ? … : '—'`
//  optional-stat guard that drives the em-dash metric cards, the donut share/legend ordering
//  (web `PIE_COLORS[i % len]` → palette index by source order), the start-battery histogram, the
//  hourly bar+line dual-axis scale (web twin axes), and the `${hour}:00` axis label. All pure +
//  Foundation-only so the adapter can be unit-tested without a store, a bundle, or a rendered view.
//
//  Unlike the sibling DrivingTab/BatteryTab adapters this surface performs NO unit conversion: the
//  web `ChargingTab.tsx` reads `useFormatting` (currency only), never `useUnits`, so kWh / kW / % /
//  min show as-is. Formatting is a display-boundary concern injected via `ChargingTabFormatting`.
//  The VoiceOver summary builders live in `ChargingTab.Accessibility.swift`.
//

import Foundation

// MARK: - Render phase (web shell loading / content branches)

/// The mutually-exclusive render branches the surface switches over. The web `ChargingTab`
/// always renders its six summary cards (never gated) and lets each chart render its own
/// per-series empty state, so there is no whole-surface "empty" phase that hides the cards:
/// a resolved-but-empty payload is `.content` (cards show zeros / em dashes, charts show their
/// friendly empty rows). `.loading` is only the initial fetch before any payload; `.error` is a
/// hard failure with nothing cached to keep on screen.
public enum ChargingTabPhase: Equatable, Sendable {
    case loading
    case error(String)
    case content
}

// MARK: - Numeric guard (port of the web `safe` from @/components/charts)

/// Numeric helpers shared by the projection. `safe` is the native port of the web
/// `safe = (v) => typeof v === 'number' && isFinite(v) ? v : 0`, used everywhere a count /
/// metric feeds arithmetic so a `NaN` / `Infinity` never reaches a bar height, an axis, or a
/// label.
public enum ChargingTabNumeric {
    /// Returns the value when it is finite, else `0` (web `safe`).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }

    /// Abbreviated axis label; non-finite input renders an em dash (never "nan"). Native parity
    /// of the web chart axis tick formatter.
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

    /// Web `tickFormatter={(h) => `${h}:00`}` for the hourly-pattern x-axis.
    public static func hourLabel(_ hour: Int) -> String {
        "\(hour):00"
    }
}

// MARK: - Input DTOs (web `charging_analytics` + the `FleetAnalytics` totals the tab reads)

/// One stats block the tab reads `.avg` from (web `StatsSummary`). Modeled as the single field
/// the surface consumes; its OPTIONALITY (carried on `ChargingTabAnalyticsInput`) reproduces the
/// web `powerStats ? … : '—'` guard — an absent block renders the metric card's em dash.
public struct ChargingTabStatInput: Sendable, Equatable {
    public var avg: Double

    public init(avg: Double) {
        self.avg = avg
    }
}

/// One charger-type row (web `charger_types[i]` — `{ type, count }`).
public struct ChargingTabChargerTypeInput: Sendable, Equatable {
    public var type: String
    public var count: Int

    public init(type: String, count: Int) {
        self.type = type
        self.count = count
    }
}

/// One start-battery distribution bin (web `start_battery_dist[i]` — `{ range, count }`).
public struct ChargingTabBatteryBinInput: Sendable, Equatable {
    public var range: String
    public var count: Int

    public init(range: String, count: Int) {
        self.range = range
        self.count = count
    }
}

/// One hour-of-day sample (web `hourly_pattern[i]` — `{ hour, charges, energy }`). `charges` is the
/// session count (left axis); `energy` is kWh (right axis) — both plotted un-converted, web parity.
public struct ChargingTabHourlyPointInput: Sendable, Equatable {
    public var hour: Int
    public var charges: Double
    public var energy: Double

    public init(hour: Int, charges: Double, energy: Double) {
        self.hour = hour
        self.charges = charges
        self.energy = energy
    }
}

/// The charging payload the surface reads. Bundles the three `FleetAnalytics` totals the tab
/// shows (`total_charging_sessions` / `total_energy_kwh` / `total_cost`) with the
/// `charging_analytics` fields the cards + charts consume. The production source projects these
/// from the shared analytics state holder; only the fields this surface renders are modeled.
public struct ChargingTabAnalyticsInput: Sendable, Equatable {
    public var totalSessions: Double
    public var totalEnergyKwh: Double
    public var totalCost: Double
    public var powerStats: ChargingTabStatInput?
    public var durationStats: ChargingTabStatInput?
    public var efficiencyStats: ChargingTabStatInput?
    public var chargerTypes: [ChargingTabChargerTypeInput]
    public var startBatteryDist: [ChargingTabBatteryBinInput]
    public var hourlyPattern: [ChargingTabHourlyPointInput]

    public init(
        totalSessions: Double = 0,
        totalEnergyKwh: Double = 0,
        totalCost: Double = 0,
        powerStats: ChargingTabStatInput? = nil,
        durationStats: ChargingTabStatInput? = nil,
        efficiencyStats: ChargingTabStatInput? = nil,
        chargerTypes: [ChargingTabChargerTypeInput] = [],
        startBatteryDist: [ChargingTabBatteryBinInput] = [],
        hourlyPattern: [ChargingTabHourlyPointInput] = []
    ) {
        self.totalSessions = totalSessions
        self.totalEnergyKwh = totalEnergyKwh
        self.totalCost = totalCost
        self.powerStats = powerStats
        self.durationStats = durationStats
        self.efficiencyStats = efficiencyStats
        self.chargerTypes = chargerTypes
        self.startBatteryDist = startBatteryDist
        self.hourlyPattern = hourlyPattern
    }
}

// MARK: - Projected datasets (web chart `data` + the six MetricCards)

/// The six summary-card values (web MetricCards). Totals are always present (web `fmtInt` /
/// `fmtNumber` of a possibly-undefined value collapse to `0`); the three averages are OPTIONAL —
/// `nil` renders the em dash exactly as the web `powerStats ? fmtNumber(safe(avg)) : '—'` guard.
/// All raw numbers — the view formats them at the display boundary via `ChargingTabFormatting`.
public struct ChargingTabSummaryMetrics: Equatable, Sendable {
    public let sessions: Double
    public let energyKwh: Double
    public let totalCost: Double
    public let avgPower: Double?
    public let avgDuration: Double?
    public let avgEfficiency: Double?

    public init(
        sessions: Double,
        energyKwh: Double,
        totalCost: Double,
        avgPower: Double?,
        avgDuration: Double?,
        avgEfficiency: Double?
    ) {
        self.sessions = sessions
        self.energyKwh = energyKwh
        self.totalCost = totalCost
        self.avgPower = avgPower
        self.avgDuration = avgDuration
        self.avgEfficiency = avgEfficiency
    }

    /// The no-data card values (web `data === undefined`): zero totals, em-dash averages.
    public static let zero = ChargingTabSummaryMetrics(
        sessions: 0,
        energyKwh: 0,
        totalCost: 0,
        avgPower: nil,
        avgDuration: nil,
        avgEfficiency: nil
    )
}

/// One donut slice (web `charger_types[i]` plotted as a `Pie` sector). `colorIndex` is the source
/// index — the palette wraps it, matching web `PIE_COLORS[i % PIE_COLORS.length]`.
public struct ChargingTabChargerTypeSlice: Identifiable, Equatable, Sendable {
    public let id: String
    public let type: String
    public let count: Double
    public let colorIndex: Int

    public init(type: String, count: Double, colorIndex: Int) {
        id = "\(colorIndex)-\(type)"
        self.type = type
        self.count = count
        self.colorIndex = colorIndex
    }
}

/// One start-battery histogram bar (web `{ range, count }`). `count` is a `Double` for Swift
/// Charts; `range` is the category label.
public struct ChargingTabDistributionBar: Identifiable, Equatable, Sendable {
    public let id: String
    public let range: String
    public let count: Double

    public init(id: String, range: String, count: Double) {
        self.id = id
        self.range = range
        self.count = count
    }
}

/// One hourly-pattern sample (web `{ hour, charges, energy }`): a bar (charges, left axis) + a
/// line (energy, right axis) keyed by hour.
public struct ChargingTabHourlyPoint: Identifiable, Equatable, Sendable {
    public let id: Int
    public let hour: Int
    public let charges: Double
    public let energy: Double

    public init(hour: Int, charges: Double, energy: Double) {
        id = hour
        self.hour = hour
        self.charges = charges
        self.energy = energy
    }
}

/// The dual-axis scale for the hourly composed chart. The web binds `charges` (bar) to the LEFT
/// axis and `energy` (line) to the RIGHT axis. Swift Charts shares one y-domain, so the energy
/// line is re-projected onto the left domain (`plotted`) and a trailing axis is drawn with labels
/// mapped back to true energy (`trueEnergy(fromPlotted:)`). Pure + tested — the native parity of
/// the sibling `MonthlyTrendScale`.
public struct ChargingTabHourlyScale: Equatable, Sendable {
    /// Top of the left domain (max charges across hours, ≥ 1).
    public let leftMax: Double
    /// Top of the right domain (max energy across hours, ≥ 1).
    public let rightMax: Double

    public init(leftMax: Double, rightMax: Double) {
        self.leftMax = Swift.max(leftMax, 1)
        self.rightMax = Swift.max(rightMax, 1)
    }

    /// Projects a true energy value (right units) onto the left plotting domain.
    public func plotted(energy: Double) -> Double {
        ChargingTabNumeric.safe(energy) * (leftMax / rightMax)
    }

    /// Inverts `plotted(energy:)` — maps a left-domain value back to true energy for the
    /// trailing-axis labels.
    public func trueEnergy(fromPlotted plotted: Double) -> Double {
        plotted * (rightMax / leftMax)
    }

    /// Upper bound for `chartYScale` with a little headroom so the top mark / ticks aren't clipped.
    public var domainUpperBound: Double {
        Swift.max(leftMax * 1.05, 1)
    }

    /// Five evenly spaced left-domain tick positions for the trailing axis.
    public var trailingTickPositions: [Double] {
        (0 ... 4).map { Double($0) / 4 * leftMax }
    }
}

// MARK: - Projection (pure, web-parity)

/// The view-ready projection of the six cards + three charts. Built once per snapshot by
/// `make(from:)`; the view switches on `ChargingTabModel.phase` and renders each dataset (or its
/// per-series empty row). No formatting / locale lives here — the view formats at the boundary.
public struct ChargingTabProjection: Equatable, Sendable {
    public let summary: ChargingTabSummaryMetrics
    public let chargerTypes: [ChargingTabChargerTypeSlice]
    public let batteryDist: [ChargingTabDistributionBar]
    public let hourly: [ChargingTabHourlyPoint]
    public let hourlyScale: ChargingTabHourlyScale

    public init(
        summary: ChargingTabSummaryMetrics,
        chargerTypes: [ChargingTabChargerTypeSlice],
        batteryDist: [ChargingTabDistributionBar],
        hourly: [ChargingTabHourlyPoint],
        hourlyScale: ChargingTabHourlyScale
    ) {
        self.summary = summary
        self.chargerTypes = chargerTypes
        self.batteryDist = batteryDist
        self.hourly = hourly
        self.hourlyScale = hourlyScale
    }

    /// Whether the donut has at least one charger-type slice.
    public var hasChargerTypes: Bool {
        !chargerTypes.isEmpty
    }

    /// Whether the start-battery histogram has at least one bin.
    public var hasBatteryDist: Bool {
        !batteryDist.isEmpty
    }

    /// Whether the hourly pattern has at least one sample.
    public var hasHourly: Bool {
        !hourly.isEmpty
    }

    /// Whether any of the three charts has data (drives the surface-level "is this empty?" read).
    public var hasAnyChart: Bool {
        hasChargerTypes || hasBatteryDist || hasHourly
    }

    /// An all-empty projection carrying the zero summary cards (no payload yet).
    public static let empty = ChargingTabProjection(
        summary: .zero,
        chargerTypes: [],
        batteryDist: [],
        hourly: [],
        hourlyScale: ChargingTabHourlyScale(leftMax: 0, rightMax: 0)
    )

    /// Projects the payload into the six cards + three chart datasets.
    public static func make(from input: ChargingTabAnalyticsInput?) -> ChargingTabProjection {
        guard let input else { return .empty }

        let summary = ChargingTabSummaryMetrics(
            sessions: ChargingTabNumeric.safe(input.totalSessions),
            energyKwh: ChargingTabNumeric.safe(input.totalEnergyKwh),
            totalCost: ChargingTabNumeric.safe(input.totalCost),
            avgPower: input.powerStats.map { ChargingTabNumeric.safe($0.avg) },
            avgDuration: input.durationStats.map { ChargingTabNumeric.safe($0.avg) },
            avgEfficiency: input.efficiencyStats.map { ChargingTabNumeric.safe($0.avg) }
        )
        let chargerTypes = input.chargerTypes.enumerated().map { index, datum in
            ChargingTabChargerTypeSlice(
                type: datum.type,
                count: ChargingTabNumeric.safe(Double(datum.count)),
                colorIndex: index
            )
        }
        let batteryDist = input.startBatteryDist.enumerated().map { index, bin in
            ChargingTabDistributionBar(id: "\(index)-\(bin.range)", range: bin.range, count: Double(bin.count))
        }
        let hourly = input.hourlyPattern.map { point in
            ChargingTabHourlyPoint(
                hour: point.hour,
                charges: ChargingTabNumeric.safe(point.charges),
                energy: ChargingTabNumeric.safe(point.energy)
            )
        }
        return ChargingTabProjection(
            summary: summary,
            chargerTypes: chargerTypes,
            batteryDist: batteryDist,
            hourly: hourly,
            hourlyScale: hourlyScale(for: hourly)
        )
    }

    /// The dual-axis scale for the hourly chart: `leftMax` spans charges, `rightMax` spans energy.
    public static func hourlyScale(for points: [ChargingTabHourlyPoint]) -> ChargingTabHourlyScale {
        var leftMax = 0.0
        var rightMax = 0.0
        for point in points {
            leftMax = Swift.max(leftMax, ChargingTabNumeric.safe(point.charges))
            rightMax = Swift.max(rightMax, ChargingTabNumeric.safe(point.energy))
        }
        return ChargingTabHourlyScale(leftMax: leftMax, rightMax: rightMax)
    }

    /// Resolves the surface render phase. The skeleton shows only on the initial fetch (nothing
    /// loaded yet); once any payload has arrived the cards stay visible (web parity — the cards are
    /// never gated), with the freshness chip + banner reflecting staleness. A failure with nothing
    /// cached is the hard-error state.
    public static func resolvePhase(_ status: ChargingTabLoadStatus, hasLoaded: Bool) -> ChargingTabPhase {
        switch status {
        case .loading:
            hasLoaded ? .content : .loading
        case .loaded, .empty:
            .content
        case let .failed(message):
            hasLoaded ? .content : .error(message)
        }
    }
}
