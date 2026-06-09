//
//  PresetGallery.Previews.swift
//  TeslaSync — P4 feature view · 0085 · AutomationPresetGallery (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated gallery
//  spanning trigger kinds + icons), empty (resolved with no presets), loading (initial
//  skeletons), error (fetch failed → retry), and the stale / offline freshness variants.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentAutomationPresetGalleryTelemetry: AutomationPresetGalleryTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op navigator so previews render the Install affordance without routing.
    private struct SilentAutomationPresetGalleryNavigator: AutomationPresetGalleryNavigator {
        func installPreset(id _: String) {}
    }

    /// Sample presets spanning the trigger kinds, icon glyphs, and action counts.
    private enum AutomationPresetGalleryPreviewData {
        static func items() -> [AutomationPresetItem] {
            [
                AutomationPresetItem(
                    id: "sentry-on-leave",
                    name: "Sentry on leave",
                    summary: "Arm Sentry Mode automatically whenever you drive away from home.",
                    iconKey: "Shield",
                    triggers: [.geofence],
                    actionCount: 2
                ),
                AutomationPresetItem(
                    id: "night-charge",
                    name: "Overnight charge",
                    summary: "Start charging to your daily limit at 11pm to catch off-peak rates.",
                    iconKey: "Moon",
                    triggers: [.schedule],
                    actionCount: 1
                ),
                AutomationPresetItem(
                    id: "precondition-morning",
                    name: "Morning precondition",
                    summary: "Warm the cabin before your weekday commute when plugged in.",
                    iconKey: "Sun",
                    triggers: [.schedule],
                    actionCount: 3
                ),
                AutomationPresetItem(
                    id: "lock-on-walk-away",
                    name: "Auto-lock",
                    summary: "Lock the doors if the car is left unlocked and unoccupied.",
                    iconKey: "Lock",
                    triggers: [.signal],
                    actionCount: 1
                ),
                AutomationPresetItem(
                    id: "alert-no-trigger",
                    name: "Custom blank template",
                    summary: "An empty template to start a brand-new automation from scratch.",
                    iconKey: "CarFront",
                    triggers: [],
                    actionCount: 0
                )
            ]
        }

        static func update(
            status: AutomationPresetGalleryLoadStatus = .loaded,
            connection: AutomationPresetGalleryConnection = .live,
            empty: Bool = false
        ) -> AutomationPresetGalleryUpdate {
            AutomationPresetGalleryUpdate(
                status: status,
                items: empty ? [] : items(),
                connection: connection
            )
        }
    }

    @MainActor
    private func presetGalleryPreview(_ update: AutomationPresetGalleryUpdate) -> AutomationPresetGallery {
        let model = AutomationPresetGalleryModel(
            source: InMemoryAutomationPresetGallerySource(initial: update),
            telemetry: SilentAutomationPresetGalleryTelemetry(),
            navigator: SilentAutomationPresetGalleryNavigator()
        )
        return AutomationPresetGallery(model: model)
    }

    #Preview("Content") {
        ScrollView { presetGalleryPreview(AutomationPresetGalleryPreviewData.update()).padding() }
    }

    #Preview("Empty") {
        presetGalleryPreview(AutomationPresetGalleryPreviewData.update(empty: true)).padding()
    }

    #Preview("Loading") {
        ScrollView {
            presetGalleryPreview(AutomationPresetGalleryPreviewData.update(status: .loading, empty: true)).padding()
        }
    }

    #Preview("Error") {
        presetGalleryPreview(
            AutomationPresetGalleryPreviewData.update(status: .failed("Request timed out"), empty: true)
        )
        .padding()
    }

    #Preview("Stale") {
        ScrollView {
            presetGalleryPreview(AutomationPresetGalleryPreviewData.update(connection: .stale)).padding()
        }
    }

    #Preview("Offline") {
        ScrollView {
            presetGalleryPreview(AutomationPresetGalleryPreviewData.update(connection: .offline)).padding()
        }
    }
#endif
