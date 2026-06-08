//
//  InboxBody.Resolve.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  Row-context resolvers for `InboxBodyModel` — the native mirror of the web
//  `ruleMap` / `vehicleMap` lookups and the per-row derivations the inbox feeds
//  each `NotificationRow` (its rule, vehicle, severity, drill-through target,
//  relative-time label, context-menu items, and VoiceOver summary). Pulled into
//  their own file so the row views stay presentation-only and the resolution is
//  unit-tested through the store.
//

import Foundation

public extension InboxBodyModel {
    /// Web `ruleMap` — alert-rule id → rule.
    var ruleMap: [Int: InboxRule] {
        Dictionary(rules.map { ($0.id, $0) }) { first, _ in first }
    }

    /// Web `vehicleMap` — vehicle id → vehicle.
    var vehicleMap: [Int: InboxVehicle] {
        Dictionary(vehicles.map { ($0.id, $0) }) { first, _ in first }
    }

    /// Web `log.alert_id != null ? ruleMap[log.alert_id] : undefined`.
    func rule(for notification: InboxNotification) -> InboxRule? {
        guard let alertId = notification.alertId else { return nil }
        return ruleMap[alertId]
    }

    /// Web `rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined`.
    func vehicle(for notification: InboxNotification) -> InboxVehicle? {
        guard let vehicleId = rule(for: notification)?.vehicleId else { return nil }
        return vehicleMap[vehicleId]
    }

    /// Web `rule?.severity ?? 'info'` (falling back to the row's own severity).
    func severity(for notification: InboxNotification) -> InboxSeverity {
        InboxSeverity.parse(rule(for: notification)?.severity ?? notification.severity)
    }

    /// Web `rule ? getAlertDrillthroughHref(synthetic) : null`.
    func drillTarget(for notification: InboxNotification) -> InboxDrillTarget? {
        InboxDrillthrough.rowTarget(
            notification: notification,
            rule: rule(for: notification),
            vehicle: vehicle(for: notification)
        )
    }

    /// The row's relative-time label (web `<DateTime value={created_at} />`).
    func relativeTime(for notification: InboxNotification, now: Date = Date()) -> String {
        guard let date = InboxDateFormat.parseDate(notification.createdAt) else { return InboxDateFormat.dash }
        return InboxDateFormat.relative(for: date, relativeTo: now)
    }

    /// The row's context-menu items (web `buildRowContextMenu`).
    func rowMenuItems(for notification: InboxNotification) -> [InboxRowMenuItem] {
        InboxProjection.rowMenuItems(
            notification: notification,
            rule: rule(for: notification),
            target: drillTarget(for: notification)
        )
    }

    /// The row's combined VoiceOver summary.
    func rowAccessibility(for notification: InboxNotification, now: Date = Date()) -> String {
        InboxAccessibility.rowSummary(
            notification: notification,
            rule: rule(for: notification),
            vehicle: vehicle(for: notification),
            relativeTime: relativeTime(for: notification, now: now),
            localize
        )
    }
}
