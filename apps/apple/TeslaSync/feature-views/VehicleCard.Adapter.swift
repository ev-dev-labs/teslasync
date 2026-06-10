//
//  VehicleCard.Adapter.swift
//  TeslaSync — P4 feature view · 0302 · VehicleCard (Apple)
//
//  The pure, testable projection core for the VehicleCard surface: the web
//  `deriveVehicleStatus` (web `@/types/fsm`), the `batteryColor` thresholds (web
//  `@/lib/colors`), the `parseModelKey` model fold (web `TeslaCarViz`), the
//  `useUnits` display formatting seam, the live freshness chip, and the VoiceOver
//  summaries. No SwiftUI and no I/O — every branch the web source carries is
//  decided here so the XCTest suite can cover it without a rendering host (the
//  same approach the sibling feature views use).
//

import Foundation

// MARK: - Vehicle status (web `deriveVehicleStatus` + FSM tokens)

/// The canonical vehicle status — the port of the web `VehicleState` FSM union
/// (`online | driving | charging | parked | updating | asleep | offline`).
/// `derive` reproduces the web `deriveVehicleStatus` priority
/// (charging > driving > API state string > online fallback); `tone` maps onto
/// the shared status tokens the badge reads (web `VEHICLE_STATE_ENTRIES.variant`).
public enum VehicleStatus: String, Equatable, Sendable, CaseIterable {
    case online
    case driving
    case charging
    case parked
    case updating
    case asleep
    case offline

    /// Web `deriveVehicleStatus(state)`: no state → offline; charging flag wins;
    /// then a positive speed → driving; then a recognized FSM string; else online.
    public static func derive(_ state: VehicleCardLiveState?) -> VehicleStatus {
        guard let state else { return .offline }
        if state.isCharging { return .charging }
        if state.speedMetersPerSecond > 0 { return .driving }
        return VehicleStatus(rawValue: state.state.lowercased()) ?? .online
    }

    /// Shared status tone — web `VEHICLE_STATE_ENTRIES[state].variant`.
    public var tone: TSTone {
        switch self {
        case .online, .driving: .success
        case .charging: .warning
        case .parked, .updating: .info
        case .asleep: .neutral
        case .offline: .danger
        }
    }

    /// i18n key (web `t('vehicle.state.${state}', …)`).
    public var labelKey: String {
        "vehicle.state.\(rawValue)"
    }

    /// Web `VEHICLE_STATE_LABELS[state]` English fallback.
    public var labelFallback: String {
        switch self {
        case .online: "Online"
        case .driving: "Driving"
        case .charging: "Charging"
        case .parked: "Parked"
        case .updating: "Updating"
        case .asleep: "Asleep"
        case .offline: "Offline"
        }
    }
}

// MARK: - Battery tone (web `batteryColor` thresholds)

/// The state-of-charge tone — web `batteryColor(level)`: `> 60` good (emerald),
/// `> 25` warn (amber), else bad (red). Drives the battery ring + percent tint.
public enum BatteryTone {
    public static func forLevel(_ level: Int) -> TSTone {
        if level > 60 { return .success }
        if level > 25 { return .warning }
        return .danger
    }
}

// MARK: - Model key (web `parseModelKey`)

/// The Tesla model key — the port of the web `parseModelKey(modelStr)` fold that
/// maps a free-form `vehicle.model` string onto one of five known bodies, with the
/// same precedence and the `model3` default.
public enum TeslaModelKey: String, Equatable, Sendable, CaseIterable {
    case model3
    case models
    case modely
    case modelx
    case cybertruck

    /// Web `parseModelKey`: lowercase, strip whitespace, then match in the web
    /// order (cybertruck/ct, modelx/mx, modely/my, models/ms) with a model3 default.
    public static func parse(_ raw: String?) -> TeslaModelKey {
        guard let raw, !raw.isEmpty else { return .model3 }
        let slug = raw.lowercased().components(separatedBy: .whitespacesAndNewlines).joined()
        if slug.contains("cybertruck") || slug.contains("ct") { return .cybertruck }
        if slug.contains("modelx") || slug.contains("mx") { return .modelx }
        if slug.contains("modely") || slug.contains("my") { return .modely }
        if slug.contains("models") || slug.contains("ms") { return .models }
        return .model3
    }

    /// An SF Symbol standing in for the web `TeslaCarViz` body glyph. A single
    /// safe, always-available side profile is used for every body; the specific
    /// model is conveyed by the descriptor text + name beside the glyph.
    public var systemImage: String {
        "car.side.fill"
    }
}

// MARK: - Units formatting seam (web `useUnits` at the render boundary)

/// One odometer reading already resolved to the user's distance unit.
public struct VehicleCardOdometer: Equatable, Sendable {
    public let value: String
    public let unit: String

    public init(value: String, unit: String) {
        self.value = value
        self.unit = unit
    }
}

/// The display-unit seam (web `useUnits`): SI in, localized display strings out.
/// Production injects closures backed by the shared `Units` facade (which reads
/// the user's `UnitPreferences`); previews/tests inject the deterministic
/// `.metricPreview`. Keeping it a seam lets the projection stay pure + testable.
public struct VehicleCardUnitsFormatting: Sendable {
    public let distance: @Sendable (Double?) -> String
    public let temperature: @Sendable (Double?) -> String
    public let odometer: @Sendable (Double) -> VehicleCardOdometer
    public let power: @Sendable (Double) -> String

    public init(
        distance: @escaping @Sendable (Double?) -> String,
        temperature: @escaping @Sendable (Double?) -> String,
        odometer: @escaping @Sendable (Double) -> VehicleCardOdometer,
        power: @escaping @Sendable (Double) -> String
    ) {
        self.distance = distance
        self.temperature = temperature
        self.odometer = odometer
        self.power = power
    }

    /// Deterministic metric formatting for previews/tests (km, °C, kW). Mirrors
    /// the SI-floor `Units` engine's metric output without the KMP dependency.
    public static let metricPreview = VehicleCardUnitsFormatting(
        distance: { meters in
            guard let meters else { return "—" }
            return "\(Int((meters / 1000).rounded())) km"
        },
        temperature: { celsius in
            guard let celsius else { return "—" }
            return "\(Int(celsius.rounded()))°C"
        },
        odometer: { meters in
            VehicleCardOdometer(value: groupedInt(meters / 1000), unit: "km")
        },
        power: { watts in "\(Int((watts / 1000).rounded())) kW" }
    )

    /// Web `fmtInt` — integer with locale grouping separators.
    static func groupedInt(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value.rounded())) ?? "\(Int(value.rounded()))"
    }
}

// MARK: - Live projection (web `{state && …}` stats row)

/// The resolved stats-row values — present only when a live state exists (web
/// `{state && (...)}`). All copy is already localized / unit-formatted. Carries a
/// `TSTone` (token enum), so it is `Equatable` and MainActor-only (not `Sendable`).
public struct VehicleCardLiveProjection: Equatable {
    public let batteryLevel: Int
    public let batteryFraction: Double
    public let batteryPercentText: String
    public let batteryTone: TSTone
    public let rangeText: String
    public let interiorText: String
    public let odometerValue: String
    public let odometerUnit: String
    public let isCharging: Bool
    public let chargerPowerText: String
    public let isLocked: Bool
    public let sentryMode: Bool
}

// MARK: - Card data (the full projection the view renders)

/// The pure, `Equatable` projection of one vehicle row + its live state. Built by
/// `VehicleCardProjection`; the view renders it without further computation.
/// Carries `TSTone` values, so it is MainActor-only (`Equatable`, not `Sendable`).
public struct VehicleCardData: Equatable {
    public let vehicleID: Int64
    public let title: String
    public let descriptor: String
    public let vin: String
    public let modelKey: TeslaModelKey
    public let status: VehicleStatus
    public let statusLabel: String
    public let statusTone: TSTone
    public let vizBatteryLevel: Int
    public let live: VehicleCardLiveProjection?
}

/// Projects the cached vehicle (+ optional live state) into `VehicleCardData`.
public enum VehicleCardProjection {
    /// Builds the full card projection. `localize` is the P1/S10 `t(key, fallback)`
    /// facade; `formatting` is the `useUnits` seam. Mirrors the web composition:
    /// title (`display_name || vin`), descriptor (`model trim`), the derived
    /// status, the car-viz inputs, and the conditional stats row.
    public static func project(
        vehicle: VehicleCardVehicle,
        state: VehicleCardLiveState?,
        formatting: VehicleCardUnitsFormatting,
        localize: VehicleCardLocalizer
    ) -> VehicleCardData {
        let status = VehicleStatus.derive(state)
        return VehicleCardData(
            vehicleID: vehicle.id,
            title: title(for: vehicle),
            descriptor: descriptor(for: vehicle),
            vin: vehicle.vin,
            modelKey: TeslaModelKey.parse(vehicle.model),
            status: status,
            statusLabel: localize.string(status.labelKey, status.labelFallback),
            statusTone: status.tone,
            vizBatteryLevel: state?.batteryLevel ?? 50,
            live: state.map { projectLive($0, formatting: formatting) }
        )
    }

    /// Web `vehicle.display_name || vehicle.vin`.
    static func title(for vehicle: VehicleCardVehicle) -> String {
        vehicle.displayName.isEmpty ? vehicle.vin : vehicle.displayName
    }

    /// Web `{vehicle.model} {vehicle.trim_badging}` (the VIN is rendered mono and
    /// separately by the view), collapsed to a single spaced, trimmed string.
    static func descriptor(for vehicle: VehicleCardVehicle) -> String {
        [vehicle.model, vehicle.trimBadging]
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// Web `{state && (...)}` stats row projection.
    static func projectLive(
        _ state: VehicleCardLiveState,
        formatting: VehicleCardUnitsFormatting
    ) -> VehicleCardLiveProjection {
        let level = state.batteryLevel
        let odometer = formatting.odometer(state.odometerMeters)
        return VehicleCardLiveProjection(
            batteryLevel: level,
            batteryFraction: min(max(Double(level) / 100, 0), 1),
            batteryPercentText: "\(level)%",
            batteryTone: BatteryTone.forLevel(level),
            rangeText: formatting.distance(state.ratedRangeMeters),
            interiorText: formatting.temperature(state.insideTempCelsius),
            odometerValue: odometer.value,
            odometerUnit: odometer.unit,
            isCharging: state.isCharging,
            chargerPowerText: formatting.power(state.chargerPowerWatts),
            isLocked: state.isLocked,
            sentryMode: state.sentryMode
        )
    }
}

// MARK: - Freshness chip (live / stale / offline)

/// The live-stream freshness chip — `live` shows nothing (the card is current),
/// `stale`/`offline` surface a static chip so the row never implies fresher data
/// than the stream can prove. Satisfies the P4 stale/offline state requirement.
public enum VehicleCardFreshnessChip: Equatable, Sendable {
    case stale
    case offline

    public static func project(_ connection: VehicleCardConnection) -> VehicleCardFreshnessChip? {
        switch connection {
        case .live: nil
        case .stale: .stale
        case .offline: .offline
        }
    }

    public var labelKey: String {
        switch self {
        case .stale: "card.freshness.stale"
        case .offline: "card.freshness.offline"
        }
    }

    public var labelFallback: String {
        switch self {
        case .stale: "Stale"
        case .offline: "Offline"
        }
    }

    public var systemImage: String {
        switch self {
        case .stale: "clock.arrow.circlepath"
        case .offline: "wifi.slash"
        }
    }

    public var tone: TSTone {
        switch self {
        case .stale: .warning
        case .offline: .neutral
        }
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Pure VoiceOver string builders so the card announces as coherent elements and
/// the tests can assert label presence without a rendering host.
public enum VehicleCardAccessibility {
    /// The card summary: name, status, and (when present) battery + range — the
    /// salient facts a screen-reader user needs from the row.
    public static func cardLabel(for data: VehicleCardData, localize: VehicleCardLocalizer) -> String {
        var parts = [data.title, data.statusLabel]
        if let live = data.live {
            parts.append("\(localize.string("card.battery", "Battery")) \(live.batteryPercentText)")
            parts.append("\(localize.string("card.range", "Range")) \(live.rangeText)")
        }
        return parts.joined(separator: ", ")
    }

    /// Web `title={t('card.viewDetails', 'View details')}` on the details link.
    public static func viewDetailsLabel(_ localize: VehicleCardLocalizer) -> String {
        localize.string("card.viewDetails", "View details")
    }

    /// Web `title={t('card.removeVehicle', 'Remove vehicle')}` on the delete button.
    public static func removeLabel(_ localize: VehicleCardLocalizer) -> String {
        localize.string("card.removeVehicle", "Remove vehicle")
    }
}
