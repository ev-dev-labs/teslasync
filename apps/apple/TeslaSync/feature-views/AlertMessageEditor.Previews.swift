//
//  AlertMessageEditor.Previews.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  #if DEBUG previews exercising every state the surface renders (content / preview-empty / preview-
//  loading / preview-error / autocomplete-open / stale / offline), so the message-template editor can
//  be eyeballed in Xcode without the live store.
//

#if DEBUG
    import SwiftUI

    private enum AlertMessageEditorPreviewData {
        static let tokens: [AlertMessageTokenDTO] = [
            AlertMessageTokenDTO(key: "BatteryLevel", label: "Battery level (%)", group: "Signals"),
            AlertMessageTokenDTO(key: "VehicleName", label: "Vehicle name", group: "Rule"),
            AlertMessageTokenDTO(key: "Severity", label: "Severity", group: "Rule"),
            AlertMessageTokenDTO(key: "Threshold", label: "Threshold value", group: "Rule")
        ]

        static let presets: [AlertMessagePresetDTO] = [
            AlertMessagePresetDTO(
                id: "low-batt",
                name: "Low battery",
                template: "⚠️ {{VehicleName}} battery at {{BatteryLevel}}%",
                summary: "Warn when the pack dips below the threshold.",
                kind: .signal,
                tags: ["battery", "signal"]
            ),
            AlertMessagePresetDTO(
                id: "generic",
                name: "Minimal",
                template: "{{VehicleName}}: {{Severity}}",
                summary: nil,
                kind: nil,
                tags: ["minimal"]
            )
        ]

        static let draft = AlertMessageDraft(
            kind: .signal,
            signalName: "battery_level",
            op: .lessThan,
            severity: .warn,
            vehicleName: "Model 3"
        )

        static let preview = AlertMessagePreviewResultDTO(
            title: "Low battery",
            body: "⚠️ Model 3 battery at 18%"
        )

        @MainActor
        static func model(template: String, update: AlertMessageEditorUpdate) -> AlertMessageEditorModel {
            AlertMessageEditorModel(
                source: InMemoryAlertMessageEditorSource(initial: update),
                template: template,
                draft: draft,
                copy: .fallback,
                previewDebounce: 0
            )
        }

        static func loaded(
            preview: AlertMessagePreviewResultDTO? = preview,
            connection: AlertMessageConnection = .live
        ) -> AlertMessageEditorUpdate {
            AlertMessageEditorUpdate(
                tokensStatus: .loaded,
                tokens: tokens,
                presetsStatus: .loaded,
                presets: presets,
                previewStatus: preview == nil ? .idle : .loaded,
                preview: preview,
                connection: connection,
                updatedAt: Date()
            )
        }
    }

    private struct AlertMessageEditorPreviewStage: View {
        let model: AlertMessageEditorModel
        var primesAutocomplete = false

        var body: some View {
            ScrollView {
                AlertMessageEditor(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
            .task {
                guard primesAutocomplete else { return }
                model.start()
                model.updateCaret(model.template.count)
            }
        }
    }

    #Preview("Content") {
        AlertMessageEditorPreviewStage(
            model: AlertMessageEditorPreviewData.model(
                template: "⚠️ {{VehicleName}} battery at {{BatteryLevel}}%",
                update: AlertMessageEditorPreviewData.loaded()
            )
        )
    }

    #Preview("Preview empty") {
        AlertMessageEditorPreviewStage(
            model: AlertMessageEditorPreviewData.model(
                template: "",
                update: AlertMessageEditorPreviewData.loaded(preview: nil)
            )
        )
    }

    #Preview("Preview loading") {
        AlertMessageEditorPreviewStage(
            model: AlertMessageEditorPreviewData.model(
                template: "{{VehicleName}} low",
                update: AlertMessageEditorUpdate(
                    tokensStatus: .loaded,
                    tokens: AlertMessageEditorPreviewData.tokens,
                    presetsStatus: .loaded,
                    presets: AlertMessageEditorPreviewData.presets,
                    previewStatus: .loading
                )
            )
        )
    }

    #Preview("Preview error") {
        AlertMessageEditorPreviewStage(
            model: AlertMessageEditorPreviewData.model(
                template: "{{Bogus}}",
                update: AlertMessageEditorUpdate(
                    tokensStatus: .loaded,
                    tokens: AlertMessageEditorPreviewData.tokens,
                    presetsStatus: .loaded,
                    presets: AlertMessageEditorPreviewData.presets,
                    previewStatus: .failed("unknown token {{Bogus}}")
                )
            )
        )
    }

    #Preview("Autocomplete open") {
        AlertMessageEditorPreviewStage(
            model: AlertMessageEditorPreviewData.model(
                template: "Battery at {{Bat",
                update: AlertMessageEditorPreviewData.loaded(preview: nil)
            ),
            primesAutocomplete: true
        )
    }

    #Preview("Stale") {
        AlertMessageEditorPreviewStage(
            model: AlertMessageEditorPreviewData.model(
                template: "⚠️ {{VehicleName}} battery at {{BatteryLevel}}%",
                update: AlertMessageEditorPreviewData.loaded(connection: .stale)
            )
        )
    }

    #Preview("Offline") {
        AlertMessageEditorPreviewStage(
            model: AlertMessageEditorPreviewData.model(
                template: "⚠️ {{VehicleName}} battery at {{BatteryLevel}}%",
                update: AlertMessageEditorPreviewData.loaded(connection: .offline)
            )
        )
    }
#endif
