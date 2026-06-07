import Foundation
#if canImport(WidgetKit)
    import WidgetKit
#endif

/// The app-side writer that bridges the P4/P7 page state holders to the widgets.
///
/// When a holder refreshes (vehicle state, charging, drives, alerts, energy, system
/// health), it maps its SI values to display strings using the app's unit
/// preferences/formatters and hands the resulting summaries here. The publisher
/// re-applies privacy redaction as a safety net, persists the envelope to the App
/// Group store, and asks WidgetKit to reload — the only honest way to refresh a
/// widget (no background SSE lives in the extension).
///
/// It is intentionally free of KMP/`Shared` symbols so it is fully unit-testable and
/// stable against the deferred shared-core bootstrap.
public struct WidgetSnapshotPublisher: Sendable {
    private let store: WidgetSnapshotStore
    private let reload: @Sendable () -> Void

    public init(
        store: WidgetSnapshotStore = WidgetSnapshotStore(),
        reload: @escaping @Sendable () -> Void = WidgetSnapshotPublisher.defaultReload
    ) {
        self.store = store
        self.reload = reload
    }

    /// Redacts, persists, and reloads. Returns `false` (without reloading) if the
    /// snapshot could not be written, so a caller can log the miss.
    @discardableResult
    public func publish(_ snapshot: TeslaSyncWidgetSnapshot) -> Bool {
        let safe = Self.redacted(snapshot)
        do {
            try store.save(safe)
            reload()
            return true
        } catch {
            return false
        }
    }

    /// Drops the cached payload (e.g. on sign-out) and reloads so no stale PII is
    /// shown to a signed-out user.
    public func clear() {
        store.clear()
        reload()
    }

    /// Re-applies redaction to the free-text fields that could carry a VIN or raw
    /// coordinates, regardless of what the caller passed.
    static func redacted(_ snapshot: TeslaSyncWidgetSnapshot) -> TeslaSyncWidgetSnapshot {
        TeslaSyncWidgetSnapshot(
            schemaVersion: snapshot.schemaVersion,
            generatedAt: snapshot.generatedAt,
            vehicle: snapshot.vehicle.map(redactVehicle),
            charging: snapshot.charging,
            recentDrive: snapshot.recentDrive.map(redactDrive),
            alerts: snapshot.alerts.map(redactAlert),
            energy: snapshot.energy,
            systemHealth: snapshot.systemHealth,
            climateSecurity: snapshot.climateSecurity
        )
    }

    private static func redactVehicle(_ vehicle: VehicleStatusSummary) -> VehicleStatusSummary {
        VehicleStatusSummary(
            vehicleName: WidgetRedaction.vehicleName(vehicle.vehicleName),
            batteryFraction: vehicle.batteryFraction,
            batteryDisplay: vehicle.batteryDisplay,
            rangeDisplay: vehicle.rangeDisplay,
            isCharging: vehicle.isCharging,
            isPluggedIn: vehicle.isPluggedIn,
            locationLabel: WidgetRedaction.coarseLocation(vehicle.locationLabel),
            sampledAt: vehicle.sampledAt
        )
    }

    private static func redactDrive(_ drive: RecentDriveSummary) -> RecentDriveSummary {
        RecentDriveSummary(
            title: WidgetRedaction.vehicleName(drive.title, fallback: "Drive"),
            distanceDisplay: drive.distanceDisplay,
            durationDisplay: drive.durationDisplay,
            efficiencyDisplay: drive.efficiencyDisplay,
            endedAt: drive.endedAt,
            sampledAt: drive.sampledAt
        )
    }

    private static func redactAlert(_ alert: AlertSummary) -> AlertSummary {
        AlertSummary(
            openCount: alert.openCount,
            criticalCount: alert.criticalCount,
            latestTitle: alert.latestTitle.map { WidgetRedaction.stripVIN($0) },
            sampledAt: alert.sampledAt
        )
    }

    /// Reloads every TeslaSync widget timeline. No-op where WidgetKit is absent.
    public static let defaultReload: @Sendable () -> Void = {
        #if canImport(WidgetKit)
            WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
