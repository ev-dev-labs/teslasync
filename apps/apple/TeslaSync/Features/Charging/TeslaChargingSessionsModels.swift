//
//  TeslaChargingSessionsModels.swift
//  TeslaSync — P4 feature view · P7 · charging/TeslaChargingSessions (Apple) — Data Models
//
//  Wire-faithful Swift peers of the web Fleet Charging Sessions contract. Field
//  names + JSON keys mirror web/src/api/hooks/useCharging.ts (`TeslaChargingSession`,
//  `TeslaChargingSessionSummary`, `TeslaChargingSessionResponse`) exactly — snake_case
//  on the wire. Energy is SI (watt-hours) and is converted only at the render boundary
//  via `ChargingSessionsConvert.energyFromWh` (the native peer of web
//  `convertEnergyFromSI`, P1/S5); peak power is the wire kW value the web reads
//  directly. Types are prefixed `ChargingSessions*` / `TeslaFleetChargingSession` to
//  avoid colliding with the sibling `TeslaChargingSessionsMap` records.
//

import Foundation
import SwiftUI

// MARK: - Wire model (web TeslaChargingSession)

/// One fleet charging session — `GET /tesla/charging/sessions`. Energy is SI Wh;
/// optional money/power/coordinate fields are nullable on the wire (web pointers).
struct TeslaFleetChargingSession: Codable, Identifiable, Equatable {
    let id: Int64
    let sessionID: Int64
    let vin: String
    let siteLocationName: String
    let chargeStartDatetime: String
    let chargeStopDatetime: String?
    /// Energy added in watt-hours (Wh, SI — web `total_energy_added_wh`).
    let totalEnergyAddedWh: Double
    /// Peak power in kW (the wire value the web reads directly — `peak_power_kw`).
    let peakPowerKw: Double?
    let chargeDurationS: Double?
    let chargerType: String?
    let currencyCode: String?
    let totalCost: Double?
    let perKwhRate: Double?
    let latitude: Double?
    let longitude: Double?
    let fetchedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case sessionID = "session_id"
        case vin
        case siteLocationName = "site_location_name"
        case chargeStartDatetime = "charge_start_datetime"
        case chargeStopDatetime = "charge_stop_datetime"
        case totalEnergyAddedWh = "total_energy_added_wh"
        case peakPowerKw = "peak_power_kw"
        case chargeDurationS = "charge_duration_s"
        case chargerType = "charger_type"
        case currencyCode = "currency_code"
        case totalCost = "total_cost"
        case perKwhRate = "per_kwh_rate"
        case latitude
        case longitude
        case fetchedAt = "fetched_at"
    }

    /// Parsed start instant (web `new Date(charge_start_datetime)`).
    var startDate: Date? {
        ChargingSessionsFormat.parseISO(chargeStartDatetime)
    }

    /// Whether this session has a plottable coordinate (web `mapPoints` filter).
    var isPlottable: Bool {
        guard let latitude, let longitude else { return false }
        return latitude.isFinite && longitude.isFinite
    }
}

// MARK: - Summary (web TeslaChargingSessionSummary)

/// The summary aggregates surfaced in the five stat cards (web `response.summary`).
/// `total_wh` is SI watt-hours; `peak_power_kw` is the wire kW value.
struct TeslaFleetChargingSummary: Codable, Equatable {
    let totalSessions: Int
    let totalWh: Double?
    let totalCost: Double?
    let avgCostPerKwh: Double?
    let peakPowerKw: Double?

    enum CodingKeys: String, CodingKey {
        case totalSessions = "total_sessions"
        case totalWh = "total_wh"
        case totalCost = "total_cost"
        case avgCostPerKwh = "avg_cost_per_kwh"
        case peakPowerKw = "peak_power_kw"
    }

    /// The web default summary used before the response lands (all zero / nil).
    static let empty = TeslaFleetChargingSummary(
        totalSessions: 0, totalWh: nil, totalCost: nil, avgCostPerKwh: nil, peakPowerKw: nil
    )
}

// MARK: - Response (web TeslaChargingSessionResponse)

/// `GET /tesla/charging/sessions` envelope — the session slice + its summary.
struct TeslaFleetChargingResponse: Codable, Equatable {
    let sessions: [TeslaFleetChargingSession]
    let summary: TeslaFleetChargingSummary
    let upserted: Int?

    enum CodingKeys: String, CodingKey {
        case sessions
        case summary
        case upserted
    }
}

// MARK: - Vehicle identity for the selector (web useVehicles roster)

/// Minimal vehicle identity for the picker (web `display_name` + `vin`).
struct ChargingSessionsVehicle: Codable, Identifiable, Equatable {
    let id: Int64
    let vin: String
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case id
        case vin
        case displayName = "display_name"
    }

    /// Selector label (web `${display_name} (${vin.slice(-6)})`).
    var optionLabel: String {
        "\(displayName) (\(ChargingSessionsFormat.lastSix(vin)))"
    }
}

/// One option in the vehicle `Picker` (web `vehicleOptions`). An empty `vin`
/// is the "All Vehicles" sentinel.
struct ChargingSessionsVehicleOption: Identifiable, Equatable {
    let vin: String
    let label: String

    var id: String {
        vin
    }
}

// MARK: - Derived chart point (web buildMonthlyCost row)

/// One bar in the monthly-cost chart: a `YYYY-MM` bucket and its summed cost.
struct ChargingMonthlyCostPoint: Identifiable, Equatable {
    let month: String
    let total: Double

    var id: String {
        month
    }
}

// MARK: - Date range presets (web RangePicker / PRESET_IDS)

/// Client-side history window presets applied to `charge_start_datetime`
/// (web `useRangeState`, default `all`).
enum ChargingSessionsRange: String, CaseIterable, Identifiable, Equatable {
    case sevenDays = "7d"
    case thirtyDays = "30d"
    case ninetyDays = "90d"
    case monthToDate = "mtd"
    case yearToDate = "ytd"
    case all

    var id: String {
        rawValue
    }

    /// Localized menu label.
    var label: String {
        switch self {
        case .sevenDays:
            String(localized: "translation.range.7d", defaultValue: "Last 7 Days")
        case .thirtyDays:
            String(localized: "translation.range.30d", defaultValue: "Last 30 Days")
        case .ninetyDays:
            String(localized: "translation.range.90d", defaultValue: "Last 90 Days")
        case .monthToDate:
            String(localized: "translation.range.mtd", defaultValue: "Month to Date")
        case .yearToDate:
            String(localized: "translation.range.ytd", defaultValue: "Year to Date")
        case .all:
            String(localized: "translation.range.all", defaultValue: "All Time")
        }
    }

    /// `[start, end]` window for `now` (nil bounds = unbounded "all"); end is the
    /// end of `now`'s day so today's sessions are always included (web `endMs`).
    func window(now: Date = Date(), calendar: Calendar = .current) -> (start: Date?, end: Date) {
        let endOfDay = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: now) ?? now
        switch self {
        case .sevenDays:
            return (calendar.date(byAdding: .day, value: -7, to: now), endOfDay)
        case .thirtyDays:
            return (calendar.date(byAdding: .day, value: -30, to: now), endOfDay)
        case .ninetyDays:
            return (calendar.date(byAdding: .day, value: -90, to: now), endOfDay)
        case .monthToDate:
            return (calendar.dateInterval(of: .month, for: now)?.start, endOfDay)
        case .yearToDate:
            return (calendar.dateInterval(of: .year, for: now)?.start, endOfDay)
        case .all:
            return (nil, .distantFuture)
        }
    }
}

// MARK: - Table sort (web sortKey / sortDir)

/// The sortable table columns (web `sortKey`).
enum ChargingSessionsSortKey: String, Equatable {
    case date
    case energy
    case peakPower
    case cost
}

/// Sort direction (web `sortDir`).
enum ChargingSessionsSortDirection: Equatable {
    case ascending
    case descending

    var toggled: ChargingSessionsSortDirection {
        self == .ascending ? .descending : .ascending
    }
}

// MARK: - Pure aggregation helpers (web module-scope functions)

/// Native peers of the web page's module-scope helpers — pure + unit-testable.
enum ChargingSessionsMath {
    /// Web `buildMonthlyCost`: sum `total_cost` per `YYYY-MM` of `charge_start_datetime`,
    /// sorted ascending by month key.
    static func monthlyCost(
        from sessions: [TeslaFleetChargingSession],
        calendar: Calendar = .current
    ) -> [ChargingMonthlyCostPoint] {
        var buckets: [String: Double] = [:]
        for session in sessions {
            guard let date = session.startDate else { continue }
            let components = calendar.dateComponents([.year, .month], from: date)
            guard let year = components.year, let month = components.month else { continue }
            let key = "\(year)-\(String(format: "%02d", month))"
            buckets[key, default: 0] += session.totalCost ?? 0
        }
        return buckets
            .sorted { $0.key < $1.key }
            .map { ChargingMonthlyCostPoint(month: $0.key, total: $0.value) }
    }

    /// Web range filter: sessions whose start falls within `[start, end]`.
    static func filtered(
        _ sessions: [TeslaFleetChargingSession],
        start: Date?,
        end: Date
    ) -> [TeslaFleetChargingSession] {
        sessions.filter { session in
            guard let date = session.startDate else { return false }
            if let start, date < start { return false }
            return date <= end
        }
    }

    /// Web `sortedSessions`: stable sort by the active key/direction.
    static func sorted(
        _ sessions: [TeslaFleetChargingSession],
        key: ChargingSessionsSortKey,
        direction: ChargingSessionsSortDirection
    ) -> [TeslaFleetChargingSession] {
        sessions.sorted { lhs, rhs in
            let comparison: Int = switch key {
            case .date:
                lhs.chargeStartDatetime.compare(rhs.chargeStartDatetime).rawValue
            case .energy:
                compareDouble(lhs.totalEnergyAddedWh, rhs.totalEnergyAddedWh)
            case .peakPower:
                compareDouble(lhs.peakPowerKw ?? 0, rhs.peakPowerKw ?? 0)
            case .cost:
                compareDouble(lhs.totalCost ?? 0, rhs.totalCost ?? 0)
            }
            return direction == .descending ? comparison > 0 : comparison < 0
        }
    }

    private static func compareDouble(_ lhs: Double, _ rhs: Double) -> Int {
        if lhs < rhs { return -1 }
        if lhs > rhs { return 1 }
        return 0
    }
}

// MARK: - SI → display conversion (web convertEnergyFromSI, P1/S5)

/// Pure SI → display energy conversion. Mirrors `web/src/lib/unitConversion.ts`
/// `convertEnergyFromSI`: watt-hours to kilowatt-hours at the boundary.
enum ChargingSessionsConvert {
    /// Convert on-disk watt-hours to kilowatt-hours (web `convertEnergyFromSI(wh, 'kWh')`).
    static func energyFromWh(_ wh: Double) -> Double {
        wh / 1000
    }
}

// MARK: - Display formatting (web fmtNumber / fmtInt / formatCurrencyValue / formatDateTime)

/// Locale-aware number, currency, energy + date formatting at the display
/// boundary — the native peers of the web page's `fmtNumber` / `fmtInt` /
/// `formatCurrencyValue` / `formatEnergy` / `formatDateTime`.
enum ChargingSessionsFormat {
    /// The em-dash the web renders for missing values (`'—'`).
    static let dash = "—"

    /// Web `fmtNumber(value, fractionDigits)` — grouped, fixed fraction digits.
    static func number(_ value: Double, fractionDigits: Int = 1) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(fractionDigits)f", value)
    }

    /// Web `fmtInt(value)` — grouped integer.
    static func integer(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Web `formatEnergy(total_wh, { precision })` — Wh → kWh, one-decimal + unit.
    static func energyKWh(_ wh: Double?, precision: Int = 1) -> String {
        guard let wh, wh.isFinite else { return dash }
        return "\(number(ChargingSessionsConvert.energyFromWh(wh), fractionDigits: precision)) kWh"
    }

    /// Web `formatCurrencyValue(value, currency, locale, precision)` — ISO 4217
    /// currency style; falls back to the literal code + decimal for an unknown code.
    static func currency(
        _ value: Double?,
        code: String,
        fractionDigits: Int
    ) -> String {
        guard let value, value.isFinite else { return dash }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        if let formatted = formatter.string(from: NSNumber(value: value)) {
            return formatted
        }
        return "\(code) \(number(value, fractionDigits: fractionDigits))"
    }

    /// Web `formatDurationSeconds`: `Xh Ym` (or `Ym` under an hour); dash when nil.
    static func duration(_ seconds: Double?) -> String {
        guard let seconds, seconds.isFinite else { return dash }
        let total = Int(seconds)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        return "\(minutes)m"
    }

    /// Web `formatDateTime` — abbreviated date + short time, locale-aware. Dash
    /// when the source string is empty/unparseable.
    static func dateTime(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else { return dash }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Web `…${vin.slice(-6)}` — the last six characters of a VIN.
    static func lastSix(_ value: String) -> String {
        guard value.count > 6 else { return value }
        return String(value.suffix(6))
    }

    /// Parse a backend ISO-8601 timestamp (with or without fractional seconds).
    /// Formatters are built per call so the helper stays free of non-`Sendable`
    /// shared mutable state under Swift 6 strict concurrency.
    static func parseISO(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: iso) { return date }

        // Tolerant fallback for `YYYY-MM-DDTHH:mm:ssZ` style timestamps.
        let fallback = DateFormatter()
        fallback.locale = Locale(identifier: "en_US_POSIX")
        fallback.dateFormat = "yyyy-MM-dd'T'HH:mm:ssZ"
        return fallback.date(from: iso)
    }
}
