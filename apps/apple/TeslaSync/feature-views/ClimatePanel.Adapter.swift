//
//  ClimatePanel.Adapter.swift
//  TeslaSync — P4 feature view · 0278 · ClimatePanel (Apple)
//
//  The pure cached → panel projection (no SwiftUI, no networking) for the ClimatePanel
//  surface — the native port of
//  features/vehicles/components/telemetry-panels/ClimatePanel.tsx. The web component is
//  presentational: it reads the cached `ClimateSnapshot` (`climateData`) and renders the
//  Cabin / Outside temperature cards, the Driver / Passenger setpoint rows, the HVAC State
//  row, a six-bar Fan Speed meter, and the Defrost / Climate / Precondition badges. This
//  file reproduces every one of those render branches — including the web nullish fallbacks
//  (`fan_status ?? 0`, `hvac_state ?? '—'`) and the defrost `mode && mode !== 'Off'` guard —
//  over value types so each card / row / badge's value, tone, and VoiceOver summary match
//  the web exactly. Unit tested branch-by-branch.
//
//  Naming note: the sibling dashboard widget `ClimateControlPanelWidget` already owns the
//  `ClimatePanel*` symbol prefix in the shared `TeslaSync` module, so this surface's
//  supporting value types use the collision-free `CabinClimatePanel*` prefix. The public
//  SwiftUI entry point is still `ClimatePanel` (see ClimatePanel.swift) for parity with the
//  web component name, and the diagnostics slug is still "ClimatePanel".
//

import Foundation

// MARK: - Snapshot (web `ClimateSnapshot` subset the panel reads)

/// The cached climate snapshot the panel renders (web `climateData: ClimateSnapshot`). Only
/// the fields the web panel reads are modeled: the four temperatures are degrees Celsius (the
/// SI floor the Phase-42 pipeline stores) and convert to the user's unit at the render
/// boundary; `hvacState` / `defrostMode` are the `string | null` status columns shown
/// verbatim; `isClimateOn` / `isPreconditioning` are `boolean | null`; `fanStatus` is the
/// `number | null` fan level.
public struct CabinClimatePanelSnapshot: Sendable, Equatable {
    public var insideTempC: Double?
    public var outsideTempC: Double?
    public var driverSetpointC: Double?
    public var passengerSetpointC: Double?
    public var hvacState: String?
    public var defrostMode: String?
    public var isClimateOn: Bool?
    public var isPreconditioning: Bool?
    public var fanStatus: Int?

    public init(
        insideTempC: Double? = nil,
        outsideTempC: Double? = nil,
        driverSetpointC: Double? = nil,
        passengerSetpointC: Double? = nil,
        hvacState: String? = nil,
        defrostMode: String? = nil,
        isClimateOn: Bool? = nil,
        isPreconditioning: Bool? = nil,
        fanStatus: Int? = nil
    ) {
        self.insideTempC = insideTempC
        self.outsideTempC = outsideTempC
        self.driverSetpointC = driverSetpointC
        self.passengerSetpointC = passengerSetpointC
        self.hvacState = hvacState
        self.defrostMode = defrostMode
        self.isClimateOn = isClimateOn
        self.isPreconditioning = isPreconditioning
        self.fanStatus = fanStatus
    }
}

// MARK: - Temperature display unit (web `useUnits().unitPrefs.temperature`)

/// The user's temperature display preference, mirroring the web `TemperatureUnitPref` resolved
/// by `useUnits()` (`unitPrefs.temperature`, derived from `settings.unit_of_temp`). Stored as
/// the symbol the web converter appends (`'°C'` / `'°F'`).
public enum CabinClimatePanelTempUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The symbol appended to the formatted number (web `pref.temperature`, no leading space).
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol, defaulting to Celsius (the SI display
    /// floor) for any unrecognized value.
    public static func from(symbol: String) -> CabinClimatePanelTempUnit {
        CabinClimatePanelTempUnit(rawValue: symbol) ?? .celsius
    }
}

// MARK: - Unit preferences (web `useUnits()`)

/// The user's display preferences for the panel, mirroring `useUnits()`. The view never reads
/// settings directly; the source resolves these and pushes them with each snapshot so the same
/// preference the web `useUnits` hook applies is honored at the native render boundary.
public struct CabinClimatePanelUnitPrefs: Sendable, Equatable {
    public var temperature: CabinClimatePanelTempUnit
    public var localeIdentifier: String
    /// Fraction digits for the formatted temperature. `nil` uses the web temperature default of
    /// 1 (web `DEFAULT_PRECISION.temperature`); a value mirrors a user `settings.decimal_precision`
    /// override flowing through `useUnits`.
    public var precision: Int?

    public init(
        temperature: CabinClimatePanelTempUnit = .celsius,
        localeIdentifier: String = "en_US",
        precision: Int? = nil
    ) {
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
        self.precision = precision
    }
}

// MARK: - Tone (semantic only — mapped to a `Color.TS` token at the view layer)

/// The semantic color role for a value or badge. Kept free of SwiftUI so the projection stays
/// pure and testable; `ClimatePanel.Views` maps each case to a `Color.TS` design token.
/// `.primary` is the web `text-primary` mono value color; `.neutral` is the web `text-muted`.
public enum CabinClimatePanelTone: Sendable, Equatable {
    case success
    case warning
    case info
    case neutral
    case primary
}

// MARK: - Metric card (web `MetricCard`)

/// One temperature metric card (web `<MetricCard label value />`). The `value` is the localized
/// inline temperature (`21.0°C`) or the em-dash sentinel for an absent reading. `accessibilityLabel`
/// is the composed VoiceOver summary.
public struct CabinClimatePanelMetricModel: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let accessibilityLabel: String

    public init(id: String, label: String, value: String, accessibilityLabel: String) {
        self.id = id
        self.label = label
        self.value = value
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Row (web label / value rows: setpoints + HVAC state)

/// One label → value row (web `flex items-center justify-between`). The value renders as a
/// monospaced string (a localized temperature or the HVAC-state text). Strings are localized;
/// `accessibilityLabel` is the VoiceOver summary.
public struct CabinClimatePanelRowModel: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String
    public let accessibilityLabel: String

    public init(id: String, label: String, value: String, accessibilityLabel: String) {
        self.id = id
        self.label = label
        self.value = value
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Fan meter (web six-bar fan-speed indicator)

/// The fan-speed meter (web six bars of increasing width + the numeric level). `rawLevel` is the
/// web `fan_status ?? 0` rendered verbatim; `filledBars` is that value clamped to the 0...6 bar
/// range so each bar `b` (1...6) fills when `rawLevel >= b`. Strings are localized;
/// `accessibilityLabel` is the VoiceOver summary.
public struct CabinClimatePanelFanModel: Sendable, Equatable {
    public let label: String
    public let rawLevel: Int
    public let valueText: String
    public let filledBars: Int
    public let accessibilityLabel: String

    /// The number of bars the meter draws (web `[1, 2, 3, 4, 5, 6]`).
    public static let barCount = 6

    public init(label: String, rawLevel: Int, valueText: String, filledBars: Int, accessibilityLabel: String) {
        self.label = label
        self.rawLevel = rawLevel
        self.valueText = valueText
        self.filledBars = filledBars
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - System badge (web Defrost / Climate / Precondition pills)

/// One system badge (web rounded pill). `active` drives the tinted vs. muted styling; `tone` is
/// the active accent (mapped to a `Color.TS` token at the view layer) or `.neutral` when
/// inactive. `text` is the fully composed, localized label (e.g. `Defrost Off`, `Climate On`).
/// `systemImage` is the leading glyph (nil for the iconless Precondition badge in the web).
public struct CabinClimatePanelBadgeModel: Sendable, Equatable, Identifiable {
    public let id: String
    public let text: String
    public let active: Bool
    public let tone: CabinClimatePanelTone
    public let systemImage: String?
    public let accessibilityLabel: String

    public init(
        id: String,
        text: String,
        active: Bool,
        tone: CabinClimatePanelTone,
        systemImage: String?,
        accessibilityLabel: String
    ) {
        self.id = id
        self.text = text
        self.active = active
        self.tone = tone
        self.systemImage = systemImage
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Content model (web `climateData` branch projection)

/// The projected panel content (web `climateData ?` branch): the two temperature cards, the two
/// setpoint rows, the HVAC-state row, the fan meter, and the three system badges. Always built
/// from the snapshot (absent fields fall back to the em-dash / `0` / `Off` like the web); the
/// view only renders it in the `.content` phase.
public struct CabinClimatePanelContentModel: Sendable, Equatable {
    public let cabin: CabinClimatePanelMetricModel
    public let outside: CabinClimatePanelMetricModel
    public let driverSetpoint: CabinClimatePanelRowModel
    public let passengerSetpoint: CabinClimatePanelRowModel
    public let hvacState: CabinClimatePanelRowModel
    public let fan: CabinClimatePanelFanModel
    public let badges: [CabinClimatePanelBadgeModel]

    public init(
        cabin: CabinClimatePanelMetricModel,
        outside: CabinClimatePanelMetricModel,
        driverSetpoint: CabinClimatePanelRowModel,
        passengerSetpoint: CabinClimatePanelRowModel,
        hvacState: CabinClimatePanelRowModel,
        fan: CabinClimatePanelFanModel,
        badges: [CabinClimatePanelBadgeModel]
    ) {
        self.cabin = cabin
        self.outside = outside
        self.driverSetpoint = driverSetpoint
        self.passengerSetpoint = passengerSetpoint
        self.hvacState = hvacState
        self.fan = fan
        self.badges = badges
    }
}

// MARK: - Formatting sentinels

/// Non-localized formatting sentinels shared by the projection.
public enum CabinClimatePanelFormat {
    /// The em-dash shown for an absent value (web `'—'` / `DEFAULT_EMPTY_DISPLAY`).
    public static let dash = "—"
    /// The web `defrost_mode` "off" sentinel the active guard compares against.
    public static let defrostOff = "Off"
}

// MARK: - Temperature conversion + number formatting (web parity)

/// Pure °C → display converter + the `fmtNumber()` helper, reproducing the web
/// `lib/unitConversion.ts` `convertTempFromSI` / `formatTemperature` and `lib/numberFormat.ts`
/// `fmtNumber` so every platform shows identical numbers. SwiftUI-free so the math can be
/// unit-tested on a plain host (the same tradeoff the sibling `TemperatureMetricCards` makes).
public enum CabinClimatePanelMath {
    /// The em-dash the web renders for an absent / non-finite reading.
    public static let emDash = CabinClimatePanelFormat.dash

    /// The web temperature precision default (`DEFAULT_PRECISION.temperature`).
    public static let defaultTemperaturePrecision = 1

    /// Web `convertTempFromSI(celsius, to)`: Celsius passes through; Fahrenheit is `c * 9 / 5 + 32`.
    public static func convertTemperatureFromSI(
        _ celsius: Double,
        to unit: CabinClimatePanelTempUnit
    ) -> Double {
        switch unit {
        case .celsius: celsius
        case .fahrenheit: celsius * 9 / 5 + 32
        }
    }

    /// Web `fmtNumber(v, decimals, locale)`: locale-grouped formatting at a fixed number of
    /// fraction digits with the non-finite → 0 guard. Half-away-from-zero rounding mirrors
    /// `Intl.NumberFormat`'s default.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String) -> String {
        let digits = max(0, decimals)
        let safeValue = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safeValue)) ?? String(format: "%.\(digits)f", safeValue)
    }

    /// Web `formatTemperature(celsius, pref)`: `fmtNumber(convertTempFromSI(°C), digits)` with
    /// the unit symbol appended and NO space (web typographic convention). Returns the em-dash
    /// for an absent / non-finite reading (web `resolveEmpty` + `isFiniteNumber`).
    public static func temperatureInline(
        _ celsius: Double?,
        unit: CabinClimatePanelTempUnit,
        precision: Int?,
        localeIdentifier: String
    ) -> String {
        guard let celsius, celsius.isFinite else { return emDash }
        let digits = precision ?? defaultTemperaturePrecision
        let display = convertTemperatureFromSI(celsius, to: unit)
        return "\(number(display, decimals: digits, localeIdentifier: localeIdentifier))\(unit.symbol)"
    }
}
