//
//  SafetySettingsPageModel.swift
//  TeslaSync — P4 feature view · P7 · vehicle-systems/SafetySettings (Apple) — View Model
//
//  Full parity with web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx.
//  An `@Observable` model that drives the view from the shared KMP core (ADR-004).
//  The web queries keep their original shape at the Swift call sites
//  (`useSecurityLatest`, `useSafetyLatest`, `useSafetyHistory`) in
//  `SafetySettingsDataSource.swift`; that file is the only seam that changes when
//  the generated client lands (P1/S2-S3). The view never touches the network.
//

import Foundation
import Observation
import SwiftUI

// MARK: - View Model

@MainActor
@Observable
final class SafetySettingsPageModel {
    // Render state
    var viewState: SafetySettingsViewState = .loading

    // Source data (web query results)
    private(set) var latest: SafetySnapshot?
    private(set) var history: [SafetySnapshot] = []
    private(set) var security: SafetySecuritySnapshot?
    private(set) var vehicles: [SafetyVehicle] = []

    // Selected vehicle (web useSelectedVehicle) — global across vehicle pages.
    var selectedVehicleID: Int64 = 0

    // Display distance unit (web useUnits().unitPrefs.distance).
    var distanceUnit: SafetyDistanceUnit = .mi

    // Secondary-error surface (web `anyError` inline AlertBanner). The primary
    // (latest) failure drives the full-screen `.error` state instead.
    private(set) var inlineErrorMessage: String?

    // Live freshness (ADR-013) — `> 2 min` is treated as stale.
    private(set) var lastUpdated: Date?

    // The history page size kept identical to the web query (`&limit=100`).
    private let historyLimit = 100

    init() {}
}

// MARK: - Derived state (web `useMemo` / inline derivations)

extension SafetySettingsPageModel {
    /// How many of the nine ADAS features are enabled (web `enabled`).
    var enabledCount: Int {
        guard let latest else { return 0 }
        return AdasEnum.enabledCount(latest)
    }

    /// The fixed total feature count (web `TOTAL_FEATURES`).
    var totalFeatures: Int {
        AdasEnum.totalFeatures
    }

    /// Disabled feature count (web `disabled = TOTAL_FEATURES - enabled`).
    var disabledCount: Int {
        totalFeatures - enabledCount
    }

    /// The 0–100 safety score (web `scorePct`).
    var scorePercent: Double {
        guard latest != nil else { return 0 }
        return AdasEnum.scorePercent(enabled: enabledCount)
    }

    /// The score tone (web `scoreColor`).
    var scoreTone: SafetyTone {
        AdasEnum.scoreTone(percent: scorePercent)
    }

    /// `${fmtInt(scorePct)}%` (web gauge unit + Safety-Score MetricCard value).
    var scorePercentText: String {
        "\(SafetyFormat.int(scorePercent))%"
    }

    /// The nine ADAS feature cards (web `featureCards = buildFeatureCards(latest)`).
    var featureCards: [SafetyFeatureCard] {
        guard let latest else { return [] }
        return SafetyFeatureKind.allCases.map { $0.card(for: latest) }
    }

    /// The chart series, oldest first (web `chartData = toChartData(history)`).
    var chartPoints: [SafetyChartPoint] {
        history
            .sorted { ($0.createdAt ?? .distantPast) < ($1.createdAt ?? .distantPast) }
            .map { snapshot in
                SafetyChartPoint(
                    id: snapshot.id ?? 0,
                    time: snapshot.createdAt ?? Date(),
                    aeb: AdasEnum.isAebEnabled(snapshot.automaticEmergencyBrakingOff ?? false) ? 1 : 0,
                    bscw: (snapshot.blindSpotCollisionWarning ?? false) ? 1 : 0,
                    elda: (snapshot.emergencyLaneDepartureAvoidance ?? false) ? 1 : 0
                )
            }
    }

    /// Newest-first rows for the history table (web `sortedHistory`).
    var historyDescending: [SafetySnapshot] {
        history.sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
    }

    /// Distance since reset in the display unit (web `convertDistanceFromSI`).
    var distanceSinceResetText: String {
        guard let meters = latest?.milesSinceReset else { return "—" }
        return SafetyFormat.number(SafetyConvert.distanceFromSI(meters, to: distanceUnit))
    }

    /// Self-driving distance since reset in the display unit (web converter).
    var selfDrivingDistanceText: String {
        guard let meters = latest?.selfDrivingMilesSinceReset else { return "—" }
        return SafetyFormat.number(SafetyConvert.distanceFromSI(meters, to: distanceUnit))
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
}

// MARK: - Live safety-signal cells (web SignalCard inputs)

extension SafetySettingsPageModel {
    /// The four live-signal cells (web `Live Safety Signals` SignalCards), each
    /// resolving its em-dash fallback when the source flag is nil.
    var signalCells: [SafetySignalCellModel] {
        [
            SafetySignalCellModel(
                key: "driverBelt",
                systemImage: "person.fill.checkmark",
                value: beltText(security?.driverSeatBelt),
                label: safetyKey("safety.driverBelt", "Driver Belt"),
                positive: security?.driverSeatBelt
            ),
            SafetySignalCellModel(
                key: "passengerBelt",
                systemImage: "person.fill.checkmark",
                value: beltText(security?.passengerSeatBelt),
                label: safetyKey("safety.passengerBelt", "Passenger Belt"),
                positive: security?.passengerSeatBelt
            ),
            SafetySignalCellModel(
                key: "driverSeat",
                systemImage: "chair.lounge.fill",
                value: seatText(security?.driverSeatOccupied),
                label: safetyKey("safety.driverSeat", "Driver Seat"),
                positive: security?.driverSeatOccupied
            ),
            SafetySignalCellModel(
                key: "vehicleLock",
                systemImage: "lock.fill",
                value: lockText(security?.locked),
                label: safetyKey("safety.vehicleLock", "Vehicle Lock"),
                positive: security?.locked
            )
        ]
    }

    private func beltText(_ flag: Bool?) -> String {
        guard let flag else { return "—" }
        return flag ? safetyKey("safety.buckled", "Buckled") : safetyKey("safety.unbuckled", "Unbuckled")
    }

    private func seatText(_ flag: Bool?) -> String {
        guard let flag else { return "—" }
        return flag ? safetyKey("safety.occupied", "Occupied") : safetyKey("safety.empty", "Empty")
    }

    private func lockText(_ flag: Bool?) -> String {
        guard let flag else { return "—" }
        return flag ? safetyKey("safety.locked", "Locked") : safetyKey("safety.unlocked", "Unlocked")
    }
}

/// One live-signal card's view input (web `SignalCard` props).
struct SafetySignalCellModel: Identifiable, Equatable, Sendable {
    let key: String
    let systemImage: String
    let value: String
    let label: String
    /// Tri-state: true → green, false → red, nil → neutral (web `positive`).
    let positive: Bool?

    var id: String { key }

    var tone: SafetyTone {
        switch positive {
        case .some(true): return .success
        case .some(false): return .danger
        case .none: return .neutral
        }
    }
}

// MARK: - Lifecycle + actions

extension SafetySettingsPageModel {
    /// Initial load: vehicles for the selector, then the security + safety set.
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

    /// Re-fetch the latest snapshot, history and live signals for the vehicle.
    func reloadData(initial: Bool) async {
        let vehicleID = selectedVehicleID
        guard vehicleID > 0 else {
            latest = nil
            history = []
            security = nil
            viewState = .empty
            return
        }

        if initial { viewState = .loading }
        inlineErrorMessage = nil

        security = await useSecurityLatest(vehicleID: vehicleID)
        latest = await useSafetyLatest(vehicleID: vehicleID)
        history = await useSafetyHistory(vehicleID: vehicleID, limit: historyLimit)

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

    private func resolveState() -> SafetySettingsViewState {
        latest == nil ? .empty : .success
    }
}
