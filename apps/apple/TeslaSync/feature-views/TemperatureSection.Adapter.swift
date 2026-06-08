//
//  TemperatureSection.Adapter.swift
//  TeslaSync — P4 feature view · 0150 · TemperatureSection (Apple)
//
//  Pure (Foundation-only) projection core for the drive-detail "Temperatures"
//  surface — the faithful port of
//  features/driving/components/drive-detail/TemperatureSection.tsx (+ the
//  upstream useDriveDetailData `chartData` / `stats` derivation it consumes).
//
//  The web leaf is fed already-converted display values by its parent hook; the
//  native surface instead receives the SI floor the Phase-42 pipeline stores
//  (degrees Celsius) and converts at the display boundary here, via
//  `convertTempSectionFromSI` (°C identity, °F is c * 9 / 5 + 32 — the 1:1 port of
//  `convertTempFromSI` in lib/unitConversion.ts). Averages, the climate-status
//  rollup, the fan summary, the per-series presence gate (`stats.hasAnyTemp`), and
//  the content/empty split (`chartData.length > 1 && stats.hasAnyTemp`) are all
//  reproduced VERBATIM so the native surface shows the exact same numbers as the
//  web source. Dependency-free so every value can be pinned by unit tests without a
//  bundle or a rendered view (the SwiftUI chrome layers on top in the .swift /
//  .Views.swift files).
//

import Foundation

// MARK: - Temperature unit + conversion (ported 1:1 from lib/unitConversion.ts)

/// The user's temperature display preference. Mirrors the web `tempUnit`
/// (`unitPrefs.temperature` from `useUnits()`), stored as the symbol the web
/// converter switches on and the suffix the tiles / legend append.
public enum TempSectionUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The symbol appended to tile values + legend labels (web `tempUnit`).
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol (`'°C'` / `'°F'`),
    /// defaulting to Celsius (the SI display default) for any unknown value.
    public static func from(symbol: String) -> TempSectionUnit {
        TempSectionUnit(rawValue: symbol) ?? .celsius
    }
}

/// Temperature converter ported 1:1 from `convertTempFromSI(celsius, to)`:
/// Celsius passes through; Fahrenheit is `c * 9 / 5 + 32`. The per-sample telemetry
/// temperatures arrive in degrees Celsius (the SI floor stored by Phase-42).
public func convertTempSectionFromSI(_ celsius: Double, to unit: TempSectionUnit) -> Double {
    switch unit {
    case .celsius:
        celsius
    case .fahrenheit:
        celsius * 9 / 5 + 32
    }
}

// MARK: - Sample input (web `ChartDataPoint` subset)

/// One per-sample telemetry row, narrowed to the fields the web
/// `TemperatureSection` reads off `chartData`. Temperatures are SI degrees Celsius
/// (converted to the display unit by the projector); `time` is the pre-formatted
/// axis label (web `formatTime(...)`); `climateOn` / `fanStatus` back the climate +
/// fan stat tiles.
public struct TempSectionSample: Sendable, Equatable {
    /// The formatted time-of-day label for this sample (web `time`).
    public var time: String
    /// Outside (ambient) temperature in °C (web `outsideTemp`, pre-conversion).
    public var outsideC: Double?
    /// Inside (cabin) temperature in °C (web `insideTemp`, pre-conversion).
    public var insideC: Double?
    /// Driver-seat set temperature in °C (web `driverTemp`, pre-conversion).
    public var driverC: Double?
    /// Passenger-seat set temperature in °C (web `passengerTemp`, pre-conversion).
    public var passengerC: Double?
    /// Whether climate control was on for this sample (web `climateOn`).
    public var climateOn: Bool?
    /// The fan speed reading for this sample (web `fanStatus`).
    public var fanStatus: Double?

    public init(
        time: String,
        outsideC: Double? = nil,
        insideC: Double? = nil,
        driverC: Double? = nil,
        passengerC: Double? = nil,
        climateOn: Bool? = nil,
        fanStatus: Double? = nil
    ) {
        self.time = time
        self.outsideC = outsideC
        self.insideC = insideC
        self.driverC = driverC
        self.passengerC = passengerC
        self.climateOn = climateOn
        self.fanStatus = fanStatus
    }
}

// MARK: - Series (web four `<Line>` traces)

/// The four temperature traces, mirroring the web `<Line dataKey>` keys + names.
/// `order` pins the plot / legend sequence (web outside → inside → driver →
/// passenger).
public enum TempSectionSeries: String, Sendable, Equatable, CaseIterable, Identifiable {
    case outside
    case inside
    case driver
    case passenger

    public var id: String {
        rawValue
    }

    /// Plot / legend order (web renders the lines in this order).
    public var order: Int {
        switch self {
        case .outside: 0
        case .inside: 1
        case .driver: 2
        case .passenger: 3
        }
    }

    /// The i18n key for the line / legend name (web `<Line name>` short label).
    public var nameKey: String {
        switch self {
        case .outside: "driveDetail.outside"
        case .inside: "driveDetail.inside"
        case .driver: "driveDetail.driver"
        case .passenger: "driveDetail.passenger"
        }
    }

    /// The web English fallback for `nameKey`.
    public var nameFallback: String {
        switch self {
        case .outside: "Outside"
        case .inside: "Inside"
        case .driver: "Driver"
        case .passenger: "Passenger"
        }
    }

    /// The i18n key for this series' stat-tile label (web `<p>` caption).
    public var tileLabelKey: String {
        switch self {
        case .outside: "driveDetail.outsideTemp"
        case .inside: "driveDetail.insideTemp"
        case .driver: "driveDetail.driverTemp"
        case .passenger: "driveDetail.passengerTemp"
        }
    }

    /// The web English fallback for `tileLabelKey`.
    public var tileLabelFallback: String {
        switch self {
        case .outside: "Outside Temperature"
        case .inside: "Inside Temperature"
        case .driver: "Driver Temperature"
        case .passenger: "Passenger Temperature"
        }
    }

    /// The four series in plot / legend order.
    public static var ordered: [TempSectionSeries] {
        allCases.sorted { $0.order < $1.order }
    }
}

// MARK: - Climate status (web `stats.climateStatus`)

/// The climate-control rollup the web derives from the per-sample `climateOn`
/// counts: `On` when climate was on for at least half the samples, `Mostly Off`
/// when it was on for a minority, `Off` when it was only ever off, and absent when
/// no climate signal was seen (web `null`).
public enum TempSectionClimate: String, Sendable, Equatable {
    case on
    case mostlyOff
    case off

    /// The i18n key for the climate tile value word.
    public var labelKey: String {
        switch self {
        case .on: "driveDetail.climateOn"
        case .mostlyOff: "driveDetail.climateMostlyOff"
        case .off: "driveDetail.climateOff"
        }
    }

    /// The web English fallback for `labelKey` (web rendered these literals).
    public var labelFallback: String {
        switch self {
        case .on: "On"
        case .mostlyOff: "Mostly Off"
        case .off: "Off"
        }
    }

    /// The web highlight gate: only `On` is tinted positive, everything else is
    /// muted (`climateStatus === 'On' ? green : muted`).
    public var isOn: Bool {
        self == .on
    }
}

// MARK: - Stat-tile kinds (web six `<p>` cells)

/// Which stat tile a descriptor represents, in the web render order. Temperature
/// tiles show a converted average; `climate` shows the status word; `fan` shows the
/// average + max fan speed.
public enum TempSectionTileKind: String, Sendable, Equatable {
    case outside
    case inside
    case driver
    case passenger
    case climate
    case fan
}

// MARK: - Projected point (one chart sample, converted)

/// One converted chart sample: the axis label + each series' display-unit value (a
/// `nil` component means that trace had no reading at this sample, web `null`).
public struct TempSectionPoint: Sendable, Equatable, Identifiable {
    public var index: Int
    public var time: String
    public var outside: Double?
    public var inside: Double?
    public var driver: Double?
    public var passenger: Double?

    public var id: Int {
        index
    }

    public init(
        index: Int,
        time: String,
        outside: Double? = nil,
        inside: Double? = nil,
        driver: Double? = nil,
        passenger: Double? = nil
    ) {
        self.index = index
        self.time = time
        self.outside = outside
        self.inside = inside
        self.driver = driver
        self.passenger = passenger
    }

    /// The converted value for one series at this sample (chart / tooltip / a11y).
    public func value(for series: TempSectionSeries) -> Double? {
        switch series {
        case .outside: outside
        case .inside: inside
        case .driver: driver
        case .passenger: passenger
        }
    }
}

// MARK: - Projection (the view-ready model)

/// The fully-projected surface content: the converted chart points, which series
/// are present, the four series averages, the climate rollup, the fan summary, the
/// display-unit symbol, and the content/empty gate. All numeric, bundle-free, and
/// unit-testable; the view layers localized labels + chrome on top.
public struct TempSectionProjection: Sendable, Equatable {
    public var points: [TempSectionPoint]
    public var presentSeries: [TempSectionSeries]
    public var averages: [TempSectionSeries: Double]
    public var climate: TempSectionClimate?
    public var avgFan: Double?
    public var maxFan: Double?
    public var unitSymbol: String

    public init(
        points: [TempSectionPoint],
        presentSeries: [TempSectionSeries],
        averages: [TempSectionSeries: Double],
        climate: TempSectionClimate?,
        avgFan: Double?,
        maxFan: Double?,
        unitSymbol: String
    ) {
        self.points = points
        self.presentSeries = presentSeries
        self.averages = averages
        self.climate = climate
        self.avgFan = avgFan
        self.maxFan = maxFan
        self.unitSymbol = unitSymbol
    }

    /// The converted average for one series, or `nil` when that trace is absent.
    public func average(for series: TempSectionSeries) -> Double? {
        averages[series]
    }

    /// Web `stats.hasAnyTemp`: at least one of the four traces had a reading.
    public var hasAnyTemp: Bool {
        !presentSeries.isEmpty
    }

    /// The number of chart samples (web `chartData.length`).
    public var pointCount: Int {
        points.count
    }

    /// The web content gate: `chartData.length > 1 && stats.hasAnyTemp`. When false
    /// the surface shows the "no temperature telemetry" empty state instead of the
    /// tiles + chart.
    public var hasContent: Bool {
        pointCount > 1 && hasAnyTemp
    }

    /// The ordered stat tiles to render, each included only when its value is
    /// present — web order: outside, inside, driver, passenger, climate, fan.
    public var tileKinds: [TempSectionTileKind] {
        var kinds: [TempSectionTileKind] = []
        if averages[.outside] != nil { kinds.append(.outside) }
        if averages[.inside] != nil { kinds.append(.inside) }
        if averages[.driver] != nil { kinds.append(.driver) }
        if averages[.passenger] != nil { kinds.append(.passenger) }
        if climate != nil { kinds.append(.climate) }
        if maxFan != nil { kinds.append(.fan) }
        return kinds
    }
}
