//
//  GeofencesPageDataSource.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — Data Source seam
//
//  The single KMP-core seam (ADR-004). Each method keeps its web TanStack
//  query/mutation shape so the call sites in `GeofencesPageModel` read like the
//  React page: `useGeofences` → GET /geofences, `useVehicles` → GET /vehicles,
//  `usePinned` → GET /pinned{?type}, `useBulkGeofencesDelete` → POST
//  /geofences/bulk, the create/update/delete/toggle/rename mutations →
//  POST/PUT/DELETE /geofences{/id}, `useVehiclePositions` →
//  GET /vehicles/{id}/positions, and `reverseGeocode` → GET /geocode/reverse.
//  Today the bodies resolve from a deterministic in-memory store (so every panel,
//  card, map marker and CRUD path renders without a backend); when the generated
//  client lands (P1/S2-S3) only this file changes — the view + model never touch
//  the network. Coordinates/radius are SI (metres), exactly as the wire serves.
//

import CoreLocation
import Foundation

// MARK: - Mutation outcome (web mutation result)

/// The result of a create/update/delete/toggle/rename/bulk mutation. `failed`
/// carries the message surfaced by the web error toast.
enum GeofencesMutationOutcome: Equatable {
    case success
    case failed(String)
}

// MARK: - Device-location errors (web geolocation failure surfaces)

/// The "Use Current Location" failure modes, mapped to the web toast strings.
enum GeofencesLocationError: Error, Equatable {
    /// No position sample for the chosen vehicle (web `geofences.noPosition`).
    case noPosition
    /// The user denied device-location access (web `geofences.locationDenied`).
    case denied
    /// Any other device-location failure (web `geofences.locationFailed`).
    case failed
}

// MARK: - Hook-named data methods (web parity at the call site)

extension GeofencesPageModel {
    /// `useQuery(['geofences'])` → GET /geofences (the primary list).
    func useGeofences() async -> [GeofenceZone] {
        GeofencesMockStore.shared.all()
    }

    /// `useVehicles` → GET /vehicles (the location-source roster).
    func useVehicles() async -> [GeofencesVehicle] {
        GeofencesMockStore.shared.vehicles
    }

    /// `usePinned('geofence')` → GET /pinned{?type} (pin ordering).
    func usePinned(_ type: String) async -> [GeofencesPinnedItem] {
        GeofencesMockStore.shared.pins(type: type)
    }

    /// `useBulkGeofencesDelete` → POST /geofences/bulk (delete by int64 ids).
    func useBulkGeofencesDelete(_ ids: [Int64]) async -> GeofencesMutationOutcome {
        GeofencesMockStore.shared.bulkDelete(ids)
        return .success
    }

    /// `createMut` → POST /geofences.
    func createGeofence(_ payload: GeofenceZonePayload) async -> GeofencesMutationOutcome {
        GeofencesMockStore.shared.create(payload)
        return .success
    }

    /// `updateMut` → PUT /geofences/{id}.
    func updateGeofence(id: String, payload: GeofenceZonePayload) async -> GeofencesMutationOutcome {
        GeofencesMockStore.shared.update(id: id, payload: payload)
        return .success
    }

    /// `deleteMut` → DELETE /geofences/{id}.
    func deleteGeofence(id: String) async -> GeofencesMutationOutcome {
        GeofencesMockStore.shared.delete(id: id)
        return .success
    }

    /// `toggleMut` → PUT /geofences/{id} `{ enabled }`.
    func toggleGeofence(id: String, enabled: Bool) async -> GeofencesMutationOutcome {
        GeofencesMockStore.shared.setEnabled(id: id, enabled: enabled)
        return .success
    }

    /// `renameMut` → PUT /geofences/{id} (full merged payload + new name).
    func renameGeofence(id: String, name: String) async -> GeofencesMutationOutcome {
        GeofencesMockStore.shared.rename(id: id, name: name)
        return .success
    }

    /// `request<Position[]>('/vehicles/{id}/positions?limit=1')` — last position.
    func useVehiclePositions(vehicleID: Int64) async -> [GeofencesVehiclePosition] {
        GeofencesMockStore.shared.positions(vehicleID: vehicleID)
    }

    /// `request<ReverseGeocodeResult>('/geocode/reverse?lat=&lon=')` — falls back to
    /// the formatted coordinate pair when the lookup has no display name (web).
    func reverseGeocode(latitude: Double, longitude: Double) async -> String {
        GeofencesMockStore.shared.reverseGeocode(latitude: latitude, longitude: longitude)
            ?? GeofencesFormat.coordinate(latitude: latitude, longitude: longitude)
    }
}

// MARK: - Mutable in-memory store (the mock "backend" + query cache)

/// A deterministic, mutable geofence store so every CRUD path (create / update /
/// delete / toggle / rename / bulk-delete) round-trips and the list re-reads the
/// updated set — exactly as the web query cache does after `invalidateQueries`.
/// Replaced wholesale by the generated client (P1/S2-S3).
@MainActor
final class GeofencesMockStore {
    static let shared = GeofencesMockStore()

    private var zones: [GeofenceZone]
    private var nextID: Int

    let vehicles: [GeofencesVehicle] = [
        GeofencesVehicle(id: 1, vin: "5YJ3E1EA7KF000111", displayName: "Model 3"),
        GeofencesVehicle(id: 2, vin: "7SAYGDEE9PF000222", displayName: "Model Y")
    ]

    private init() {
        zones = GeofencesMockStore.seed
        nextID = zones.count + 1
    }

    func all() -> [GeofenceZone] {
        zones
    }

    func pins(type: String) -> [GeofencesPinnedItem] {
        guard type == "geofence" else { return [] }
        // The Supercharger fence is pinned to the top (web pin ordering).
        return [GeofencesPinnedItem(itemID: "5", position: 0)]
    }

    func create(_ payload: GeofenceZonePayload) {
        let zone = GeofenceZone(
            id: String(nextID),
            name: payload.name,
            latitude: payload.latitude,
            longitude: payload.longitude,
            radius: payload.radius,
            alertOnEntry: payload.alertOnEntry,
            alertOnExit: payload.alertOnExit,
            enabled: payload.enabled,
            costPerKwh: payload.costPerKwh,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
        zones.append(zone)
        nextID += 1
    }

    func update(id: String, payload: GeofenceZonePayload) {
        guard let index = zones.firstIndex(where: { $0.id == id }) else { return }
        let existing = zones[index]
        zones[index] = GeofenceZone(
            id: existing.id,
            name: payload.name,
            latitude: payload.latitude,
            longitude: payload.longitude,
            radius: payload.radius,
            alertOnEntry: payload.alertOnEntry,
            alertOnExit: payload.alertOnExit,
            enabled: payload.enabled,
            costPerKwh: payload.costPerKwh,
            createdAt: existing.createdAt
        )
    }

    func delete(id: String) {
        zones.removeAll { $0.id == id }
    }

    func bulkDelete(_ ids: [Int64]) {
        let wanted = Set(ids.map(String.init))
        zones.removeAll { wanted.contains($0.id) }
    }

    func setEnabled(id: String, enabled: Bool) {
        guard let index = zones.firstIndex(where: { $0.id == id }) else { return }
        zones[index] = zones[index].with(enabled: enabled)
    }

    func rename(id: String, name: String) {
        guard let index = zones.firstIndex(where: { $0.id == id }) else { return }
        zones[index] = zones[index].with(name: name)
    }

    func positions(vehicleID: Int64) -> [GeofencesVehiclePosition] {
        // A deterministic "last position" per vehicle so the Vehicle source resolves.
        switch vehicleID {
        case 1: [GeofencesVehiclePosition(latitude: 37.7749, longitude: -122.4194)]
        case 2: [GeofencesVehiclePosition(latitude: 37.3861, longitude: -122.0839)]
        default: []
        }
    }

    func reverseGeocode(latitude: Double, longitude: Double) -> String? {
        // The fixture geocoder names known seed coordinates; otherwise nil → the
        // caller falls back to the formatted coordinate pair (web behaviour).
        GeofencesMockStore.seed.first { zone in
            abs(zone.latitude - latitude) < 0.01 && abs(zone.longitude - longitude) < 0.01
        }?.name
    }

    /// Five deterministic fences spanning enabled/disabled and every alert kind so
    /// the stats cards, badges and list all render meaningfully.
    static let seed: [GeofenceZone] = [
        GeofenceZone(
            id: "1", name: "Home", latitude: 37.7749, longitude: -122.4194, radius: 150,
            alertOnEntry: true, alertOnExit: true, enabled: true, costPerKwh: 0.18,
            createdAt: "2026-01-04T08:00:00Z"
        ),
        GeofenceZone(
            id: "2", name: "Work", latitude: 37.3318, longitude: -122.0312, radius: 200,
            alertOnEntry: true, alertOnExit: false, enabled: true, costPerKwh: nil,
            createdAt: "2026-01-08T08:00:00Z"
        ),
        GeofenceZone(
            id: "3", name: "Gym", latitude: 37.4419, longitude: -122.1430, radius: 80,
            alertOnEntry: false, alertOnExit: true, enabled: false, costPerKwh: nil,
            createdAt: "2026-02-01T08:00:00Z"
        ),
        GeofenceZone(
            id: "4", name: "Airport", latitude: 37.6213, longitude: -122.3790, radius: 500,
            alertOnEntry: false, alertOnExit: false, enabled: true, costPerKwh: nil,
            createdAt: "2026-02-14T08:00:00Z"
        ),
        GeofenceZone(
            id: "5", name: "Supercharger — Mountain View", latitude: 37.3861, longitude: -122.0839,
            radius: 120, alertOnEntry: true, alertOnExit: true, enabled: true, costPerKwh: 0.31,
            createdAt: "2026-03-02T08:00:00Z"
        )
    ]
}

// MARK: - Immutable mutation helpers (avoid mutating `let` wire fields in place)

private extension GeofenceZone {
    func with(enabled: Bool) -> GeofenceZone {
        GeofenceZone(
            id: id, name: name, latitude: latitude, longitude: longitude, radius: radius,
            alertOnEntry: alertOnEntry, alertOnExit: alertOnExit, enabled: enabled,
            costPerKwh: costPerKwh, createdAt: createdAt
        )
    }

    func with(name: String) -> GeofenceZone {
        GeofenceZone(
            id: id, name: name, latitude: latitude, longitude: longitude, radius: radius,
            alertOnEntry: alertOnEntry, alertOnExit: alertOnExit, enabled: enabled,
            costPerKwh: costPerKwh, createdAt: createdAt
        )
    }
}

// MARK: - Device location (web `navigator.geolocation`)

/// The native peer of the web `browser` location source — a one-shot device
/// location via Core Location's async `CLLocationUpdate.liveUpdates()` (iOS 17+/
/// macOS 15+), mapping authorization/failure to the web toast strings.
enum GeofencesLocationProvider {
    /// Resolve the device's current coordinate once, or throw a
    /// `GeofencesLocationError` mapped to `denied` / `failed`.
    static func deviceLocation() async throws -> GeofencesVehiclePosition {
        do {
            for try await update in CLLocationUpdate.liveUpdates() {
                if update.authorizationDenied || update.authorizationRestricted {
                    throw GeofencesLocationError.denied
                }
                if let location = update.location {
                    return GeofencesVehiclePosition(
                        latitude: location.coordinate.latitude,
                        longitude: location.coordinate.longitude
                    )
                }
            }
            throw GeofencesLocationError.failed
        } catch let error as GeofencesLocationError {
            throw error
        } catch {
            throw GeofencesLocationError.failed
        }
    }
}
