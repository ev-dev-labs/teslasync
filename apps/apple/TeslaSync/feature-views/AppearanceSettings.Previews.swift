//
//  AppearanceSettings.Previews.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  Xcode previews for every Appearance Settings render state — content / loading /
//  empty / error / stale / offline — plus light + dark and a large Dynamic Type
//  pass, per the Apple HIG. DEBUG-only; the previews use a no-op telemetry sink so
//  rendering them never emits diagnostics, and an in-memory source so they stay
//  host-free.
//

import SwiftUI

#if DEBUG
    /// A telemetry sink that drops events — previews must not emit diagnostics.
    private struct NoopAppearanceTelemetry: AppearanceSettingsTelemetry {
        func viewOpened(surface _: String) {}
    }

    private enum AppearancePreviewData {
        static let loaded = AppearancePreferences(
            density: .spacious,
            timeFormat: .absolute,
            chartPalette: .neon
        )

        static func snapshot(
            settings: AppearanceSettingsQuery = .loaded(loaded),
            connection: AppearanceConnection = .live,
            updatedAt: Date? = Date()
        ) -> AppearanceSnapshot {
            AppearanceSnapshot(
                settings: settings,
                statusBar: AppearanceStatusBarPrefs(enabled: true, iconOnly: false),
                celebration: AppearanceCelebrationPrefs(),
                sidebarStyle: .notion,
                theme: AppearanceThemeState(mode: .dark, accentID: "purple"),
                connection: connection,
                updatedAt: updatedAt
            )
        }
    }

    @MainActor
    private func appearancePreviewModel(_ snapshot: AppearanceSnapshot) -> AppearanceSettingsModel {
        let source = InMemoryAppearanceSettingsSource(initial: snapshot)
        let model = AppearanceSettingsModel(source: source, telemetry: NoopAppearanceTelemetry())
        model.start()
        return model
    }

    #Preview("Content · Dark") {
        AppearanceSettings(model: appearancePreviewModel(AppearancePreviewData.snapshot()))
            .preferredColorScheme(.dark)
            .frame(width: 760, height: 1100)
    }

    #Preview("Content · Light") {
        AppearanceSettings(model: appearancePreviewModel(AppearancePreviewData.snapshot()))
            .preferredColorScheme(.light)
            .frame(width: 760, height: 1100)
    }

    #Preview("Loading") {
        AppearanceSettings(model: appearancePreviewModel(
            AppearancePreviewData.snapshot(settings: .loading, updatedAt: nil)
        ))
        .preferredColorScheme(.dark)
        .frame(width: 560, height: 900)
    }

    #Preview("Empty") {
        AppearanceSettings(model: appearancePreviewModel(
            AppearancePreviewData.snapshot(settings: .empty)
        ))
        .preferredColorScheme(.dark)
        .frame(width: 560, height: 900)
    }

    #Preview("Error") {
        AppearanceSettings(model: appearancePreviewModel(
            AppearancePreviewData.snapshot(settings: .failed("Network unavailable"))
        ))
        .preferredColorScheme(.dark)
        .frame(width: 560, height: 900)
    }

    #Preview("Stale") {
        AppearanceSettings(model: appearancePreviewModel(
            AppearancePreviewData.snapshot(connection: .stale, updatedAt: Date().addingTimeInterval(-300))
        ))
        .preferredColorScheme(.dark)
        .frame(width: 760, height: 1100)
    }

    #Preview("Offline (cached)") {
        AppearanceSettings(model: appearancePreviewModel(
            AppearancePreviewData.snapshot(connection: .offline, updatedAt: Date().addingTimeInterval(-1800))
        ))
        .preferredColorScheme(.dark)
        .frame(width: 760, height: 1100)
    }

    #Preview("Dynamic Type · accessibility3") {
        AppearanceSettings(model: appearancePreviewModel(AppearancePreviewData.snapshot()))
            .environment(\.dynamicTypeSize, .accessibility3)
            .preferredColorScheme(.dark)
            .frame(width: 760, height: 1400)
    }
#endif
