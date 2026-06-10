//
//  DashboardSettingsModal.Previews.swift
//  TeslaSync — P4 modal / dialog · 0022 · DashboardSettingsModal (Apple)
//
//  Xcode previews — one per state the surface produces: the populated settings form (Identity /
//  Vehicle Filter / Auto-Refresh / Display), loading, empty (dashboard not found), error, and the
//  stale / offline freshness variants on the fleet vehicle list. Preview-only; excluded from release
//  builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentDashboardSettingsTelemetry: DashboardSettingsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op action seam so previews don't log commit / cancel intents.
    private struct SilentDashboardSettingsActions: DashboardSettingsActions {
        func commit(_: DashboardSettingsCommit) {}
        func cancel() {}
    }

    /// A representative dashboard + fleet vehicle list so the form, the scope picker, and the icon /
    /// cadence selections are all exercised.
    private enum DashboardSettingsPreviewData {
        static func dashboard() -> DashboardDescriptor {
            DashboardDescriptor(
                id: "dash-1",
                name: "Garage Overview",
                icon: "🔋",
                settings: DashboardSettingsValues(
                    refreshInterval: 30,
                    vehicleID: 2,
                    showWidgetBorders: true,
                    compactMode: false
                )
            )
        }

        static func vehicles() -> [DashboardVehicleOption] {
            [
                DashboardVehicleOption(id: 1, displayName: "Model 3 Performance"),
                DashboardVehicleOption(id: 2, displayName: "Model Y Long Range"),
                DashboardVehicleOption(id: 3, displayName: "Cybertruck")
            ]
        }

        static func update(
            status: DashboardSettingsLoadStatus = .loaded,
            connection: DashboardSettingsConnection = .live,
            dashboard: DashboardDescriptor? = dashboard()
        ) -> DashboardSettingsUpdate {
            DashboardSettingsUpdate(
                status: status,
                dashboard: dashboard,
                vehicles: vehicles(),
                connection: connection
            )
        }
    }

    @MainActor
    private func dashboardSettingsModel(_ update: DashboardSettingsUpdate) -> DashboardSettingsModel {
        let model = DashboardSettingsModel(
            source: InMemoryDashboardSettingsSource(initial: update),
            telemetry: SilentDashboardSettingsTelemetry(),
            actions: SilentDashboardSettingsActions()
        )
        model.start()
        return model
    }

    @MainActor
    private func dashboardSettingsPreview(_ update: DashboardSettingsUpdate) -> some View {
        DashboardSettingsModal(model: dashboardSettingsModel(update))
            .frame(width: 420, height: 640)
            .background(Color.TS.bg)
    }

    #Preview("Populated") {
        dashboardSettingsPreview(DashboardSettingsPreviewData.update())
    }

    #Preview("Loading") {
        dashboardSettingsPreview(DashboardSettingsPreviewData.update(status: .loading, dashboard: nil))
    }

    #Preview("Empty · not found") {
        dashboardSettingsPreview(DashboardSettingsPreviewData.update(status: .loaded, dashboard: nil))
    }

    #Preview("Error") {
        dashboardSettingsPreview(
            DashboardSettingsPreviewData.update(status: .failed("Request timed out"), dashboard: nil)
        )
    }

    #Preview("Stale") {
        dashboardSettingsPreview(DashboardSettingsPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        dashboardSettingsPreview(DashboardSettingsPreviewData.update(connection: .offline))
    }
#endif
