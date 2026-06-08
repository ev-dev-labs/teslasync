//
//  NotificationFilterBar.Previews.swift
//  TeslaSync — P4 feature view · 0189 · NotificationFilterBar (Apple)
//
//  Xcode previews — one per state the surface produces: content (vehicles + rules
//  resolved), active filters (every chip populated), empty (no options), loading
//  (initial skeleton), error (fetch failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentNotificationFilterTelemetry: NotificationFilterTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op change sink so previews don't log filter edits.
    private struct SilentNotificationFilterChangeSink: NotificationFilterChangeSink {
        func filtersChanged(_: NotificationFilters) {}
    }

    /// Sample vehicles + alert rules spanning named, unnamed, and varied options.
    private enum NotificationFilterPreviewData {
        static func vehicles() -> [NotificationVehicleOption] {
            [
                NotificationVehicleOption(id: 1, displayName: "Model 3 Performance"),
                NotificationVehicleOption(id: 2, displayName: "Model Y Long Range"),
                NotificationVehicleOption(id: 3, displayName: nil)
            ]
        }

        static func rules() -> [NotificationRuleOption] {
            [
                NotificationRuleOption(id: 10, name: "Battery below 20%"),
                NotificationRuleOption(id: 11, name: "Sentry event detected"),
                NotificationRuleOption(id: 12, name: "Charging complete")
            ]
        }

        static func activeFilters() -> NotificationFilters {
            NotificationFilters(
                severity: [.warn, .critical],
                vehicleIDs: [1],
                ruleIDs: [10],
                query: "battery",
                from: "2026-01-01",
                to: "2026-06-01"
            )
        }

        static func update(
            status: NotificationFilterLoadStatus = .loaded,
            connection: NotificationFilterConnection = .live,
            empty: Bool = false,
            filters: NotificationFilters = NotificationFilters()
        ) -> NotificationFilterUpdate {
            NotificationFilterUpdate(
                status: status,
                filters: filters,
                vehicles: empty ? [] : vehicles(),
                rules: empty ? [] : rules(),
                connection: connection
            )
        }
    }

    @MainActor
    private func notificationFilterPreview(_ update: NotificationFilterUpdate) -> NotificationFilterBar {
        let model = NotificationFilterModel(
            source: InMemoryNotificationFilterSource(initial: update),
            filters: update.filters,
            telemetry: SilentNotificationFilterTelemetry(),
            changeSink: SilentNotificationFilterChangeSink()
        )
        return NotificationFilterBar(model: model)
    }

    #Preview("Content") {
        ScrollView { notificationFilterPreview(NotificationFilterPreviewData.update()).padding() }
    }

    #Preview("Active filters") {
        ScrollView {
            notificationFilterPreview(
                NotificationFilterPreviewData.update(filters: NotificationFilterPreviewData.activeFilters())
            )
            .padding()
        }
    }

    #Preview("Empty") {
        notificationFilterPreview(NotificationFilterPreviewData.update(empty: true)).padding()
    }

    #Preview("Loading") {
        notificationFilterPreview(
            NotificationFilterPreviewData.update(status: .loading, empty: true)
        )
        .padding()
    }

    #Preview("Error") {
        notificationFilterPreview(
            NotificationFilterPreviewData.update(status: .failed("Request timed out"), empty: true)
        )
        .padding()
    }

    #Preview("Stale") {
        ScrollView {
            notificationFilterPreview(NotificationFilterPreviewData.update(connection: .stale)).padding()
        }
    }

    #Preview("Offline") {
        ScrollView {
            notificationFilterPreview(NotificationFilterPreviewData.update(connection: .offline)).padding()
        }
    }
#endif
