//
//  WidgetSettingsModal.Previews.swift
//  TeslaSync — P4 modal / dialog · 0027 · WidgetSettingsModal (Apple)
//
//  Xcode previews — one per state the surface produces: the populated settings form for a battery
//  widget (vehicle + refresh + time range + appearance), a system widget (refresh + appearance only,
//  exercising the category-driven section hiding), loading, empty (widget not found), error, and the
//  stale / offline freshness variants on the fleet vehicle list. Preview-only; excluded from release
//  builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentWidgetSettingsTelemetry: WidgetSettingsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op action seam so previews don't log commit / cancel intents.
    private struct SilentWidgetSettingsActions: WidgetSettingsActions {
        func commit(_: WidgetSettingsCommit) {}
        func cancel() {}
    }

    /// Representative widgets + a fleet vehicle list so the form, the scope picker, and the refresh /
    /// time-range selections are all exercised.
    private enum WidgetSettingsPreviewData {
        static func batteryWidget() -> WidgetDescriptor {
            WidgetDescriptor(
                id: "widget-1",
                definitionID: "battery-health",
                name: "Battery Health",
                category: .battery,
                config: WidgetConfigValues(
                    vehicleID: 2,
                    refreshRate: 30,
                    timeRange: "30d",
                    showTitle: true
                )
            )
        }

        static func systemWidget() -> WidgetDescriptor {
            WidgetDescriptor(
                id: "widget-2",
                definitionID: "system-status",
                name: "System Status",
                category: .system,
                config: WidgetConfigValues(refreshRate: 60, showTitle: false)
            )
        }

        static func vehicles() -> [WidgetVehicleOption] {
            [
                WidgetVehicleOption(id: 1, displayName: "Model 3 Performance"),
                WidgetVehicleOption(id: 2, displayName: "Model Y Long Range"),
                WidgetVehicleOption(id: 3, displayName: "Cybertruck")
            ]
        }

        static func update(
            status: WidgetSettingsLoadStatus = .loaded,
            connection: WidgetSettingsConnection = .live,
            widget: WidgetDescriptor? = batteryWidget()
        ) -> WidgetSettingsUpdate {
            WidgetSettingsUpdate(
                status: status,
                widget: widget,
                vehicles: vehicles(),
                connection: connection
            )
        }
    }

    @MainActor
    private func widgetSettingsModel(_ update: WidgetSettingsUpdate) -> WidgetSettingsModel {
        let model = WidgetSettingsModel(
            source: InMemoryWidgetSettingsSource(initial: update),
            telemetry: SilentWidgetSettingsTelemetry(),
            actions: SilentWidgetSettingsActions()
        )
        model.start()
        return model
    }

    @MainActor
    private func widgetSettingsPreview(_ update: WidgetSettingsUpdate) -> some View {
        WidgetSettingsModal(model: widgetSettingsModel(update))
            .frame(width: 420, height: 600)
            .background(Color.TS.bg)
    }

    #Preview("Populated · battery") {
        widgetSettingsPreview(WidgetSettingsPreviewData.update())
    }

    #Preview("Populated · system (minimal)") {
        widgetSettingsPreview(
            WidgetSettingsPreviewData.update(widget: WidgetSettingsPreviewData.systemWidget())
        )
    }

    #Preview("Loading") {
        widgetSettingsPreview(WidgetSettingsPreviewData.update(status: .loading, widget: nil))
    }

    #Preview("Empty · not found") {
        widgetSettingsPreview(WidgetSettingsPreviewData.update(status: .loaded, widget: nil))
    }

    #Preview("Error") {
        widgetSettingsPreview(
            WidgetSettingsPreviewData.update(status: .failed("Request timed out"), widget: nil)
        )
    }

    #Preview("Stale") {
        widgetSettingsPreview(WidgetSettingsPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        widgetSettingsPreview(WidgetSettingsPreviewData.update(connection: .offline))
    }
#endif
