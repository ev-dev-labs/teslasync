//
//  TemplateGallery.Previews.swift
//  TeslaSync — P4 feature view · 0132 · TemplateGallery (Apple)
//
//  Xcode previews for every branch the surface renders: the gallery grid, the
//  detail view, and the loading / empty / error phases, plus a dark variant.
//  DEBUG-only; skipped by the release host gate.
//

import SwiftUI

#if DEBUG
    /// A silent telemetry sink so previews don't emit `view.opened` noise.
    private struct SilentTemplateGalleryTelemetry: TemplateGalleryTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A source that resolves to an empty catalog (exercises the `empty` phase).
    private struct EmptyTemplateGalleryCatalog: TemplateGalleryCatalogSource {
        func loadCatalog() -> Result<[TemplateGalleryTemplate], TemplateGalleryCatalogError> {
            .success([])
        }
    }

    /// A source that fails (exercises the `failed` phase + retry).
    private struct FailingTemplateGalleryCatalog: TemplateGalleryCatalogSource {
        func loadCatalog() -> Result<[TemplateGalleryTemplate], TemplateGalleryCatalogError> {
            .failure(TemplateGalleryCatalogError(
                messageKey: "templates.error.generic",
                messageFallback: "Something went wrong loading templates."
            ))
        }
    }

    @MainActor
    private func previewModel(
        source: any TemplateGalleryCatalogSource = TemplateGalleryCanonicalCatalog(),
        selectedID: String? = nil
    ) -> TemplateGalleryModel {
        let model = TemplateGalleryModel(source: source, telemetry: SilentTemplateGalleryTelemetry())
        model.select(selectedID)
        return model
    }

    @MainActor
    private func previewGallery(_ model: TemplateGalleryModel) -> some View {
        TemplateGallery(model: model, onApply: { _ in }, onClose: {})
            .frame(maxWidth: 560, maxHeight: 640)
            .background(Color.TS.bg)
    }

    #Preview("Gallery") {
        previewGallery(previewModel())
    }

    #Preview("Detail · Charging Hub") {
        previewGallery(previewModel(selectedID: "charging_focus"))
    }

    #Preview("Empty") {
        previewGallery(previewModel(source: EmptyTemplateGalleryCatalog()))
    }

    #Preview("Error") {
        previewGallery(previewModel(source: FailingTemplateGalleryCatalog()))
    }

    #Preview("Loading") {
        ScrollView {
            TemplateGalleryLoading().padding(TSSpacing.lg)
        }
        .frame(maxWidth: 560, maxHeight: 640)
        .background(Color.TS.bg)
    }

    #Preview("Detail · Dark") {
        previewGallery(previewModel(selectedID: "road_trip"))
            .preferredColorScheme(.dark)
    }
#endif
