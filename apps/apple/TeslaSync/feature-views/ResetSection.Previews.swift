//
//  ResetSection.Previews.swift
//  TeslaSync — P4 feature view · 0212 · ResetSection (Apple)
//
//  Xcode previews for each surface state (ready · empty · loading · error · stale ·
//  offline · per-section confirm sheet · danger-zone typed confirm sheet · Dynamic Type).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// No-op telemetry sink so previews don't emit diagnostics.
    private struct NoopResetTelemetry: ResetTelemetry {
        func viewOpened(surface _: String) {}
    }

    @MainActor
    private func previewModel(
        status: ResetSectionsStatus = .loaded,
        freshness: ResetFreshness = .fresh,
        sections: [ResetSectionRow] = ResetCatalog.defaultSections,
        outcome: InMemorySettingsResetting.Outcome = .success(
            SettingsResetReceipt(reset: 6, sections: ["general", "appearance"])
        )
    ) -> ResetSectionModel {
        let source = InMemoryResetSectionsSource(
            initial: ResetSectionsUpdate(
                status: status,
                freshness: freshness,
                sections: sections,
                denied: ResetCatalog.deniedSections,
                updatedAt: Date()
            )
        )
        let model = ResetSectionModel(
            source: source,
            resetter: InMemorySettingsResetting(outcome: outcome),
            telemetry: NoopResetTelemetry()
        )
        model.start()
        return model
    }

    @MainActor
    private func previewShell(_ section: ResetSection) -> some View {
        ScrollView {
            section.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 760)
        .background(Color.TS.bg)
    }

    #Preview("Ready") {
        previewShell(ResetSection(model: previewModel()))
    }

    #Preview("Empty (no resettable sections)") {
        previewShell(ResetSection(model: previewModel(sections: [])))
    }

    #Preview("Loading") {
        previewShell(ResetSection(model: previewModel(status: .loading)))
    }

    #Preview("Error (cached)") {
        previewShell(ResetSection(model: previewModel(status: .failed("HTTP 503"))))
    }

    #Preview("Stale") {
        previewShell(ResetSection(model: previewModel(freshness: .stale)))
    }

    #Preview("Offline (cached)") {
        previewShell(ResetSection(model: previewModel(freshness: .offline)))
    }

    #Preview("Dynamic Type") {
        previewShell(ResetSection(model: previewModel()))
            .environment(\.dynamicTypeSize, .accessibility2)
    }

    #Preview("Per-section confirm") {
        let row = ResetCatalog.defaultSections[3]
        let model = previewModel()
        model.requestResetSection(row)
        return ResetSectionConfirmSheet(row: row, model: model)
            .frame(maxWidth: 520)
            .background(Color.TS.bg)
    }

    #Preview("Danger-zone typed confirm") {
        let model = previewModel()
        model.requestResetAll()
        return ResetAllConfirmSheet(model: model)
            .frame(maxWidth: 520)
            .background(Color.TS.bg)
    }
#endif
