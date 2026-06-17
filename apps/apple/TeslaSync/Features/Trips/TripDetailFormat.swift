//
//  TripDetailFormat.swift
//  TeslaSync — P4-APPLE P7 · page:trips/TripDetail (Apple) — Display projection
//
//  Pure display-boundary formatters + the typed panel/row kinds for the TripDetail page. The four
//  stat panels (Distance, Energy-Used, Efficiency, Cost) and the six detail rows (Trip ID, Name,
//  Started, Ended, Drives, Charges) each map to one case so every parity item renders from the bound
//  state with its own web i18n key. SI values convert to the user's units here, and only here, via
//  the shared `Units` facade (ADR-005) — nothing non-SI is stored or computed. The numeric helpers
//  mirror the web `fmtInt` / `fmtNumber(value, 2)` / `formatCurrency` contracts exactly.
//

import Foundation
import SwiftUI

// MARK: - Stat panels (web `StatCard` row)

/// The four headline stat panels (web `trips.detail.{distance,energy,efficiency,cost}`). One case
/// per named parity panel so each renders from the bound record with its own i18n key + SF Symbol.
public enum TripDetailStatKind: String, CaseIterable, Identifiable, Sendable {
    case distance, energy, efficiency, cost

    public var id: String { rawValue }

    /// The web `trips.detail.*` key for the card label (catalog `translation.` namespace).
    var titleKey: LocalizedStringKey {
        switch self {
        case .distance: "translation.trips.detail.distance"
        case .energy: "translation.trips.detail.energy"
        case .efficiency: "translation.trips.detail.efficiency"
        case .cost: "translation.trips.detail.cost"
        }
    }

    var systemImage: String {
        switch self {
        case .distance: "road.lanes"
        case .energy: "bolt.fill"
        case .efficiency: "gauge.with.dots.needle.67percent"
        case .cost: "creditcard.fill"
        }
    }
}

/// A formatted stat panel value (web `StatCard` — value + unit folded into one display string).
public struct TripDetailStatValue: Identifiable, Sendable {
    public let kind: TripDetailStatKind
    public let value: String

    public var id: String { kind.rawValue }

    public init(kind: TripDetailStatKind, value: String) {
        self.kind = kind
        self.value = value
    }
}

// MARK: - Detail rows (web GlassPanel `KVList`)

/// The six key/value detail rows (web `trips.detail.{tripId,name,started,ended,drives,charges}`).
/// One case per row so each renders from the bound record with its own i18n key.
public enum TripDetailInfoRowKind: String, CaseIterable, Identifiable, Sendable {
    case tripId, name, started, ended, drives, charges

    public var id: String { rawValue }

    /// The web `trips.detail.*` key for the row label (catalog `translation.` namespace).
    var titleKey: LocalizedStringKey {
        switch self {
        case .tripId: "translation.trips.detail.tripId"
        case .name: "translation.trips.detail.name"
        case .started: "translation.trips.detail.started"
        case .ended: "translation.trips.detail.ended"
        case .drives: "translation.trips.detail.drives"
        case .charges: "translation.trips.detail.charges"
        }
    }
}

/// A formatted detail row (web `KVList` item).
public struct TripDetailInfoRow: Identifiable, Sendable {
    public let kind: TripDetailInfoRowKind
    public let value: String

    public var id: String { kind.rawValue }

    public init(kind: TripDetailInfoRowKind, value: String) {
        self.kind = kind
        self.value = value
    }
}

// MARK: - Formatters (web `fmtInt` / `fmtNumber` / `formatCurrency` / `formatDate`)

/// Pure display-boundary formatters for the TripDetail surface. Every helper returns the web em-dash
/// sentinel (`'—'`) for non-finite / missing input rather than "nan" or "Invalid Date".
public enum TripDetailFormat {
    /// Em-dash sentinel for an absent value (web `'—'`).
    public static let emDash = "—"

    /// Default currency symbol (web `settings.currency_symbol`, default `'$'`).
    public static let defaultCurrencySymbol = "$"

    /// Web `KM_PER_MILE` — the efficiency converter factor used until a shared SI efficiency helper
    /// exists (same precedent as the web page's inline constant).
    static let kmPerMile = 1.609344

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int) -> String {
        guard value.isFinite else { return emDash }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `fmtInt(value)` → `fmtNumber(value, 0)` (grouped, no fraction digits).
    public static func integer(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    /// Web `formatCurrency(amount)` → `${currencySymbol}${fmtNumber(amount, 2)}` (default `'$'`).
    public static func currency(_ amount: Double, symbol: String = defaultCurrencySymbol) -> String {
        guard amount.isFinite else { return emDash }
        return symbol + number(amount, decimals: 2)
    }

    /// Web `formatDate(iso)` — locale medium date (no time); `nil`/invalid → em dash.
    public static func date(_ date: Date?) -> String {
        guard let date else { return emDash }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    /// Web `efficiencyUnit`: `Wh/mi` when the user's distance unit is miles, else `Wh/km`.
    static func efficiencyUnit(_ units: UnitPreferences) -> String {
        units.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `efficiencyDisplay`: `whPerKm`, scaled to `Wh/mi` when the user prefers miles.
    static func efficiencyDisplay(_ record: TripDetailRecord, units: UnitPreferences) -> Double {
        let whPerKm = record.totalDistanceM > 0
            ? record.totalEnergyWh / (record.totalDistanceM / 1000)
            : 0
        return units.distance == "mi" ? whPerKm * kmPerMile : whPerKm
    }
}

// MARK: - Projection (web render boundary)

public extension TripDetailFormat {
    /// The four stat panels formatted to the user's units (web `StatCard` row).
    static func stats(
        _ record: TripDetailRecord,
        units: UnitPreferences,
        currencySymbol: String = defaultCurrencySymbol
    ) -> [TripDetailStatValue] {
        TripDetailStatKind.allCases.map { kind in
            TripDetailStatValue(
                kind: kind,
                value: statValue(kind, record: record, units: units, currencySymbol: currencySymbol)
            )
        }
    }

    /// The six detail rows formatted from the record (web `KVList`).
    static func infoRows(_ record: TripDetailRecord) -> [TripDetailInfoRow] {
        TripDetailInfoRowKind.allCases.map { kind in
            TripDetailInfoRow(kind: kind, value: infoValue(kind, record: record))
        }
    }

    private static func statValue(
        _ kind: TripDetailStatKind,
        record: TripDetailRecord,
        units: UnitPreferences,
        currencySymbol: String
    ) -> String {
        switch kind {
        case .distance:
            return "\(integer(Units.convertDistance(record.totalDistanceM, units))) \(units.distance)"
        case .energy:
            return "\(number(record.totalEnergyWh, decimals: 2)) Wh"
        case .efficiency:
            return "\(integer(efficiencyDisplay(record, units: units))) \(efficiencyUnit(units))"
        case .cost:
            return currency(record.totalCost, symbol: currencySymbol)
        }
    }

    private static func infoValue(_ kind: TripDetailInfoRowKind, record: TripDetailRecord) -> String {
        switch kind {
        case .tripId: return String(record.id)
        case .name: return record.name ?? emDash
        case .started: return date(record.startDate)
        case .ended: return date(record.endDate)
        case .drives: return String(record.driveCount)
        case .charges: return String(record.chargeCount)
        }
    }
}
