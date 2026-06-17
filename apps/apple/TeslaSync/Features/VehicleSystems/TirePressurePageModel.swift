//
//  TirePressurePageModel.swift
//  TeslaSync — P4 feature view · P7 · TirePressure (Apple) — View Model
//
//  Full parity with web/src/features/vehicle-systems/pages/TirePressurePage.tsx.
//  An `@Observable` model that drives the view from the shared KMP core (ADR-004).
//  The web TanStack queries are kept under their original shape at the Swift call
//  sites (`useTirePressureLatest`, `useTirePressureHistory`) in
//  `TirePressureDataSource.swift`; that file is the only seam that changes when
//  the generated client lands (P1/S2-S3). The view never touches the network.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Mutually-exclusive render branches (web shell loading / content / empty / error)

/// The four declared data states (loading · empty · error · success).
enum TirePressureViewState: Equatable {
    case loading
    case empty
    case error(String)
    case success
}

// MARK: - Derived value types (web `useMemo` shapes)

/// The summary-card aggregates (web `summaryStats`) — all in Pa (SI).
struct TirePressureSummary: Equatable, Sendable {
    let averagePascals: Double
    let minimumPascals: Double
    let warningCount: Int
}

/// One charted instant: the four corner pressures already converted to the
/// display unit (web `chartData` row).
struct TirePressureChartPoint: Identifiable, Equatable, Sendable {
    let id: Int64
    let time: Date
    let frontLeft: Double
    let frontRight: Double
    let rearLeft: Double
    let rearRight: Double

    func value(for position: TirePosition) -> Double {
        switch position {
        case .fl: return frontLeft
        case .fr: return frontRight
        case .rl: return rearLeft
        case .rr: return rearRight
        }
    }
}

// MARK: - View Model

@MainActor
@Observable
final class TirePressurePageModel {
    // Render state
    var viewState: TirePressureViewState = .loading

    // Source data (web query results)
    private(set) var latest: TirePressureReading?
    private(set) var history: [TirePressureReading] = []
    private(set) var vehicles: [TirePressureVehicle] = []

    // Selected vehicle (web useSelectedVehicle) — global across vehicle pages.
    var selectedVehicleID: Int64 = 0

    // History window (web useRangeState, default 30d) + display unit (web useUnits).
    var selectedRange: TirePressureRange = .thirtyDays
    var pressureUnit: TirePressureUnit = .psi

    // Secondary-error surface (web `anyError` inline AlertBanner). The primary
    // (latest) failure drives the full-screen `.error` state instead.
    private(set) var inlineErrorMessage: String?

    // Live freshness (ADR-013) — `> 2 min` is treated as stale.
    private(set) var lastUpdated: Date?

    // In-flight flags (web `loadingLatest` / `loadingHistory`) so the gauges and
    // the history chart/table show their redacted skeletons during a reload.
    private(set) var isLoadingLatest = false
    private(set) var isLoadingHistory = false

    init() {}
}

// MARK: - Derived state (web `useMemo` / inline derivations)

extension TirePressurePageModel {
    /// Chronological order, oldest first (web `historyAsc`).
    var historyAscending: [TirePressureReading] {
        history.sorted { $0.createdAt < $1.createdAt }
    }

    /// Newest-first rows for the table (web default sort `created_at desc`).
    var historyDescending: [TirePressureReading] {
        history.sorted { $0.createdAt > $1.createdAt }
    }

    /// Whether the latest reading carries any TPMS warning (web `hasWarning`).
    var hasWarning: Bool {
        TirePressureMath.hasWarning(latest?.tpmsHardWarnings)
            || TirePressureMath.hasWarning(latest?.tpmsSoftWarnings)
    }

    /// Whether the active warning is a hard (vs soft) TPMS warning.
    var isHardWarning: Bool {
        TirePressureMath.hasWarning(latest?.tpmsHardWarnings)
    }

    /// Web `summaryStats` — avg / min / warning-count over the four corners (Pa).
    var summary: TirePressureSummary? {
        guard let latest else { return nil }
        let values = TirePosition.allCases.map { latest.pascals(for: $0) }
        guard !values.isEmpty else { return nil }
        let average = values.reduce(0, +) / Double(values.count)
        let minimum = values.min() ?? 0
        let warningCount = values.filter(TirePressureMath.isOutsideRecommended).count
        return TirePressureSummary(averagePascals: average, minimumPascals: minimum, warningCount: warningCount)
    }

    /// Web `chartData` — history rows mapped to display-unit corner values.
    var chartPoints: [TirePressureChartPoint] {
        historyAscending.map { reading in
            TirePressureChartPoint(
                id: reading.id,
                time: reading.createdAt,
                frontLeft: displayValue(reading.pascals(for: .fl)),
                frontRight: displayValue(reading.pascals(for: .fr)),
                rearLeft: displayValue(reading.pascals(for: .rl)),
                rearRight: displayValue(reading.pascals(for: .rr))
            )
        }
    }

    /// Web `lastUpdatedAt` — the newest timestamp in the visible window.
    var lastUpdatedAt: Date? {
        historyAscending.last?.createdAt
    }

    /// The gauge ceiling in the active display unit (web `gaugeMax`).
    var gaugeMaximum: Double {
        displayValue(TirePressureThresholds.gaugeMaxPa)
    }

    /// Active vehicle display name (web selector label).
    var activeVehicleName: String {
        vehicles.first { $0.id == selectedVehicleID }?.displayName ?? ""
    }

    /// `> 2 min` since the last successful refresh (live staleness indicator).
    var isStale: Bool {
        guard let lastUpdated else { return false }
        return Date().timeIntervalSince(lastUpdated) > 120
    }

    /// Convert an on-disk Pa value to the active display unit (web `pressureDisplayValue`).
    func displayValue(_ pascals: Double) -> Double {
        TirePressureConvert.fromPascals(pascals, to: pressureUnit)
    }
}

// MARK: - Lifecycle + actions

extension TirePressurePageModel {
    /// Initial load: vehicles for the selector, then the latest + history set.
    func load() async {
        viewState = .loading
        if vehicles.isEmpty {
            vehicles = await loadVehicles()
        }
        if selectedVehicleID == 0 {
            selectedVehicleID = vehicles.first?.id ?? 0
        }
        await reloadData(initial: true)
    }

    /// Pull-to-refresh — reloads the active vehicle's data.
    func refresh() async {
        await reloadData(initial: false)
    }

    /// Switch the active vehicle (web selector `onChange`).
    func selectVehicle(_ vehicleID: Int64) async {
        guard vehicleID != selectedVehicleID else { return }
        selectedVehicleID = vehicleID
        await reloadData(initial: true)
    }

    /// Switch the history window (web RangePicker `onChange`).
    func selectRange(_ range: TirePressureRange) async {
        guard range != selectedRange else { return }
        selectedRange = range
        await reloadData(initial: false)
    }

    /// Re-fetch the latest snapshot + windowed history for the active vehicle.
    func reloadData(initial: Bool) async {
        let vehicleID = selectedVehicleID
        guard vehicleID > 0 else {
            latest = nil
            history = []
            viewState = .empty
            return
        }

        inlineErrorMessage = nil
        if initial { isLoadingLatest = true }
        isLoadingHistory = true

        let now = Date()
        let windowStart = selectedRange.startDate(now: now)

        latest = await useTirePressureLatest(vehicleID: vehicleID)
        isLoadingLatest = false

        history = await useTirePressureHistory(vehicleID: vehicleID, start: windowStart, end: now)
        isLoadingHistory = false

        lastUpdated = Date()
        viewState = resolveState()
    }

    /// Surfaced by the live client when the primary (latest) request fails
    /// (web `latestError` → PageContainer error). Wired here so the `.error`
    /// branch is real logic, not a dead arm.
    func fail(_ message: String) {
        inlineErrorMessage = message
        viewState = .error(message)
    }

    private func resolveState() -> TirePressureViewState {
        if latest == nil, history.isEmpty {
            return .empty
        }
        return .success
    }
}
