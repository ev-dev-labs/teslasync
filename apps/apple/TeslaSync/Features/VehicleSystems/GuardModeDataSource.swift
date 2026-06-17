//
//  GuardModeDataSource.swift
//  TeslaSync — P4 feature view · P7 · GuardMode (Apple) — Data Source seam
//
//  The single KMP-core seam (ADR-004). Every method keeps its web TanStack hook
//  name so the call sites in `GuardModePageModel` read identically to the React
//  page. Today each method resolves from an in-memory backing store; when the
//  generated client lands (P1/S2-S3) only these bodies change — the view and the
//  derived state above stay untouched.
//

import Foundation

// MARK: - Hook-named data methods (web parity at the call site)

extension GuardModePageModel {
    /// Vehicle list for the selector (web `useSelectedVehicle` roster).
    func loadVehicles() async -> [GuardModeVehicle] {
        GuardModeMockData.vehicles
    }

    /// `useGuardConfig` → GET /vehicles/{vehicleId}/guard
    func useGuardConfig(vehicleID: Int64) async -> GuardModeConfig? {
        seedBackingIfNeeded(vehicleID: vehicleID)
        return backingConfig
    }

    /// `useGuardEvents` → GET /vehicles/{vehicleId}/guard/events
    func useGuardEvents(vehicleID: Int64) async -> [GuardModeEvent] {
        seedBackingIfNeeded(vehicleID: vehicleID)
        return backingEvents.sorted { $0.ts > $1.ts }
    }

    /// `useVehicleState` → GET /vehicles/{vehicleId}/state (position + lock/sentry)
    func useVehicleState(vehicleID: Int64) async -> GuardModeVehicleSnapshot? {
        GuardModeMockData.vehicleState
    }

    /// `useGeofences` → GET /geofences
    func useGeofences() async -> [GuardModeGeofence] {
        GuardModeMockData.geofences
    }

    /// `useSetGuardConfig` → POST /vehicles/{vehicleId}/guard
    func useSetGuardConfig(
        vehicleID: Int64,
        enabled: Bool,
        homeGeofenceID: Int64?,
        sensitivity: GuardModeSensitivity,
        autoPanic: Bool
    ) async {
        seedBackingIfNeeded(vehicleID: vehicleID)
        backingConfig = GuardModeConfig(
            vehicleID: vehicleID,
            enabled: enabled,
            homeGeofenceID: homeGeofenceID,
            sensitivity: sensitivity,
            autoPanic: autoPanic,
            createdAt: backingConfig?.createdAt ?? Date(),
            updatedAt: Date()
        )
    }

    /// `useGuardPanic` → POST /vehicles/{vehicleId}/guard/panic
    func useGuardPanic(vehicleID: Int64) async {
        seedBackingIfNeeded(vehicleID: vehicleID)
        let panicEvent = GuardModeEvent(
            id: nextEventID(),
            vehicleID: vehicleID,
            ts: Date(),
            eventType: "manual_panic",
            fromState: nil,
            toState: "panic",
            acknowledgedAt: nil,
            acknowledgedBy: nil
        )
        backingEvents.insert(panicEvent, at: 0)
    }

    /// `useAcknowledgeGuardEvent`
    /// → POST /vehicles/{vehicleId}/guard/events/{eventId}/acknowledge
    func useAcknowledgeGuardEvent(vehicleID: Int64, eventID: Int64) async {
        guard let index = backingEvents.firstIndex(where: { $0.id == eventID }) else { return }
        let original = backingEvents[index]
        backingEvents[index] = GuardModeEvent(
            id: original.id,
            vehicleID: original.vehicleID,
            ts: original.ts,
            eventType: original.eventType,
            fromState: original.fromState,
            toState: original.toState,
            acknowledgedAt: Date(),
            acknowledgedBy: GuardModeMockData.acknowledger
        )
    }

    private func seedBackingIfNeeded(vehicleID: Int64) {
        guard !didSeedBacking else { return }
        didSeedBacking = true
        backingConfig = GuardModeMockData.config(vehicleID: vehicleID)
        backingEvents = GuardModeMockData.events(vehicleID: vehicleID)
    }

    private func nextEventID() -> Int64 {
        (backingEvents.map(\.id).max() ?? 0) + 1
    }
}

// MARK: - Mock fixtures (one-screen sample; replaced by the live client)

enum GuardModeMockData {
    static let acknowledger = "owner"

    static let vehicles: [GuardModeVehicle] = [
        GuardModeVehicle(id: 1, displayName: "Model 3"),
        GuardModeVehicle(id: 2, displayName: "Model Y")
    ]

    static let vehicleState = GuardModeVehicleSnapshot(
        latitude: 37.7749,
        longitude: -122.4194,
        isLocked: true,
        sentryMode: true
    )

    static let geofences: [GuardModeGeofence] = [
        GuardModeGeofence(id: 1, name: "Home", latitude: 37.7752, longitude: -122.4189, radius: 150),
        GuardModeGeofence(id: 2, name: "Work", latitude: 37.7935, longitude: -122.3970, radius: 120)
    ]

    static func config(vehicleID: Int64) -> GuardModeConfig {
        GuardModeConfig(
            vehicleID: vehicleID,
            enabled: true,
            homeGeofenceID: 1,
            sensitivity: .medium,
            autoPanic: false,
            createdAt: Date().addingTimeInterval(-86_400 * 30),
            updatedAt: Date().addingTimeInterval(-3_600)
        )
    }

    static func events(vehicleID: Int64) -> [GuardModeEvent] {
        [
            GuardModeEvent(
                id: 3,
                vehicleID: vehicleID,
                ts: Date().addingTimeInterval(-1_800),
                eventType: "sentry_mode",
                fromState: "off",
                toState: "on",
                acknowledgedAt: Date().addingTimeInterval(-1_700),
                acknowledgedBy: acknowledger
            ),
            GuardModeEvent(
                id: 2,
                vehicleID: vehicleID,
                ts: Date().addingTimeInterval(-7_200),
                eventType: "locked",
                fromState: "unlocked",
                toState: "locked",
                acknowledgedAt: Date().addingTimeInterval(-7_100),
                acknowledgedBy: acknowledger
            ),
            GuardModeEvent(
                id: 1,
                vehicleID: vehicleID,
                ts: Date().addingTimeInterval(-86_400),
                eventType: "test_alert",
                fromState: nil,
                toState: nil,
                acknowledgedAt: nil,
                acknowledgedBy: nil
            )
        ]
    }
}
