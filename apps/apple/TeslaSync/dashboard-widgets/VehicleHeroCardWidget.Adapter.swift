//
//  VehicleHeroCardWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0107 · VehicleHeroCardWidget (Apple)
//
//  Pure (Foundation-only) projection: the selected vehicle + a cached `VehicleHeroStateDTO` +
//  `VehicleHeroUnitPrefs` → render-ready display strings + semantic tones, reproducing the web
//  source's numeric + formatting pipeline VERBATIM so the native surface shows the exact same
//  values as features/dashboard/widgets/VehicleHeroCardWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting + layout logic can be
//  compiled and executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Responsive layout (web `isCompact` / `isWide` / `isTall`)

/// The responsive layout the surface renders for a grid footprint, mirroring the web flags in
/// `VehicleHeroCardWidget.tsx`: `isCompact = cols <= 1 && rows <= 1`, `isWide = cols >= 3`,
/// `isTall = rows >= 2`. Pure + `Equatable` so each branch is unit-tested without SwiftUI.
public enum VehicleHeroLayout: Equatable, Sendable {
    /// 1×1 — status badge over the battery percent over the vehicle name, centered.
    case compact
    /// Default — name + status header, model/trim subtitle, metric grid; `isWide` adds the
    /// outside-temp cell inline, `isTall` (and not wide) adds the outside + ideal bottom row.
    case full(isWide: Bool, isTall: Bool)

    /// Resolves the layout for a grid size, matching the web flag arithmetic exactly.
    public static func resolve(cols: Int, rows: Int) -> VehicleHeroLayout {
        if cols <= 1, rows <= 1 {
            return .compact
        }
        return .full(isWide: cols >= 3, isTall: rows >= 2)
    }
}

// MARK: - Semantic tones (web Tailwind color → platform token, resolved in the view)

/// The battery readout tone, mirroring the web `batteryColor` memo: no state → muted, `> 50` →
/// success, `> 20` → warning, else danger. The view maps each case to a `Color.TS` token.
public enum VehicleHeroBatteryTone: Equatable, Sendable {
    case success
    case warning
    case danger
    case muted
}

/// The status-badge dot tone, mirroring the resolved `badgeDot` of the web vehicle FSM theme
/// (types/fsm/vehicle.ts + theme.ts). The view maps each case to a `Color.TS` token.
public enum VehicleHeroStatusTone: Equatable, Sendable {
    case success // online   (green)
    case info // driving / updating (blue)
    case warning // charging (amber/yellow)
    case accent // parked   (cyan)
    case neutral // asleep / unknown (muted)
    case danger // offline  (red)
}

/// The resolved display style for a vehicle state: the localized label key, its English fallback,
/// and the status-dot tone. Used instead of a bare tuple so the mapping reads clearly and stays
/// within the lint's tuple-arity budget.
public struct VehicleHeroStatusStyle: Equatable, Sendable {
    public let key: String
    public let fallback: String
    public let tone: VehicleHeroStatusTone

    public init(key: String, fallback: String, tone: VehicleHeroStatusTone) {
        self.key = key
        self.fallback = fallback
        self.tone = tone
    }
}

/// Classifies a raw vehicle state string into its display label + dot tone, reproducing the web
/// vehicle FSM theme. Pure + public so the mapping is unit-tested without rendering.
public enum VehicleHeroStatus {
    /// The localized label key, English fallback, and dot tone for a raw state string. Unknown
    /// states fall back to the title-cased raw value (web `capitalize`) with a neutral dot.
    public static func classify(_ raw: String) -> VehicleHeroStatusStyle {
        switch raw.lowercased() {
        case "online": VehicleHeroStatusStyle(key: "vehicle.state.online", fallback: "Online", tone: .success)
        case "driving": VehicleHeroStatusStyle(key: "vehicle.state.driving", fallback: "Driving", tone: .info)
        case "charging": VehicleHeroStatusStyle(key: "vehicle.state.charging", fallback: "Charging", tone: .warning)
        case "parked": VehicleHeroStatusStyle(key: "vehicle.state.parked", fallback: "Parked", tone: .accent)
        case "updating": VehicleHeroStatusStyle(key: "vehicle.state.updating", fallback: "Updating", tone: .info)
        case "asleep": VehicleHeroStatusStyle(key: "vehicle.state.asleep", fallback: "Asleep", tone: .neutral)
        case "offline": VehicleHeroStatusStyle(key: "vehicle.state.offline", fallback: "Offline", tone: .danger)
        default: VehicleHeroStatusStyle(key: "", fallback: raw.capitalized, tone: .neutral)
        }
    }
}

// MARK: - Distance + temperature conversion (ported 1:1 from web lib/unitConversion.ts)

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` — a divide by the
/// unit's metres-per-unit factor. The web widget feeds it `state.ideal_range`, which arrives in
/// METERS (the SI-floor noted in the source), so this is a straight SI → display conversion.
/// Non-finite inputs collapse to 0 to match the web `safeNumber` guard upstream.
func vehicleHeroConvertDistanceFromSI(_ meters: Double, to unit: VehicleHeroDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

/// Temperature converter ported 1:1 from `convertTempFromSI(celsius, to)`: identity for °C and
/// the `c * 9/5 + 32` affine map for °F. Non-finite inputs collapse to 0.
func vehicleHeroConvertTempFromSI(_ celsius: Double, to unit: VehicleHeroTemperatureUnit) -> Double {
    let safe = celsius.isFinite ? celsius : 0
    switch unit {
    case .celsius: return safe
    case .fahrenheit: return (safe * 9) / 5 + 32
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber` / `fmtInt`)

/// Locale-aware decimal formatting that mirrors the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half away from
/// zero to match `Intl.NumberFormat`'s default `halfExpand`.
public enum VehicleHeroFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
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

    /// `fmtInt(v)` — grouped integer (web `fmtNumber(v, 0)`), used for the range readout.
    public static func int(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Projection

/// The fully-projected widget content: every display string + semantic tone the compact and full
/// layouts read. Computed once per snapshot by the model so the view stays declarative. The em
/// dash (`—`) for missing values mirrors the web `'—'` fallbacks 1:1.
public struct VehicleHeroProjection: Equatable {
    public let name: String
    public let subtitle: String

    public let statusLabelKey: String
    public let statusLabelFallback: String
    public let statusTone: VehicleHeroStatusTone

    public let batteryLevel: Int?
    public let batteryText: String
    public let batteryTone: VehicleHeroBatteryTone

    public let rangeText: String
    public let idealText: String
    public let cabinText: String
    public let outsideText: String

    public let isCharging: Bool
    public let chargingPowerText: String?

    public let distanceSymbol: String
    public let temperatureSymbol: String

    /// The em-dash used for every missing value, matching the web `'—'`.
    public static let emDash = "—"

    /// The resolved (localized) status label. Unknown states carry an empty key and fall back to
    /// the title-cased raw string the projector stored.
    public var statusLabel: String {
        statusLabelKey.isEmpty
            ? statusLabelFallback
            : VehicleHeroStrings.string(statusLabelKey, statusLabelFallback)
    }
}

/// Pure projector: vehicle + optional cached state + unit prefs → `VehicleHeroProjection`. Every
/// value is computed with the exact same arithmetic + formatting as the web widget.
public enum VehicleHeroProjector {
    /// Resolves the shown name as `display_name || vin` (web JS `||`: an empty display name falls
    /// through to the VIN).
    public static func resolveName(displayName: String, vin: String) -> String {
        displayName.isEmpty ? vin : displayName
    }

    /// Resolves the subtitle as `model[ trim]` (web `${model}${trim ? ` ${trim}` : ''}`).
    public static func resolveSubtitle(model: String, trimBadging: String) -> String {
        trimBadging.isEmpty ? model : "\(model) \(trimBadging)"
    }

    public static func project(
        vehicle: VehicleHeroVehicleDTO,
        state: VehicleHeroStateDTO?,
        units: VehicleHeroUnitPrefs
    ) -> VehicleHeroProjection {
        let locale = units.localeIdentifier
        let distanceSymbol = units.distance.symbol
        let temperatureSymbol = units.temperature.symbol
        let dash = VehicleHeroProjection.emDash

        // Status — web `state?.state ?? 'offline'`.
        let statusRaw = state?.statusRaw ?? "offline"
        let status = VehicleHeroStatus.classify(statusRaw)

        // Battery — web `batteryColor` memo + `state?.battery_level ?? null`.
        let batteryLevel = state != nil ? state?.batteryLevel : nil
        let batteryTone = batteryToneFor(state: state)
        let batteryText = batteryLevel.map { "\($0)%" } ?? dash

        // Range / ideal — web `range = state ? round(convertDistanceFromSI(ideal_range ?? 0)) : null`.
        let rangeText: String
        if let state {
            let meters = state.idealRangeMeters ?? 0
            let converted = vehicleHeroConvertDistanceFromSI(meters, to: units.distance).rounded()
            rangeText = "\(VehicleHeroFormat.int(converted, localeIdentifier: locale)) \(distanceSymbol)"
        } else {
            rangeText = dash
        }

        // Cabin / outside temp — web `temp != null ? `${round(convertTempFromSI(c))}${unit}` : '—'`.
        let cabinText = temperatureText(
            celsius: state?.insideTempCelsius, unit: units.temperature, symbol: temperatureSymbol, dash: dash
        )
        let outsideText = temperatureText(
            celsius: state?.outsideTempCelsius, unit: units.temperature, symbol: temperatureSymbol, dash: dash
        )

        // Charging — banner driven by is_charging; power suffix only when `chargerPower > 0`.
        let isCharging = state?.isCharging ?? false
        let chargingPowerText = chargingPowerSuffix(state: state, localeIdentifier: locale)

        return VehicleHeroProjection(
            name: resolveName(displayName: vehicle.displayName, vin: vehicle.vin),
            subtitle: resolveSubtitle(model: vehicle.model, trimBadging: vehicle.trimBadging),
            statusLabelKey: status.key,
            statusLabelFallback: status.fallback,
            statusTone: status.tone,
            batteryLevel: batteryLevel,
            batteryText: batteryText,
            batteryTone: batteryTone,
            rangeText: rangeText,
            idealText: rangeText,
            cabinText: cabinText,
            outsideText: outsideText,
            isCharging: isCharging,
            chargingPowerText: chargingPowerText,
            distanceSymbol: distanceSymbol,
            temperatureSymbol: temperatureSymbol
        )
    }

    /// Web `batteryColor`: no state → muted; `> 50` → success; `> 20` → warning; else danger.
    private static func batteryToneFor(state: VehicleHeroStateDTO?) -> VehicleHeroBatteryTone {
        guard let level = state?.batteryLevel else { return .muted }
        if level > 50 { return .success }
        if level > 20 { return .warning }
        return .danger
    }

    private static func temperatureText(
        celsius: Double?,
        unit: VehicleHeroTemperatureUnit,
        symbol: String,
        dash: String
    ) -> String {
        guard let celsius else { return dash }
        let rounded = Int(vehicleHeroConvertTempFromSI(celsius, to: unit).rounded())
        return "\(rounded)\(symbol)"
    }

    private static func chargingPowerSuffix(state: VehicleHeroStateDTO?, localeIdentifier: String) -> String? {
        guard let power = state?.chargerPowerKilowatts, power > 0 else { return nil }
        return "\(VehicleHeroFormat.number(power, decimals: 1, localeIdentifier: localeIdentifier)) kW"
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the card. Pure + public so the a11y label content can
/// be unit-tested without rendering the view.
public enum VehicleHeroAccessibility {
    /// One spoken clause per readout, e.g.
    /// "Tesla. Online. Battery 84%. Range 450 km. Cabin 21°C".
    public static func summary(for projection: VehicleHeroProjection) -> String {
        var parts = [projection.name, projection.statusLabel]
        parts.append("\(label("widget.battery", "Battery")) \(projection.batteryText)")
        parts.append("\(label("widget.range", "Range")) \(projection.rangeText)")
        parts.append("\(label("widget.cabin", "Cabin")) \(projection.cabinText)")
        parts.append("\(label("widget.outside", "Outside")) \(projection.outsideText)")
        if projection.isCharging {
            let charging = label("widget.charging", "Charging")
            parts.append(projection.chargingPowerText.map { "\(charging) \($0)" } ?? charging)
        }
        return parts.joined(separator: ". ")
    }

    private static func label(_ key: String, _ fallback: String) -> String {
        VehicleHeroStrings.string(key, fallback)
    }
}
