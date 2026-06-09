//
//  ChargeSessionChartWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0019 · ChargeSessionChartWidget (Apple)
//
//  Domain value types ported from
//  features/dashboard/widgets/ChargeSessionChartWidget.tsx: the cached charging
//  session DTO, the vehicle identity, the charger-type bucket, the projected
//  bar, and the merged projection the view renders. Pure Foundation — no
//  SwiftUI / transport.
//

import Foundation

// MARK: - Cached inputs (port of web ChargingSession, fields this widget reads)

/// One cached charging session from `GET /charging?vehicle_id=…&limit=10` — the
/// Swift port of the subset of the web `ChargingSession` this widget reads
/// (`api/types.ts`). `totalEnergyAddedWh` is SI watt-hours; `startedAt` is the
/// parsed `started_at` timestamp (nil when the backend omitted it, which the web
/// guards with `s.started_at ? … : '#i+1'`); `chargerType` is the raw
/// `charger_type` string the bucket classifier inspects.
public struct ChargeSessionDTO: Sendable, Equatable, Identifiable {
    public var id: Int
    public var startedAt: Date?
    public var totalEnergyAddedWh: Double?
    public var chargerType: String?

    public init(
        id: Int,
        startedAt: Date? = nil,
        totalEnergyAddedWh: Double? = nil,
        chargerType: String? = nil
    ) {
        self.id = id
        self.startedAt = startedAt
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.chargerType = chargerType
    }
}

/// Minimal vehicle identity the widget needs (port of the web `useVehicles()`
/// first row — the widget only reads the id to scope the query, plus a name for
/// optional accessibility).
public struct ChargeSessionVehicle: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }

    /// Trimmed display name, or `nil` when blank (web `vehicles?.[0]`).
    public var primaryName: String? {
        guard let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return nil
        }
        return name
    }
}

// MARK: - Charger-type bucket (port of web `classifyChargerType` + CHARGER_TYPE_LABEL)

/// The charger-type bucket a session is color-coded into — the Swift port of the
/// web `classifyChargerType` return values (`'home' | 'supercharger' | 'dc'`).
/// The raw value matches the web internal key so the strings catalog
/// (`widget.chargeSessionChart.type.<kind>`) and the `CHARGER_COLORS` mapping
/// agree across platforms.
public enum ChargeSessionChargerKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case home
    case supercharger
    case dc

    public var id: String {
        rawValue
    }

    /// The i18n key for the bucket label (web `t('widget.chargeSessionChart.type.<kind>', …)`).
    public var labelKey: String {
        "widget.chargeSessionChart.type.\(rawValue)"
    }

    /// The web English fallback label (`CHARGER_TYPE_LABEL`).
    public var labelFallback: String {
        switch self {
        case .home: "Home / AC"
        case .supercharger: "Supercharger"
        case .dc: "DC Fast"
        }
    }
}

// MARK: - Projection (port of the web `ChartDatum` + the derived stat values)

/// One projected bar — the Swift port of the web `ChartDatum`: a short
/// date/ordinal label (`"Apr 4"` / `"#3"`), the display energy in kWh, the
/// charger-type bucket (drives the bar color + legend), and a stable, unique
/// `plotKey` so Swift Charts keeps bars ordered and never collapses two sessions
/// that share the same calendar-day label.
public struct ChargeSessionBar: Sendable, Equatable, Identifiable {
    public var plotKey: String
    public var label: String
    public var energy: Double
    public var kind: ChargeSessionChargerKind

    public init(plotKey: String, label: String, energy: Double, kind: ChargeSessionChargerKind) {
        self.plotKey = plotKey
        self.label = label
        self.energy = energy
        self.kind = kind
    }

    public var id: String {
        plotKey
    }
}

/// The merged projection the view switches over — the recent sessions as ordered
/// bars (oldest→newest, web `.reverse()`), the derived Total / Avg energy and the
/// session count, the fixed display-energy unit label (web hard-codes `kWh`), and
/// whether there is any session to chart (web `hasData = chartData.length > 0`).
public struct ChargeSessionChartProjection: Sendable, Equatable {
    public var bars: [ChargeSessionBar]
    public var totalEnergy: Double
    public var avgEnergy: Double
    public var sessionCount: Int
    public var energyUnit: String
    public var hasData: Bool

    public init(
        bars: [ChargeSessionBar],
        totalEnergy: Double,
        avgEnergy: Double,
        sessionCount: Int,
        energyUnit: String,
        hasData: Bool
    ) {
        self.bars = bars
        self.totalEnergy = totalEnergy
        self.avgEnergy = avgEnergy
        self.sessionCount = sessionCount
        self.energyUnit = energyUnit
        self.hasData = hasData
    }

    /// Empty projection (no sessions resolved yet). The unit mirrors the web's
    /// fixed `kWh` so a fresh projection reads sensibly.
    public static let empty = ChargeSessionChartProjection(
        bars: [],
        totalEnergy: 0,
        avgEnergy: 0,
        sessionCount: 0,
        energyUnit: "kWh",
        hasData: false
    )
}
