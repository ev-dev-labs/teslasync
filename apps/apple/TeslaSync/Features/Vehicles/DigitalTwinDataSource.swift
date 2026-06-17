//
//  DigitalTwinDataSource.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/DigitalTwin (Apple) — KMP-core seam
//
//  The single data seam for the DigitalTwin page (ADR-004). Each method keeps its web TanStack
//  hook name so the call sites in `DigitalTwinPageModel` read like the React page:
//    • `useVehicles`                → GET /vehicles            (the selectable fleet)
//    • `useVehicleState`            → GET /vehicles/{id}/state  ({ state, live })
//    • `useSecurityLatest`          → GET /security/latest [vehicle_id]
//    • `useChargingTelemetryLatest` → GET /charging-telemetry/latest [vehicle_id]
//  The per-vehicle methods return the module's value-typed twin inputs (`Twin*Input`, the shapes
//  `TwinStateBuilder.buildTwinState` consumes — the Swift port of `lib/vehicleState.ts`), so the
//  model merges them exactly as the web page does. Today the sample implementations resolve from
//  in-memory fixtures; when the generated KMP client lands (P1/S2-S3) only these bodies change —
//  the model, the panels, and the view stay untouched.
//

import Foundation

// MARK: - Vehicle-state snapshot (web `useVehicleState` → `{ state, live }`)

/// The `/vehicles/{id}/state` projection the page reads: the merged vehicle-state input (or `nil`
/// when the endpoint has not hydrated) plus the `live` freshness flag the page badge consults.
struct DigitalTwinStateSnapshot: Sendable, Equatable {
    let state: TwinVehicleStateInput?
    let live: Bool

    static let absent = DigitalTwinStateSnapshot(state: nil, live: false)
}

// MARK: - Seam protocol (web hooks kept by name)

/// Async data seam for `DigitalTwinPage`, mirroring the page's four web hooks. The production app
/// implements this over the generated KMP client + the P1/S8 state holders; previews and tests use
/// the in-memory doubles below.
protocol DigitalTwinDataSource: Sendable {
    /// `useVehicles()` → `GET /vehicles`. The selectable fleet (web `VehicleSelect` source).
    func useVehicles() async throws -> [DigitalTwinWidgetTwinVehicle]

    /// `useVehicleState(vehicleId)` → `GET /vehicles/{id}/state`. The `{ state, live }` snapshot.
    func useVehicleState(vehicleID: Int) async throws -> DigitalTwinStateSnapshot

    /// `useSecurityLatest(vehicleId)` → `GET /security/latest`. `nil` ⇒ the doors / windows panels
    /// render their empty state (web `securityData ? <KVList> : <EmptyState>`).
    func useSecurityLatest(vehicleID: Int) async throws -> TwinSecurityInput?

    /// `useChargingTelemetryLatest(vehicleId)` → `GET /charging-telemetry/latest`. The live charge feed.
    func useChargingTelemetryLatest(vehicleID: Int) async throws -> TwinChargingInput?
}

// MARK: - Sample seam (one representative charging vehicle; replaced by the live client)

/// A representative fleet of one charging vehicle with a mixed physical state (trunk + one window
/// open, locked, sentry armed), so the success state, the badge, and every detail row render with
/// real content. Used for the default screen, previews, and the success-state gate evidence.
struct SampleDigitalTwinDataSource: DigitalTwinDataSource {
    var vehicles: [DigitalTwinWidgetTwinVehicle] = [
        DigitalTwinWidgetTwinVehicle(id: 7, displayName: "Garage Rocket", vin: "5YJ3E1EA7KF000007",
                                     exteriorColor: "DeepBlue"),
        DigitalTwinWidgetTwinVehicle(id: 9, displayName: "Road Tripper", vin: "5YJSA1E26HF000009",
                                     exteriorColor: "PearlWhite")
    ]

    func useVehicles() async throws -> [DigitalTwinWidgetTwinVehicle] { vehicles }

    func useVehicleState(vehicleID: Int) async throws -> DigitalTwinStateSnapshot {
        DigitalTwinStateSnapshot(
            state: TwinVehicleStateInput(
                state: "online", speed: 0, isCharging: true, chargerPower: 11_000,
                isLocked: true, sentryMode: true
            ),
            live: true
        )
    }

    func useSecurityLatest(vehicleID: Int) async throws -> TwinSecurityInput? {
        TwinSecurityInput(
            doorState: .fields([
                "DriverFront": false, "PassengerFront": false,
                "DriverRear": false, "PassengerRear": false,
                "TrunkFront": false, "TrunkRear": true
            ]),
            fdWindow: "Closed", fpWindow: "Open", rdWindow: "Closed", rpWindow: "Partial",
            locked: true, sentryMode: true,
            lightsHighBeams: false, lightsHazardsActive: false, lightsTurnSignal: "Off",
            driverSeatOccupied: false, createdAt: Date(timeIntervalSinceNow: -30)
        )
    }

    func useChargingTelemetryLatest(vehicleID: Int) async throws -> TwinChargingInput? {
        TwinChargingInput(chargingState: "Charging", chargerPowerKw: 11, chargePortDoorOpen: true)
    }
}

// MARK: - Signalless seam (vehicle present, no security feed → panel empty states)

/// A vehicle with no security / charging feed yet — exercises the doors / windows panels' empty
/// data state (web `securityData ? <KVList> : <EmptyState>`) and the security panel's `'—'` rows.
struct SignallessDigitalTwinDataSource: DigitalTwinDataSource {
    func useVehicles() async throws -> [DigitalTwinWidgetTwinVehicle] {
        [DigitalTwinWidgetTwinVehicle(id: 7, displayName: "Garage Rocket", exteriorColor: "DeepBlue")]
    }

    func useVehicleState(vehicleID: Int) async throws -> DigitalTwinStateSnapshot { .absent }
    func useSecurityLatest(vehicleID: Int) async throws -> TwinSecurityInput? { nil }
    func useChargingTelemetryLatest(vehicleID: Int) async throws -> TwinChargingInput? { nil }
}

// MARK: - Empty seam (no vehicles → page empty data state)

/// `useVehicles` returns no vehicles — exercises the page's empty data state (web `noVehicles`).
struct EmptyDigitalTwinDataSource: DigitalTwinDataSource {
    func useVehicles() async throws -> [DigitalTwinWidgetTwinVehicle] { [] }
    func useVehicleState(vehicleID: Int) async throws -> DigitalTwinStateSnapshot { .absent }
    func useSecurityLatest(vehicleID: Int) async throws -> TwinSecurityInput? { nil }
    func useChargingTelemetryLatest(vehicleID: Int) async throws -> TwinChargingInput? { nil }
}

// MARK: - Failing seam (vehicles fetch throws → error data state)

/// The `useVehicles` fetch fails — exercises the page's error data state + Retry.
struct FailingDigitalTwinDataSource: DigitalTwinDataSource {
    func useVehicles() async throws -> [DigitalTwinWidgetTwinVehicle] {
        throw DigitalTwinError.vehiclesUnavailable
    }

    func useVehicleState(vehicleID: Int) async throws -> DigitalTwinStateSnapshot {
        throw DigitalTwinError.vehiclesUnavailable
    }

    func useSecurityLatest(vehicleID: Int) async throws -> TwinSecurityInput? {
        throw DigitalTwinError.vehiclesUnavailable
    }

    func useChargingTelemetryLatest(vehicleID: Int) async throws -> TwinChargingInput? {
        throw DigitalTwinError.vehiclesUnavailable
    }
}

// MARK: - Errors

/// Seam errors surfaced to the model and projected into the localized error data state.
enum DigitalTwinError: Error, LocalizedError {
    case vehiclesUnavailable

    var errorDescription: String? {
        String(
            localized: "translation.digitalTwin.loadError",
            defaultValue: "Could not load vehicle state."
        )
    }
}
