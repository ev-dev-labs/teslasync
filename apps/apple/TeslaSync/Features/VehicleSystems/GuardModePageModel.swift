//
//  GuardModePageModel.swift
//  TeslaSync — P4 feature view · P7 · GuardMode (Apple) — View Model
//
//  Full parity with web/src/features/vehicle-systems/pages/GuardModePage.tsx.
//  An `@Observable` model that drives the view from the shared KMP core
//  repositories (ADR-004). The web TanStack hooks are kept under their original
//  names at the Swift call sites (`useGuardConfig`, `useGuardEvents`,
//  `useVehicleState`, `useGeofences`, `useSetGuardConfig`, `useGuardPanic`,
//  `useAcknowledgeGuardEvent`, `isGuardEventAcknowledged`). The KMP wiring is a
//  single seam: each method's body is the only place that changes when the
//  generated client lands (P1/S2-S3); the view never touches the network.
//

import CoreLocation
import Observation
import SwiftUI

// MARK: - Mutually-exclusive render branches (web shell loading / content / empty)

/// The four declared data states (loading · empty · error · success).
enum GuardModeViewState: Equatable {
    case loading
    case empty
    case error(String)
    case success
}

/// The armed/disarmed/triggered presentation of the guard toggle panel.
enum GuardModeArmState: Equatable {
    case disarmed
    case armed
    case triggered

    var title: String {
        switch self {
        case .triggered: return String(localized: "translation.guard.triggered", defaultValue: "TRIGGERED")
        case .armed: return String(localized: "translation.guard.armed", defaultValue: "Armed")
        case .disarmed: return String(localized: "translation.guard.disarmed", defaultValue: "Disarmed")
        }
    }

    var symbol: String {
        switch self {
        case .triggered: return "exclamationmark.shield.fill"
        case .armed: return "checkmark.shield.fill"
        case .disarmed: return "shield.slash.fill"
        }
    }

    var tint: Color {
        switch self {
        case .triggered: return .red
        case .armed: return .green
        case .disarmed: return .secondary
        }
    }
}

// MARK: - View Model

@MainActor
@Observable
final class GuardModePageModel {
    // Render state
    var viewState: GuardModeViewState = .loading

    // Source data (web hook results)
    private(set) var config: GuardModeConfig?
    private(set) var events: [GuardModeEvent] = []
    private(set) var geofences: [GuardModeGeofence] = []
    private(set) var vehicleState: GuardModeVehicleSnapshot?
    private(set) var vehicles: [GuardModeVehicle] = []

    // Selected vehicle (web useSelectedVehicle) — global across vehicle pages.
    var selectedVehicleID: Int64 = 0

    // Local form state (web useState) — seeded once from config.
    var panicDialogOpen = false
    var selectedSensitivity: GuardModeSensitivity = .medium
    var selectedGeofenceID: Int64 = 0
    var autoPanicEnabled = false

    // In-flight mutation flags (web `mutation.isPending`).
    private(set) var isSettingConfig = false
    private(set) var isPanicking = false
    private(set) var isAcknowledging = false

    // Live freshness (ADR-013) — `> 2 min` is treated as stale.
    private(set) var lastUpdated: Date?

    // Mock backing store (replaced by the KMP core repositories at integration).
    // Internal (not private) so the data-source extension in
    // GuardModeDataSource.swift can reach it.
    var backingConfig: GuardModeConfig?
    var backingEvents: [GuardModeEvent] = []
    var didSeedBacking = false
    private var didSeedForm = false

    init() {}
}

// MARK: - Derived state (web `useMemo` / inline derivations)

extension GuardModePageModel {
    var isArmed: Bool { config?.enabled ?? false }

    var unacknowledgedCount: Int {
        events.filter { !isGuardEventAcknowledged($0) }.count
    }

    var latestEvent: GuardModeEvent? { events.first }

    /// Web `isTriggered`: newest event is unacknowledged and not a test alert.
    var isTriggered: Bool {
        guard let latest = latestEvent else { return false }
        return !isGuardEventAcknowledged(latest) && latest.eventType != "test_alert"
    }

    var armState: GuardModeArmState {
        if isTriggered { return .triggered }
        return isArmed ? .armed : .disarmed
    }

    var hasLocation: Bool { vehicleState?.hasLocation ?? false }

    var vehicleCoordinate: CLLocationCoordinate2D? {
        guard hasLocation, let lat = vehicleState?.latitude, let lng = vehicleState?.longitude else {
            return nil
        }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    var homeGeofence: GuardModeGeofence? {
        guard selectedGeofenceID != 0 else { return nil }
        return geofences.first { $0.id == selectedGeofenceID }
    }

    var activeVehicleName: String {
        vehicles.first { $0.id == selectedVehicleID }?.displayName ?? ""
    }

    /// `> 2 min` since the last successful refresh (live staleness indicator).
    var isStale: Bool {
        guard let lastUpdated else { return false }
        return Date().timeIntervalSince(lastUpdated) > 120
    }

    var isLocked: Bool { vehicleState?.isLocked ?? false }
    var sentryActive: Bool { vehicleState?.sentryMode ?? false }

    /// Web `guard.armedSince` / `guard.notArmed`. The catalog stores the
    /// positional `%1$@` form, so the template is resolved first and the
    /// timestamp substituted with `String(format:)` (avoids specifier drift).
    var armedSinceText: String {
        if isArmed, let updatedAt = config?.updatedAt {
            let stamp = updatedAt.formatted(date: .abbreviated, time: .shortened)
            let template = String(
                localized: "translation.guard.armedSince",
                defaultValue: "Armed since %1$@"
            )
            return String(format: template, stamp)
        }
        return String(localized: "translation.guard.notArmed", defaultValue: "Not armed")
    }

    /// Web status-card alert summary: `guard.unackEvents` (count) or
    /// `guard.noEvents` when none are outstanding.
    var unacknowledgedSummary: String {
        guard unacknowledgedCount > 0 else {
            return String(localized: "translation.guard.noEvents", defaultValue: "No active alerts")
        }
        let template = String(
            localized: "translation.guard.unackEvents",
            defaultValue: "%1$@ unacknowledged event(s)"
        )
        return String(format: template, "\(unacknowledgedCount)")
    }
}

// MARK: - Lifecycle + actions

extension GuardModePageModel {
    /// Initial load: vehicles for the selector, then the guard data set.
    func load() async {
        viewState = .loading
        if vehicles.isEmpty {
            vehicles = await loadVehicles()
        }
        if selectedVehicleID == 0 {
            selectedVehicleID = vehicles.first?.id ?? 0
        }
        await reloadGuardData()
    }

    /// Pull-to-refresh — reloads data, preserving any in-progress form edits.
    func refresh() async {
        await reloadGuardData()
    }

    /// Re-fetch all four sources for the active vehicle.
    func reloadGuardData() async {
        let vehicleID = selectedVehicleID
        let loadedConfig = await useGuardConfig(vehicleID: vehicleID)
        let loadedEvents = await useGuardEvents(vehicleID: vehicleID)
        let loadedState = await useVehicleState(vehicleID: vehicleID)
        let loadedGeofences = await useGeofences()

        config = loadedConfig
        events = loadedEvents
        vehicleState = loadedState
        geofences = loadedGeofences

        seedFormIfNeeded()
        lastUpdated = Date()
        viewState = resolveState()
    }

    /// Switch the active vehicle (web vehicle selector `onChange`).
    func selectVehicle(_ vehicleID: Int64) async {
        guard vehicleID != selectedVehicleID else { return }
        selectedVehicleID = vehicleID
        didSeedForm = false
        await reloadGuardData()
    }

    /// Web `handleToggleGuard` — flips armed state via `useSetGuardConfig`.
    func toggleGuard() async {
        guard selectedVehicleID > 0 else { return }
        await applyConfig(enabled: !isArmed)
    }

    /// Web `handleSaveSettings` — persists the form without changing armed state.
    func saveSettings() async {
        guard selectedVehicleID > 0 else { return }
        await applyConfig(enabled: isArmed)
    }

    /// Web `handlePanic` — confirmed panic activation.
    func confirmPanic() async {
        panicDialogOpen = false
        guard selectedVehicleID > 0 else { return }
        isPanicking = true
        await useGuardPanic(vehicleID: selectedVehicleID)
        events = await useGuardEvents(vehicleID: selectedVehicleID)
        viewState = resolveState()
        isPanicking = false
    }

    /// Web `handleAcknowledge` — acknowledges a single event.
    func acknowledge(_ eventID: Int64) async {
        guard selectedVehicleID > 0 else { return }
        isAcknowledging = true
        await useAcknowledgeGuardEvent(vehicleID: selectedVehicleID, eventID: eventID)
        events = await useGuardEvents(vehicleID: selectedVehicleID)
        viewState = resolveState()
        isAcknowledging = false
    }

    private func applyConfig(enabled: Bool) async {
        isSettingConfig = true
        await useSetGuardConfig(
            vehicleID: selectedVehicleID,
            enabled: enabled,
            homeGeofenceID: selectedGeofenceID == 0 ? nil : selectedGeofenceID,
            sensitivity: selectedSensitivity,
            autoPanic: autoPanicEnabled
        )
        config = await useGuardConfig(vehicleID: selectedVehicleID)
        lastUpdated = Date()
        viewState = resolveState()
        isSettingConfig = false
    }

    private func seedFormIfNeeded() {
        guard !didSeedForm, let config else { return }
        selectedSensitivity = config.sensitivity
        selectedGeofenceID = config.homeGeofenceID ?? 0
        autoPanicEnabled = config.autoPanic
        didSeedForm = true
    }

    private func resolveState() -> GuardModeViewState {
        if config == nil, events.isEmpty, vehicleState == nil {
            return .empty
        }
        return .success
    }
}
