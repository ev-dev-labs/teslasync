//
//  SettingsExportImport.Previews.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  Xcode previews for each surface state: export idle / exporting / saved toast / offline
//  toast; import dropzone idle / parsing; the inline parse-error banner (too-large +
//  invalid-JSON branches); the dry-run preview (with changes, and the all-unchanged
//  "Nothing to apply" case); the applied summary; and the apply-failure toast. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope. No
//  networking — the model is driven by the in-memory source + the DEBUG preview seam.
//

#if DEBUG
    import Foundation
    import SwiftUI

    private let previewBundle = SettingsBundle(
        schemaVersion: 1,
        exportedAt: "2026-06-07T15:14:00Z",
        presentSections: [.settings, .alertRules, .geofences, .quietHours],
        rawData: Data("{\"schema_version\":1}".utf8)
    )

    private let previewPending = PendingSettingsImport(
        bundle: previewBundle,
        filename: "teslasync-settings-20260607.json",
        sizeBytes: 8421
    )

    private let previewNoChanges = SettingsImportResult(
        dryRun: true,
        sections: [
            .settings: SettingsImportSectionResult(added: 0, updated: 0, skipped: 5),
            .alertRules: SettingsImportSectionResult(added: 0, updated: 0, skipped: 6)
        ]
    )

    @MainActor
    private func previewModel(
        configure: (SettingsExportImportModel) -> Void = { _ in }
    ) -> SettingsExportImportModel {
        let model = SettingsExportImportModel(
            exporter: InMemorySettingsBackupSource(),
            importer: InMemorySettingsBackupSource(),
            locale: Locale(identifier: "en_US")
        )
        model.start()
        configure(model)
        return model
    }

    private func framed(_ view: some View) -> some View {
        ScrollView {
            view
                .frame(maxWidth: 520)
                .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Idle") {
        framed(SettingsExportImport(model: previewModel()))
    }

    #Preview("Exporting") {
        framed(SettingsExportImport(model: previewModel { $0.previewSeed(exporting: true) }))
    }

    #Preview("Export saved (toast)") {
        framed(SettingsExportImport(model: previewModel {
            $0.previewSeed(toast: .exportSucceeded(localize: SettingsExportImportStrings.string))
        }))
    }

    #Preview("Export offline (toast)") {
        framed(SettingsExportImport(model: previewModel {
            $0.previewSeed(toast: .exportOffline(localize: SettingsExportImportStrings.string))
        }))
    }

    #Preview("Parsing") {
        framed(SettingsExportImport(model: previewModel { $0.previewSeed(stage: .parsing) }))
    }

    #Preview("Parse error · too large") {
        framed(SettingsExportImport(model: previewModel {
            $0.previewSeed(parseError: .tooLarge)
        }))
    }

    #Preview("Parse error · invalid JSON") {
        framed(SettingsExportImport(model: previewModel {
            $0.previewSeed(parseError: .invalidJSON(detail: "Unexpected end of input"))
        }))
    }

    #Preview("Dry-run preview") {
        framed(SettingsExportImport(model: previewModel {
            $0.previewSeed(
                stage: .preview,
                pending: previewPending,
                previewResult: InMemorySettingsBackupSource.sampleDryRun
            )
        }))
    }

    #Preview("Preview · nothing to apply") {
        framed(SettingsExportImport(model: previewModel {
            $0.previewSeed(
                stage: .preview,
                pending: previewPending,
                previewResult: previewNoChanges
            )
        }))
    }

    #Preview("Applying") {
        framed(SettingsExportImport(model: previewModel {
            $0.previewSeed(
                stage: .preview,
                pending: previewPending,
                previewResult: InMemorySettingsBackupSource.sampleDryRun,
                applyInFlight: true
            )
        }))
    }

    #Preview("Applied") {
        framed(SettingsExportImport(model: previewModel {
            $0.previewSeed(
                stage: .applied,
                appliedResult: InMemorySettingsBackupSource.sampleApplied,
                toast: .importApplied(
                    summary: SettingsImportSummary.summarise(InMemorySettingsBackupSource.sampleApplied),
                    localize: SettingsExportImportStrings.string,
                    format: SettingsExportImportStrings.format
                )
            )
        }))
    }

    #Preview("Apply failed (toast)") {
        framed(SettingsExportImport(model: previewModel {
            $0.previewSeed(
                stage: .preview,
                pending: previewPending,
                previewResult: InMemorySettingsBackupSource.sampleDryRun,
                toast: .importFailed(message: "409 Conflict", localize: SettingsExportImportStrings.string)
            )
        }))
    }
#endif
