//
//  ChargeHistoryWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0017 · ChargeHistoryWidget (Apple)
//
//  Domain value types ported from
//  features/dashboard/widgets/ChargeHistoryWidget.tsx: the cached charging
//  session DTO (the single field this widget reads), the vehicle identity, the
//  projected area-chart point, and the merged projection the view renders. Pure
//  Foundation — no SwiftUI / transport.
//

import Foundation

// MARK: - Cached inputs (port of web ChargingSession, the field this widget reads)

/// One cached charging session from `GET /charging?vehicle_id=…&limit=10` — the
/// Swift port of the single field the web `ChargeHistoryWidget` reads from the
/// web `ChargingSession` (`api/types.ts`). `totalEnergyAddedWh` is SI watt-hours
/// (the web `s.total_energy_added_wh ?? 0`, converted to kWh at the display
/// boundary); `id` scopes nothing here but keeps the DTO `Identifiable` for the
/// preview/test fixtures.
public struct ChargeHistorySessionDTO: Sendable, Equatable, Identifiable {
    public var id: Int
    public var totalEnergyAddedWh: Double?

    public init(id: Int, totalEnergyAddedWh: Double? = nil) {
        self.id = id
        self.totalEnergyAddedWh = totalEnergyAddedWh
    }
}

/// Minimal vehicle identity the widget needs — the port of the web
/// `useVehicles()` first row. The widget only reads the id to scope the
/// `/charging` query (`vehicleId ?? vehicles?.[0]?.id ?? 0`), plus an optional
/// name for accessibility.
public struct ChargeHistoryVehicle: Sendable, Equatable {
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

// MARK: - Projection point (port of the web `chartData` datum `{ i, energy }`)

/// One projected area-chart point — the Swift port of the web `chartData` datum
/// `{ i: String, energy }`. `indexLabel` is the web `i` (the session's
/// pre-reverse array index, rendered verbatim on the x-axis exactly as the web
/// `xKey="i"` with no formatter does); `energy` is the display energy in kWh;
/// `plotKey` is a stable, zero-padded ordering key so Swift Charts keeps the
/// points in the reversed (oldest→newest) order and never reorders the series.
public struct ChargeHistoryPoint: Sendable, Equatable, Identifiable {
    public var plotKey: String
    public var indexLabel: String
    public var energy: Double

    public init(plotKey: String, indexLabel: String, energy: Double) {
        self.plotKey = plotKey
        self.indexLabel = indexLabel
        self.energy = energy
    }

    public var id: String {
        plotKey
    }
}

// MARK: - Projection (port of the web `chartData` + the derived stat values)

/// The merged projection the view switches over — the recent sessions as ordered
/// points (oldest→newest, web `.reverse()`), the derived Total / Avg energy, the
/// fixed display-energy unit label (web hard-codes `kWh`), and whether there is
/// enough history to chart. `hasData` mirrors the web `chartData.length > 1`
/// exactly: a single session is not enough — the area trend needs at least two
/// points, otherwise the widget shows the "No charge sessions yet" empty state.
public struct ChargeHistoryChartProjection: Sendable, Equatable {
    public var points: [ChargeHistoryPoint]
    public var totalEnergy: Double
    public var avgEnergy: Double
    public var energyUnit: String
    public var hasData: Bool

    public init(
        points: [ChargeHistoryPoint],
        totalEnergy: Double,
        avgEnergy: Double,
        energyUnit: String,
        hasData: Bool
    ) {
        self.points = points
        self.totalEnergy = totalEnergy
        self.avgEnergy = avgEnergy
        self.energyUnit = energyUnit
        self.hasData = hasData
    }

    /// Empty projection (no sessions resolved yet). The unit mirrors the web's
    /// fixed `kWh` so a fresh projection reads sensibly.
    public static let empty = ChargeHistoryChartProjection(
        points: [],
        totalEnergy: 0,
        avgEnergy: 0,
        energyUnit: "kWh",
        hasData: false
    )
}
