//
//  KioskSettingsModal.Previews.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  Xcode previews — one per state the surface produces: the populated settings form (every
//  conditional control revealed — the dashboards-to-rotate list, the cursor timeout, the dimmed
//  brightness, the clock position), loading, empty (no dashboards), error, and the stale / offline
//  freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentKioskSettingsTelemetry: KioskSettingsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op action seam so previews don't log persist / enter / cancel intents.
    private struct SilentKioskSettingsActions: KioskSettingsActions {
        func persist(_: KioskConfig) {}
        func enterKiosk(_: KioskConfig) {}
        func cancel() {}
    }

    /// A representative slice of saved dashboards + a config with every conditional control revealed,
    /// so the rotation list, cursor timeout, dimmed brightness, and clock position all render.
    private enum KioskSettingsPreviewData {
        static func dashboards() -> [KioskDashboard] {
            [
                KioskDashboard(id: "overview", name: "Overview", isDefault: true),
                KioskDashboard(id: "charging", name: "Charging & Energy"),
                KioskDashboard(id: "trips", name: "Trips & Routes")
            ]
        }

        static func config() -> KioskConfig {
            var config = KioskConfig.default
            config.rotateInterval = 30
            config.dashboardIds = ["overview", "charging", "trips"]
            config.hideCursor = true
            config.cursorTimeout = 5
            config.dimAfter = 10
            config.dimLevel = 0.5
            config.showClock = true
            config.clockPosition = .bottomRight
            config.widgetOpacity = 0.85
            config.backgroundOpacity = 0.7
            return config
        }

        static func update(
            status: KioskLoadStatus = .loaded,
            connection: KioskConnection = .live,
            dashboards: [KioskDashboard] = dashboards()
        ) -> KioskSettingsUpdate {
            KioskSettingsUpdate(
                status: status,
                dashboards: dashboards,
                config: config(),
                connection: connection
            )
        }
    }

    @MainActor
    private func kioskSettingsModel(_ update: KioskSettingsUpdate) -> KioskSettingsModel {
        let model = KioskSettingsModel(
            source: InMemoryKioskSettingsSource(initial: update),
            telemetry: SilentKioskSettingsTelemetry(),
            actions: SilentKioskSettingsActions()
        )
        model.start()
        return model
    }

    @MainActor
    private func kioskSettingsPreview(_ update: KioskSettingsUpdate) -> some View {
        KioskSettingsModal(model: kioskSettingsModel(update))
            .frame(width: 460, height: 720)
            .background(Color.TS.bg)
    }

    #Preview("Populated") {
        kioskSettingsPreview(KioskSettingsPreviewData.update())
    }

    #Preview("Loading") {
        kioskSettingsPreview(KioskSettingsPreviewData.update(status: .loading, dashboards: []))
    }

    #Preview("Empty · no dashboards") {
        kioskSettingsPreview(KioskSettingsPreviewData.update(status: .loaded, dashboards: []))
    }

    #Preview("Error") {
        kioskSettingsPreview(KioskSettingsPreviewData.update(status: .failed("Request timed out"), dashboards: []))
    }

    #Preview("Stale") {
        kioskSettingsPreview(KioskSettingsPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        kioskSettingsPreview(KioskSettingsPreviewData.update(connection: .offline))
    }
#endif
