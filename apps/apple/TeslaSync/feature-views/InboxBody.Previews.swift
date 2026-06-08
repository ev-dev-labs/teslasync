//
//  InboxBody.Previews.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  Xcode previews for each surface state (loading / flat content / grouped
//  content / empty inbox / empty archived / error / stale / offline / selection).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope. The sample data is shaped like the web `NotificationLog` /
//  `NotificationLogGroup` / `AlertRule` / `Vehicle` payloads, driven through the
//  in-memory source with a no-op mutation double.
//

import Foundation
import SwiftUI

#if DEBUG
    /// No-op mutation seam for previews (no network, no side effects).
    @MainActor
    private final class PreviewInboxActions: InboxActionsPerforming {
        func markRead(_: [Int]) {}
        func markUnread(_: [Int]) {}
        func archive(_: [Int]) async {}
        func unarchive(_: [Int]) async {}
        func delete(_: [Int]) async {}
        func bulkMarkRead(_ request: InboxBulkMarkReadRequest) async throws -> Int {
            request.ids?.count ?? 0
        }
    }

    /// Representative inbox data for previews/tests (no network).
    enum InboxSample {
        static func iso(daysAgo: Int, hour: Int = 9) -> String {
            let calendar = Calendar.current
            let midnight = calendar.startOfDay(for: Date())
            let day = calendar.date(byAdding: .day, value: -daysAgo, to: midnight) ?? midnight
            let stamped = calendar.date(byAdding: .hour, value: hour, to: day) ?? day
            return ISO8601DateFormatter().string(from: stamped)
        }

        static let vehicles: [InboxVehicle] = [
            InboxVehicle(id: 1, displayName: "Model Y"),
            InboxVehicle(id: 2, displayName: "Model 3")
        ]

        static let rules: [InboxRule] = [
            InboxRule(id: 10, name: "Low battery", severity: "warn", vehicleId: 1, signalName: "BatteryLevel"),
            InboxRule(id: 11, name: "Sentry triggered", severity: "critical", vehicleId: 2, signalName: "SentryMode"),
            InboxRule(id: 12, name: "Charging complete", severity: "info", vehicleId: 1, signalName: "ChargeState")
        ]

        static func rows() -> [InboxNotification] {
            [
                InboxNotification(
                    id: 1, alertId: 10, title: "Battery at 18%",
                    message: "Model Y dropped below the 20% threshold.", createdAt: iso(daysAgo: 0, hour: 8)
                ),
                InboxNotification(
                    id: 2, alertId: 11, title: "Sentry event recorded",
                    message: "Motion detected near the driver door.",
                    createdAt: iso(daysAgo: 0, hour: 6), readAt: iso(daysAgo: 0, hour: 7)
                ),
                InboxNotification(
                    id: 3, alertId: 12, title: "Charging complete",
                    message: "Model Y reached the 80% charge limit.", createdAt: iso(daysAgo: 1, hour: 22)
                )
            ]
        }

        static func groups() -> [InboxGroup] {
            [
                InboxGroup(
                    groupKey: "grp-low-batt", latest: rows()[0], count: 4, unreadCount: 3,
                    vehicleIds: [1, 2],
                    members: [
                        InboxNotification(
                            id: 21,
                            alertId: 10,
                            title: "Battery at 19%",
                            createdAt: iso(daysAgo: 0, hour: 5)
                        ),
                        InboxNotification(
                            id: 22,
                            alertId: 10,
                            title: "Battery at 22%",
                            createdAt: iso(daysAgo: 1, hour: 23)
                        )
                    ]
                ),
                InboxGroup(groupKey: nil, latest: rows()[1], count: 1, unreadCount: 0)
            ]
        }
    }

    @MainActor
    private func previewModel(
        _ update: InboxUpdate,
        archived: Bool = false,
        view: InboxViewMode = .grouped,
        selecting: [Int] = []
    ) -> InboxBodyModel {
        let source = InMemoryInboxSource(initial: update)
        let model = InboxBodyModel(source: source, archived: archived, actions: PreviewInboxActions())
        model.start()
        if view == .flat { model.setView(.flat) }
        for id in selecting {
            model.toggleSelected(id, true)
        }
        return model
    }

    private func previewShell(_ surface: InboxBody) -> some View {
        ScrollView {
            surface.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 720)
        .background(Color.TS.bg)
    }

    private func contentUpdate(connection: InboxConnection = .live) -> InboxUpdate {
        InboxUpdate(
            flatStatus: .loaded, groupStatus: .loaded, rows: InboxSample.rows(),
            groups: InboxSample.groups(), rules: InboxSample.rules, vehicles: InboxSample.vehicles,
            connection: connection, updatedAt: Date()
        )
    }

    #Preview("Flat content") {
        previewShell(InboxBody(model: previewModel(contentUpdate(), view: .flat)))
    }

    #Preview("Grouped content") {
        previewShell(InboxBody(model: previewModel(contentUpdate())))
    }

    #Preview("Selection") {
        previewShell(InboxBody(model: previewModel(contentUpdate(), view: .flat, selecting: [1, 3])))
    }

    #Preview("Loading") {
        previewShell(InboxBody(model: previewModel(InboxUpdate(flatStatus: .loading, groupStatus: .loading))))
    }

    #Preview("Empty inbox") {
        previewShell(InboxBody(model: previewModel(
            InboxUpdate(flatStatus: .empty, groupStatus: .empty, updatedAt: Date()), view: .flat
        )))
    }

    #Preview("Empty archived") {
        previewShell(InboxBody(model: previewModel(
            InboxUpdate(flatStatus: .empty, groupStatus: .empty, updatedAt: Date()), archived: true
        )))
    }

    #Preview("Error") {
        previewShell(InboxBody(model: previewModel(
            InboxUpdate(flatStatus: .failed("Network unavailable"), groupStatus: .failed("Network unavailable")),
            view: .flat
        )))
    }

    #Preview("Stale (cached)") {
        previewShell(InboxBody(model: previewModel(contentUpdate(connection: .stale), view: .flat)))
    }

    #Preview("Offline (cached)") {
        previewShell(InboxBody(model: previewModel(contentUpdate(connection: .offline), view: .flat)))
    }
#endif
