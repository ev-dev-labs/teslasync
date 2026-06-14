//
//  WatchSummaryWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0114 · WatchSummaryWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `WatchSummaryDTO` + `WatchSummaryUnitPrefs` → the
//  display strings + semantic tones the SwiftUI surface renders, reproducing the web source's
//  pipeline VERBATIM (features/dashboard/widgets/WatchSummaryWidget.tsx). SwiftUI-free so the
//  conversion + formatting + tone selection can be compiled, executed and unit-tested on a host.
//

import Foundation

// MARK: - Semantic tone (web BadgeVariant / status color → native token selector)

/// A semantic colour role the view maps onto the design tokens (`Color.TS.status*`). Mirrors the
/// web `BadgeVariant` set so the adapter can choose colours without importing SwiftUI.
public enum WatchTone: Sendable, Equatable {
    case success
    case warning
    case danger
    case info
    case neutral
}

/// The battery colour band, ported 1:1 from the web `getBatteryColor(level)` thresholds
/// (`> 50` green · `> 20` amber · else red) plus the `level == null` grey track the web uses
/// (`batteryLevel != null ? getBatteryColor(...) : '#374151'`).
public enum WatchBatteryTone: Sendable, Equatable {
    case good
    case warning
    case critical
    case unknown

    /// Ports the web `getBatteryColor` band selection (and the null → grey track fallback).
    public static func forLevel(_ level: Double?) -> WatchBatteryTone {
        guard let level, level.isFinite else { return .unknown }
        if level > 50 { return .good }
        if level > 20 { return .warning }
        return .critical
    }
}

// MARK: - Unit conversion (ported 1:1 from lib/unitConversion.ts)

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in lib/unitConversion.ts
/// — a divide by the unit's metres-per-unit factor. Non-finite inputs collapse to 0 (the web feeds
/// `rangeKm * 1000` and `fmtNumber` then applies `safeNumber`, so the rendered value is identical).
func convertWatchDistanceFromSI(_ meters: Double, to unit: WatchDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

/// Temperature converter ported 1:1 from `convertTempFromSI(celsius, to)` in lib/unitConversion.ts:
/// `°C` passes through, `°F` is `c * 9 / 5 + 32`. Non-finite inputs collapse to 0.
func convertWatchTempFromSI(_ celsius: Double, to unit: WatchTemperatureUnit) -> Double {
    let safe = celsius.isFinite ? celsius : 0
    switch unit {
    case .celsius: return safe
    case .fahrenheit: return safe * 9 / 5 + 32
    }
}

// MARK: - Number / date formatting (ported from lib/numberFormat.ts + the web TimeStamp)

/// Locale-aware number + relative-date formatting that mirrors the web `fmtNumber`
/// (`Intl.NumberFormat`) and the `TimeStamp` relative rendering.
public enum WatchSummaryFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Intl.NumberFormat`'s default `halfExpand`.
    public static func number(
        _ value: Double,
        decimals: Int,
        localeIdentifier: String = "en_US"
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// `fmtNumber(v, 0)` — the integer formatting the web uses for the gauge centre, the range and
    /// the cabin temperature (`AnimatedNumber` defaults to 0 decimals).
    public static func integer(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// CSS `text-transform: capitalize` parity — upper-cases the first character of each
    /// whitespace-separated word, leaving the rest untouched (the web `StatusBadge` renders the
    /// raw `status` string with `capitalize`).
    public static func cssCapitalize(_ value: String) -> String {
        value
            .split(separator: " ", omittingEmptySubsequences: false)
            .map { word in
                guard let first = word.first else { return String(word) }
                return first.uppercased() + word.dropFirst()
            }
            .joined(separator: " ")
    }

    /// Relative "last seen" string, the native parity of the web `TimeStamp` relative body via
    /// Foundation's localized `RelativeDateTimeFormatter`. A missing/invalid date renders the
    /// universal em-dash placeholder (the web `TimeStamp` `value == null` branch). `now` is // parity:allow ui
    /// injectable so the nil / non-nil branches are deterministically testable.
    public static func relativeLastSeen(
        _ date: Date?,
        now: Date = Date(),
        localeIdentifier: String = "en_US"
    ) -> String {
        guard let date, date.timeIntervalSince1970.isFinite else { return "—" }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Vehicle state → display label + tones (ported from types/fsm/vehicle.ts + the widget)

/// The vehicle-state projection the surface renders: the raw string (for the standard
/// `WidgetBigNumber` badge text), the capitalized compact-pill label, and the two semantic tones
/// the web derives in two different places.
public struct WatchStateView: Equatable {
    /// The raw API state string — what the web standard badge shows (`badge.text = state`).
    public let raw: String
    /// `capitalize(state)` — what the web compact `StatusBadge` shows.
    public let compactLabel: String
    /// The compact `StatusBadge` dot tone (ported from the vehicle FSM `badgeDot` mapping).
    public let compactTone: WatchTone
    /// The standard `WidgetBigNumber` badge tone — the web inline ternary
    /// (`online → success · asleep → neutral · else → warning`).
    public let badgeTone: WatchTone

    public init(raw: String, compactLabel: String, compactTone: WatchTone, badgeTone: WatchTone) {
        self.raw = raw
        self.compactLabel = compactLabel
        self.compactTone = compactTone
        self.badgeTone = badgeTone
    }

    /// Builds the state projection from a raw state string, or `nil` when the web `state &&` guard
    /// is falsy (missing or empty string → no badge/pill is shown).
    public static func make(from rawState: String?) -> WatchStateView? {
        guard let rawState, !rawState.isEmpty else { return nil }
        return WatchStateView(
            raw: rawState,
            compactLabel: WatchSummaryFormat.cssCapitalize(rawState),
            compactTone: compactTone(for: rawState),
            badgeTone: badgeTone(for: rawState)
        )
    }

    /// The vehicle FSM `badgeDot` tone (types/fsm/vehicle.ts `VEHICLE_STATE_ENTRIES`), mapped onto
    /// the native token palette: online → success · driving/parked/updating → info · charging →
    /// warning · asleep/unknown → neutral · offline → danger.
    static func compactTone(for rawState: String) -> WatchTone {
        switch rawState.lowercased() {
        case "online": .success
        case "driving", "parked", "updating": .info
        case "charging": .warning
        case "asleep": .neutral
        case "offline": .danger
        default: .neutral
        }
    }

    /// The standard-view badge tone — the web `WatchSummaryWidget` inline ternary verbatim
    /// (`state === 'online' ? 'success' : state === 'asleep' ? 'neutral' : 'warning'`).
    static func badgeTone(for rawState: String) -> WatchTone {
        switch rawState.lowercased() {
        case "online": .success
        case "asleep": .neutral
        default: .warning
        }
    }
}

// MARK: - Lock status (web `is_locked` → Locked / Unlocked / unknown)

/// The door-lock projection — the web renders the `Lock`/`Unlock` glyph + a `Locked`/`Unlocked`
/// badge when `is_locked != null`, and the em-dash placeholder when it is null. // parity:allow ui
public enum WatchLockState: Sendable, Equatable {
    case locked
    case unlocked
    case unknown

    public static func from(_ isLocked: Bool?) -> WatchLockState {
        guard let isLocked else { return .unknown }
        return isLocked ? .locked : .unlocked
    }
}

// MARK: - Projection (the web body, fully derived)

/// The fully-projected widget content: every display string + tone the SwiftUI surface needs for
/// both the compact watch-face layout and the standard grid. Computed by the model/view from the
/// cached summary + prefs, mirroring the web `useMemo` derives.
public struct WatchSummaryProjection: Equatable {
    /// Whether a summary exists at all (`hasData = summary != null`); false → "No watch data".
    public let hasData: Bool
    /// Raw battery percent (0–100), or nil. Drives the gauge value (`battery ?? 0`) + colour band.
    public let batteryLevel: Double?
    /// The gauge value, clamped to a finite `battery ?? 0` (web `value={batteryLevel ?? 0}`).
    public let batteryValue: Double
    /// The gauge centre text — `fmtNumber(battery ?? 0, 0)` (web RadialGauge, decimals 0).
    public let batteryText: String
    /// The standard hero text — `fmtNumber(battery, 0)` or the em-dash when battery is null (web
    /// `WidgetBigNumber` `nullDisplay`), differing from the compact gauge's `?? 0` zero-fill.
    public let batteryBigText: String
    /// The battery colour band (web `getBatteryColor` + null grey).
    public let batteryTone: WatchBatteryTone
    /// The vehicle-state projection (label + tones), or nil when the web `state &&` guard is falsy.
    public let state: WatchStateView?
    /// The converted range in the user's distance unit, or nil when `range_km` is null.
    public let rangeDisplay: Double?
    /// The range text — `fmtNumber(displayRange, 0)` or the em-dash placeholder. // parity:allow ui
    public let rangeText: String
    /// The distance unit symbol (`km` / `mi` / `ft`).
    public let rangeUnit: String
    /// The lock projection (`Locked` / `Unlocked` / unknown).
    public let lock: WatchLockState
    /// The converted cabin temperature in the user's unit, or nil when `inside_temp_c` is null.
    public let cabinDisplay: Double?
    /// The cabin temperature text — `fmtNumber(displayTemp, 0)` or the em-dash placeholder. // parity:allow ui
    public let cabinText: String
    /// The temperature unit symbol (`°C` / `°F`).
    public let cabinUnit: String
    /// The "last seen" relative text, or the em-dash placeholder. // parity:allow ui
    public let lastSeenText: String
    /// Whether the compact "⚡ Charging" indicator is shown (complication `charging`).
    public let charging: Bool

    public init(
        hasData: Bool,
        batteryLevel: Double?,
        batteryValue: Double,
        batteryText: String,
        batteryBigText: String,
        batteryTone: WatchBatteryTone,
        state: WatchStateView?,
        rangeDisplay: Double?,
        rangeText: String,
        rangeUnit: String,
        lock: WatchLockState,
        cabinDisplay: Double?,
        cabinText: String,
        cabinUnit: String,
        lastSeenText: String,
        charging: Bool
    ) {
        self.hasData = hasData
        self.batteryLevel = batteryLevel
        self.batteryValue = batteryValue
        self.batteryText = batteryText
        self.batteryBigText = batteryBigText
        self.batteryTone = batteryTone
        self.state = state
        self.rangeDisplay = rangeDisplay
        self.rangeText = rangeText
        self.rangeUnit = rangeUnit
        self.lock = lock
        self.cabinDisplay = cabinDisplay
        self.cabinText = cabinText
        self.cabinUnit = cabinUnit
        self.lastSeenText = lastSeenText
        self.charging = charging
    }

    /// The em-dash placeholder the web uses for every missing value (`—`). // parity:allow ui
    public static let placeholder = "—" // parity:allow ui
}

/// Pure projector: `WatchSummaryDTO?` + `WatchSummaryUnitPrefs` → `WatchSummaryProjection`. Every
/// value is computed with the exact same arithmetic + formatting as the web widget.
public enum WatchSummaryProjector {
    /// Projects the cached summary into the surface's display fields. A nil summary yields the
    /// `hasData == false` projection that drives the "No watch data" empty state.
    public static func project(
        summary: WatchSummaryDTO?,
        units: WatchSummaryUnitPrefs,
        now: Date = Date()
    ) -> WatchSummaryProjection {
        let locale = units.localeIdentifier
        // Battery: value = batteryLevel ?? 0 ; centre = fmtNumber(value, 0) ; colour band.
        let battery = summary?.batteryLevel
        let batteryValue = WatchSummaryFormat.safeNumber(battery ?? 0)
        let batteryText = WatchSummaryFormat.integer(batteryValue, localeIdentifier: locale)
        let batteryBigText = battery
            .map { WatchSummaryFormat.integer($0, localeIdentifier: locale) }
            ?? WatchSummaryProjection.placeholder // parity:allow ui
        let batteryTone = WatchBatteryTone.forLevel(battery)
        // Range: displayRange = convertDistanceFromSI(range_km * 1000, unit) ; fmtNumber(·, 0).
        let rangeDisplay: Double? = summary?.rangeKm.map {
            convertWatchDistanceFromSI($0 * 1000, to: units.distance)
        }
        let rangeText = rangeDisplay
            .map { WatchSummaryFormat.integer($0, localeIdentifier: locale) }
            ?? WatchSummaryProjection.placeholder // parity:allow ui

        // Cabin temp: displayTemp = convertTempFromSI(inside_temp_c, unit) ; fmtNumber(·, 0).
        let cabinDisplay: Double? = summary?.insideTempC.map {
            convertWatchTempFromSI($0, to: units.temperature)
        }
        let cabinText = cabinDisplay
            .map { WatchSummaryFormat.integer($0, localeIdentifier: locale) }
            ?? WatchSummaryProjection.placeholder // parity:allow ui

        let lastSeenText = WatchSummaryFormat.relativeLastSeen(
            summary?.lastUpdated,
            now: now,
            localeIdentifier: locale
        )

        return WatchSummaryProjection(
            hasData: summary != nil,
            batteryLevel: battery,
            batteryValue: batteryValue,
            batteryText: batteryText,
            batteryBigText: batteryBigText,
            batteryTone: batteryTone,
            state: WatchStateView.make(from: summary?.state),
            rangeDisplay: rangeDisplay,
            rangeText: rangeText,
            rangeUnit: units.distance.symbol,
            lock: WatchLockState.from(summary?.isLocked),
            cabinDisplay: cabinDisplay,
            cabinText: cabinText,
            cabinUnit: units.temperature.symbol,
            lastSeenText: lastSeenText,
            charging: summary?.charging ?? false
        )
    }
}

// MARK: - Layout (web `size` → isCompact)

/// The web responsive sizing, ported verbatim: `isCompact = size.cols <= 1`. Pure + public so the
/// breakpoint can be unit-tested without rendering.
public enum WatchSummaryLayout {
    /// `true` for the single-column watch-face layout (web `isCompact`).
    public static func isCompact(cols: Int) -> Bool {
        cols <= 1
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver content for the surface. Pure + public so the a11y content can be
/// unit-tested without rendering the view.
public enum WatchSummaryAccessibility {
    /// One spoken sentence summarising the glance, e.g.
    /// "Battery 82%, Online, Range 120 mi, Locked, Cabin 21 °C, Last Seen 2 min ago". Built from
    /// the already-projected fields so the display set stays the single source of truth.
    public static func summary(for projection: WatchSummaryProjection) -> String {
        guard projection.hasData else {
            return WatchSummaryStrings.string("widget.noWatchData", "No watch data")
        }
        var parts: [String] = []

        let batteryWord = WatchSummaryStrings.string("widget.battery", "Battery")
        parts.append("\(batteryWord) \(projection.batteryText)%")

        if let state = projection.state {
            parts.append(state.compactLabel)
        }

        let rangeWord = WatchSummaryStrings.string("widget.range", "Range")
        parts.append("\(rangeWord) \(projection.rangeText) \(projection.rangeUnit)")

        switch projection.lock {
        case .locked:
            parts.append(WatchSummaryStrings.string("widget.locked", "Locked"))
        case .unlocked:
            parts.append(WatchSummaryStrings.string("widget.unlocked", "Unlocked"))
        case .unknown:
            break
        }

        let cabinWord = WatchSummaryStrings.string("widget.cabinTemp", "Cabin")
        parts.append("\(cabinWord) \(projection.cabinText) \(projection.cabinUnit)")

        let lastSeenWord = WatchSummaryStrings.string("widget.lastSeen", "Last Seen")
        parts.append("\(lastSeenWord) \(projection.lastSeenText)")

        if projection.charging {
            parts.append(WatchSummaryStrings.string("widget.charging", "Charging"))
        }

        return parts.joined(separator: ", ")
    }
}
