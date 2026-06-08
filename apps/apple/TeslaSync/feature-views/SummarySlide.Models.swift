//
//  SummarySlide.Models.swift
//  TeslaSync — P4 feature view · 0069 · SummarySlide (Apple)
//
//  Domain value types ported from the web source's data contract
//  (web/src/api/types.ts `YearReview` — the headline subset the slide reads) plus
//  the snake-case decode adapter the production source projects cached DTOs through
//  and the distance SI→display converter ported 1:1 from
//  web/src/lib/unitConversion.ts `convertDistanceFromSI`. Pure Foundation — no
//  SwiftUI, no Shared xcframework — so the file host-compiles and the
//  cached→projection adapter is unit-testable in isolation.
//

import Foundation

// MARK: - Distance display unit (web `DistanceUnitPref`)

/// The distance unit the user's `useUnits().unitPrefs.distance` resolves to, kept
/// Shared-free (the production app maps the facade `UnitPreferences.distance`
/// label onto this). `km`/`mi`/`ft` match the web `DistanceUnitPref` union.
public enum DistanceDisplayUnit: String, Equatable, Sendable, CaseIterable {
    case kilometers
    case miles
    case feet

    /// Builds the unit from the web SI label (`"km"`/`"mi"`/`"ft"`); anything else
    /// falls back to kilometers (the SI default).
    public init(label: String) {
        switch label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "mi", "mile", "miles": self = .miles
        case "ft", "foot", "feet": self = .feet
        default: self = .kilometers
        }
    }

    /// The short label shown verbatim as the distance stat's caption (web renders
    /// `unitPrefs.distance` directly).
    public var label: String {
        switch self {
        case .kilometers: "km"
        case .miles: "mi"
        case .feet: "ft"
        }
    }

    /// Exact metres-per-unit divisor (NIST-grade), matching the web lib constants
    /// `METERS_PER_KM` / `METERS_PER_MILE` / `METERS_PER_FOOT`.
    public var metersPerUnit: Double {
        switch self {
        case .kilometers: 1000
        case .miles: 1609.344
        case .feet: 0.3048
        }
    }
}

// MARK: - Distance conversion (web `convertDistanceFromSI`)

/// SI→display distance math, a 1:1 port of `convertDistanceFromSI(meters, to)`
/// (lib/unitConversion.ts): a divide by the unit's metres-per-unit. Namespaced
/// (not a free function) to avoid colliding with the per-widget ports and to keep
/// it unit-testable without rendering the view.
public enum SummaryUnitMath {
    public static func convertDistanceFromSI(_ meters: Double, to unit: DistanceDisplayUnit) -> Double {
        meters / unit.metersPerUnit
    }
}

// MARK: - Stat kind (web `stats[]` rows)

/// The five headline stats the web `SummarySlide` lists, in render order. Carries
/// the SF Symbol that stands in for the web Lucide glyph (decorative — VoiceOver
/// reads the value + label, the icon is hidden).
public enum SummaryStatKind: String, CaseIterable, Sendable {
    case drives
    case distance
    case energy
    case charges
    case co2

    /// SF Symbol mapped from the web Lucide icon: Car→car, distance→road,
    /// Zap→bolt, Plug→powerplug, Leaf→leaf.
    public var iconSystemName: String {
        switch self {
        case .drives: "car.fill"
        case .distance: "road.lanes"
        case .energy: "bolt.fill"
        case .charges: "powerplug.fill"
        case .co2: "leaf.fill"
        }
    }
}

// MARK: - Vehicle (web `YearReview.vehicle`)

/// The vehicle identity shown in the card header (web `data.vehicle`).
public struct YearReviewVehicle: Equatable, Sendable {
    public let id: Int
    public let displayName: String
    public let model: String

    public init(id: Int, displayName: String = "", model: String = "") {
        self.id = id
        self.displayName = displayName
        self.model = model
    }
}

// MARK: - Year review summary (web `YearReview` headline subset)

/// The headline slice of the web `YearReview` the SummarySlide renders. Distance /
/// energy / CO₂ stay in their derived-SI wire units (km / kWh / kg) exactly as the
/// API surfaces them; the projection converts distance to the display unit at the
/// render boundary (web `convertDistanceFromSI(total_distance_km * 1000, unit)`).
public struct YearReviewSummary: Equatable, Sendable {
    public let year: Int
    public let vehicle: YearReviewVehicle
    public let totalDrives: Int
    /// Total distance in kilometres (derived SI), web `total_distance_km`.
    public let totalDistanceKm: Double
    /// Total energy in kilowatt-hours (derived SI), web `total_energy_kwh`.
    public let totalEnergyKwh: Double
    public let totalChargeSessions: Int
    /// CO₂ offset in kilograms (SI), web `co2_offset_kg`.
    public let co2OffsetKg: Double
    /// Modelled gas savings in the user's currency, web `gas_savings`.
    public let gasSavings: Double

    public init(
        year: Int,
        vehicle: YearReviewVehicle,
        totalDrives: Int = 0,
        totalDistanceKm: Double = 0,
        totalEnergyKwh: Double = 0,
        totalChargeSessions: Int = 0,
        co2OffsetKg: Double = 0,
        gasSavings: Double = 0
    ) {
        self.year = year
        self.vehicle = vehicle
        self.totalDrives = totalDrives
        self.totalDistanceKm = totalDistanceKm
        self.totalEnergyKwh = totalEnergyKwh
        self.totalChargeSessions = totalChargeSessions
        self.co2OffsetKg = co2OffsetKg
        self.gasSavings = gasSavings
    }

    /// True when the review carries no activity at all — drives the friendly empty
    /// state (a resolved review with nothing to celebrate, never a blank card).
    public var isEmpty: Bool {
        totalDrives == 0
            && totalChargeSessions == 0
            && totalDistanceKm == 0
            && totalEnergyKwh == 0
    }
}

// MARK: - Decode adapter (snake-case DTO → value types)

public extension YearReviewSummary {
    private struct VehicleDTO: Decodable {
        let id: Int?
        let displayName: String?
        let model: String?
    }

    private struct DTO: Decodable {
        let year: Int?
        let vehicle: VehicleDTO?
        let totalDrives: Int?
        let totalDistanceKm: Double?
        let totalEnergyKwh: Double?
        let totalChargeSessions: Int?
        let co2OffsetKg: Double?
        let gasSavings: Double?
    }

    /// Decodes one `/analytics/year-review` object (snake-case JSON). Returns `nil`
    /// only when the JSON is unparseable; missing numeric fields default to zero so
    /// a partial payload degrades to the empty state rather than dropping the card.
    static func decode(fromJSONString json: String) -> YearReviewSummary? {
        guard let data = json.data(using: .utf8) else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let dto = try? decoder.decode(DTO.self, from: data) else { return nil }
        return summary(from: dto)
    }

    private static func summary(from dto: DTO) -> YearReviewSummary {
        YearReviewSummary(
            year: dto.year ?? 0,
            vehicle: YearReviewVehicle(
                id: dto.vehicle?.id ?? 0,
                displayName: dto.vehicle?.displayName ?? "",
                model: dto.vehicle?.model ?? ""
            ),
            totalDrives: dto.totalDrives ?? 0,
            totalDistanceKm: dto.totalDistanceKm ?? 0,
            totalEnergyKwh: dto.totalEnergyKwh ?? 0,
            totalChargeSessions: dto.totalChargeSessions ?? 0,
            co2OffsetKg: dto.co2OffsetKg ?? 0,
            gasSavings: dto.gasSavings ?? 0
        )
    }
}
