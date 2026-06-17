//
//  TeslaChargingSessionsPageModel.swift
//  TeslaSync — P4 feature view · P7 · charging/TeslaChargingSessions (Apple) — View Model
//
//  Full parity with web/src/features/charging/pages/TeslaChargingSessionsPage.tsx.
//  An `@Observable` model that drives the view from the shared KMP core (ADR-004).
//  The web TanStack queries are kept under their original shape at the Swift call
//  sites (`useVehicles`, `useTeslaChargingSessions`, `useRefreshTeslaChargingSessions`)
//  in `TeslaChargingSessionsDataSource.swift`; that file is the only seam that
//  changes when the generated client lands (P1/S2-S3). The view never touches the
//  network and holds no business logic.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Mutually-exclusive render branches (web shell loading / content / empty / error)

/// The four declared data states (loading · empty · error · success). `empty` is
/// reached when the response carries zero sessions for the whole account; the
/// per-section empties (chart / map / table) cover an empty range-filtered slice
/// inside the success/empty content view.
enum ChargingSessionsViewState: Equatable {
    case loading
    case empty
    case error(String)
    case success
}

// MARK: - View Model

@MainActor
@Observable
final class TeslaChargingSessionsPageModel {
    /// Render state (web PageContainer loading / error + body).
    var viewState: ChargingSessionsViewState = .loading

    // Source data (web query results).
    private(set) var vehicles: [ChargingSessionsVehicle] = []
    private(set) var response: TeslaFleetChargingResponse?

    /// Selected VIN (web `selectedVin`; "" = All Vehicles).
    private(set) var selectedVin: String = ""

    /// Client-side range window (web `useRangeState`, default `all`).
    var selectedRange: ChargingSessionsRange = .all

    // Table sort (web `sortKey` / `sortDir`, default date-desc).
    private(set) var sortKey: ChargingSessionsSortKey = .date
    private(set) var sortDirection: ChargingSessionsSortDirection = .descending

    /// Refresh-in-flight (web `refreshMutation.isPending`).
    private(set) var isRefreshing = false

    /// Web `is403` — the refresh hit a personal (non-business) account.
    private(set) var refreshForbidden = false

    /// Inline refresh failure surfaced beside the controls (web mutation error toast).
    private(set) var refreshErrorMessage: String?

    /// Live freshness (ADR-013) — `> 2 min` since the last successful load is stale.
    private(set) var lastLoadedAt: Date?

    /// The user's default display currency (web `currencyCodeFromSymbol(settings)`).
    /// Per-row `currency_code` overrides this when present (web `row.currency_code ?? userCurrency`).
    let userCurrency = "USD"

    init() {}
}

// MARK: - Derived state (web `useMemo` / inline derivations)

extension TeslaChargingSessionsPageModel {
    /// All sessions in the loaded response (web `allSessions`).
    var allSessions: [TeslaFleetChargingSession] {
        response?.sessions ?? []
    }

    /// The summary aggregates (web `summary`, unfiltered — from the response).
    var summary: TeslaFleetChargingSummary {
        response?.summary ?? .empty
    }

    /// Range-filtered slice on `charge_start_datetime` (web `sessions` memo).
    var filteredSessions: [TeslaFleetChargingSession] {
        guard !allSessions.isEmpty else { return allSessions }
        let window = selectedRange.window()
        return ChargingSessionsMath.filtered(allSessions, start: window.start, end: window.end)
    }

    /// Range-filtered + sorted rows for the table (web `sortedSessions`).
    var sortedSessions: [TeslaFleetChargingSession] {
        ChargingSessionsMath.sorted(filteredSessions, key: sortKey, direction: sortDirection)
    }

    /// Monthly cost buckets for the bar chart (web `monthlyData`).
    var monthlyData: [ChargingMonthlyCostPoint] {
        ChargingSessionsMath.monthlyCost(from: filteredSessions)
    }

    /// Plottable sessions for the map (web `mapPoints`).
    var mapPoints: [TeslaFleetChargingSession] {
        filteredSessions.filter(\.isPlottable)
    }

    /// Vehicle picker options, "All Vehicles" first (web `vehicleOptions`).
    var vehicleOptions: [ChargingSessionsVehicleOption] {
        var options = [
            ChargingSessionsVehicleOption(
                vin: "",
                label: String(localized: "translation.tesla_sessions.allVehicles", defaultValue: "All Vehicles")
            )
        ]
        for vehicle in vehicles {
            options.append(ChargingSessionsVehicleOption(vin: vehicle.vin, label: vehicle.optionLabel))
        }
        return options
    }

    /// The "last synced" timestamp shown in the controls bar (web `sessions[0].fetched_at`).
    var lastSyncedText: String? {
        guard response != nil, let first = filteredSessions.first, let fetchedAt = first.fetchedAt else {
            return nil
        }
        return ChargingSessionsFormat.dateTime(fetchedAt)
    }

    /// `> 2 min` since the last successful load (live staleness indicator, ADR-013).
    var isStale: Bool {
        guard let lastLoadedAt else { return false }
        return Date().timeIntervalSince(lastLoadedAt) > 120
    }

    /// The display currency for a session (web `row.currency_code ?? userCurrency`).
    func currencyCode(for session: TeslaFleetChargingSession) -> String {
        session.currencyCode ?? userCurrency
    }
}

// MARK: - Lifecycle + actions

extension TeslaChargingSessionsPageModel {
    /// Initial load: vehicles for the selector, then the session slice.
    func load() async {
        if viewState == .loading {
            // first paint
        } else {
            viewState = .loading
        }
        if vehicles.isEmpty {
            vehicles = await useVehicles()
        }
        await reloadSessions()
    }

    /// Pull-to-refresh — reloads the current vehicle's slice from the store.
    func refresh() async {
        await reloadSessions()
    }

    /// Switch the active vehicle (web selector `onChange`).
    func selectVehicle(_ vin: String) async {
        guard vin != selectedVin else { return }
        selectedVin = vin
        viewState = .loading
        await reloadSessions()
    }

    /// Switch the history window (web RangePicker `onChange`). Pure client-side —
    /// no refetch; the derived slices recompute.
    func selectRange(_ range: ChargingSessionsRange) {
        selectedRange = range
    }

    /// Toggle / set the table sort (web `handleSort`).
    func sort(by key: ChargingSessionsSortKey) {
        if sortKey == key {
            sortDirection = sortDirection.toggled
        } else {
            sortKey = key
            sortDirection = .descending
        }
    }

    /// "Refresh from Tesla" — the web `refreshMutation`. Surfaces the 403
    /// business-account gate and any other failure beside the controls.
    func refreshFromTesla() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        refreshForbidden = false
        refreshErrorMessage = nil

        let outcome = await useRefreshTeslaChargingSessions(vin: selectedVin.isEmpty ? nil : selectedVin)
        switch outcome {
        case let .success(refreshed):
            response = refreshed
            lastLoadedAt = Date()
            viewState = resolveState(for: refreshed)
        case .forbidden:
            refreshForbidden = true
        case let .failed(message):
            refreshErrorMessage = message
        }
        isRefreshing = false
    }

    /// Re-fetch the session slice for the active vehicle.
    private func reloadSessions() async {
        let result = await useTeslaChargingSessions(vin: selectedVin.isEmpty ? nil : selectedVin)
        response = result
        lastLoadedAt = Date()
        viewState = resolveState(for: result)
    }

    /// Surfaced by the live client when the primary query fails (web
    /// `error` → PageContainer error). Wired so the `.error` branch is real logic.
    func fail(_ message: String) {
        viewState = .error(message)
    }

    private func resolveState(for response: TeslaFleetChargingResponse) -> ChargingSessionsViewState {
        response.sessions.isEmpty ? .empty : .success
    }
}
