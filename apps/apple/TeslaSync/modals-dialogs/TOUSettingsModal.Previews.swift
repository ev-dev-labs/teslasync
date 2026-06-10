//
//  TOUSettingsModal.Previews.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  Xcode previews — one per state the surface produces: the preset form, a preset selected (with its
//  JSON preview), the Custom-JSON tab, empty (no TOU-capable site), loading (initial fetch), error
//  (context failed → retry), and the stale / offline freshness variants. Preview-only; excluded from
//  release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentTOUSettingsTelemetry: TOUSettingsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't perform a network call.
    @MainActor
    private final class SilentTOUSettingsController: TOUSettingsController {
        var onResult: (@MainActor (TOUSubmitResult) -> Void)?
        func update(payload _: TOUSettingsPayload, siteId _: Int) {}
        func cancel() {}
    }

    private enum TOUSettingsPreviewData {
        /// A resolved snapshot anchored to a fixed TOU-capable site, live by default.
        static func update(
            status: TOUSettingsLoadStatus = .loaded,
            connection: TOUSettingsConnection = .live,
            hasContext: Bool = true,
            touCapable: Bool = true
        ) -> TOUSettingsUpdate {
            TOUSettingsUpdate(
                status: status,
                context: hasContext
                    ? TOUSettingsContext(siteId: 42, siteName: "Home Powerwall", touCapable: touCapable)
                    : nil,
                connection: connection
            )
        }
    }

    @MainActor
    private func touPreview(
        _ update: TOUSettingsUpdate,
        configure: (TOUSettingsModel) -> Void = { _ in }
    ) -> TOUSettingsModal {
        let model = TOUSettingsModel(
            source: InMemoryTOUSettingsSource(initial: update),
            telemetry: SilentTOUSettingsTelemetry(),
            controller: SilentTOUSettingsController()
        )
        configure(model)
        return TOUSettingsModal(model: model)
    }

    #Preview("Preset") {
        touPreview(TOUSettingsPreviewData.update())
    }

    #Preview("Preset selected") {
        touPreview(TOUSettingsPreviewData.update()) { $0.selectedPreset = "pge-ev2a" }
    }

    #Preview("Custom JSON") {
        touPreview(TOUSettingsPreviewData.update()) { $0.activeTab = .custom }
    }

    #Preview("Empty") {
        touPreview(TOUSettingsPreviewData.update(status: .loaded, touCapable: false))
    }

    #Preview("Loading") {
        touPreview(TOUSettingsPreviewData.update(status: .loading, hasContext: false))
    }

    #Preview("Error") {
        touPreview(
            TOUSettingsPreviewData.update(status: .failed("Couldn't reach the energy site"), hasContext: false)
        )
    }

    #Preview("Stale") {
        touPreview(TOUSettingsPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        touPreview(TOUSettingsPreviewData.update(connection: .offline))
    }
#endif
