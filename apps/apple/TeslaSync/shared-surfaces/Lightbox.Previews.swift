//
//  Lightbox.Previews.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  Xcode previews for every real branch of the immersive viewer: a single image (no navigation), a sequence
//  (prev / next + counter), a captioned image, a zoomed image (pan + reset enabled), and the non-content
//  states (decode skeleton, error envelope with retry, empty viewer). Every preview injects the deterministic
//  ``StaticLightboxImageLoader`` + a no-op telemetry so nothing hits the network. DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A valid 1×1 PNG, decoded deterministically for the "loaded" previews (no network, no renderer).
    private func lightboxPreviewPNG() -> Data {
        let encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA"
            + "C0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        return Data(base64Encoded: encoded) ?? Data()
    }

    private func lightboxPreviewLoader() -> StaticLightboxImageLoader {
        StaticLightboxImageLoader(outcome: .loaded(lightboxPreviewPNG()))
    }

    private let lightboxPreviewImages: [LightboxImage] = [
        LightboxImage(source: "ts-preview://photo/1", alt: "Model 3 front three-quarter, Pearl White"),
        LightboxImage(
            source: "ts-preview://photo/2",
            alt: "Model 3 charging at a Supercharger",
            caption: "V3 Supercharger · 168 kW peak · 142 km added in 18 minutes"
        ),
        LightboxImage(source: "ts-preview://photo/3", alt: "Model 3 interior, 15-inch display")
    ]

    /// Stages a viewer model inside a device-ish dark frame, optionally pre-zooming so the pan + reset
    /// affordances are exercised in the preview.
    private struct LightboxPreviewStage: View {
        let model: LightboxModel
        var zoomSteps = 0

        var body: some View {
            Lightbox(model: model)
                .frame(width: 420, height: 760)
                .background(Color.black)
                .onAppear {
                    for _ in 0 ..< zoomSteps {
                        model.zoomIn()
                    }
                }
        }
    }

    @MainActor
    private func lightboxPreviewModel(
        images: [LightboxImage] = lightboxPreviewImages,
        initialIndex: Int = 0,
        loader: any LightboxImageLoading
    ) -> LightboxModel {
        LightboxModel(
            input: LightboxInput(isOpen: true, images: images, initialIndex: initialIndex),
            onClose: {},
            loader: loader,
            telemetry: OSLogLightboxTelemetry()
        )
    }

    #Preview("Single image — no nav") {
        LightboxPreviewStage(
            model: lightboxPreviewModel(
                images: [lightboxPreviewImages[0]],
                loader: lightboxPreviewLoader()
            )
        )
    }

    #Preview("Sequence — counter + nav") {
        LightboxPreviewStage(model: lightboxPreviewModel(loader: lightboxPreviewLoader()))
    }

    #Preview("Captioned image") {
        LightboxPreviewStage(model: lightboxPreviewModel(initialIndex: 1, loader: lightboxPreviewLoader()))
    }

    #Preview("Zoomed — pan + reset") {
        LightboxPreviewStage(
            model: lightboxPreviewModel(loader: lightboxPreviewLoader()),
            zoomSteps: 3
        )
    }

    #Preview("Empty — no images") {
        LightboxPreviewStage(model: lightboxPreviewModel(images: [], loader: lightboxPreviewLoader()))
    }

    #Preview("Failed load — retry") {
        LightboxPreviewStage(model: lightboxPreviewModel(loader: StaticLightboxImageLoader(outcome: .failed)))
    }

    #Preview("Loading skeleton") {
        LightboxLoadingSkeleton(reduceMotion: false)
            .frame(width: 420, height: 760)
            .background(Color.black)
    }

    #Preview("Error state") {
        LightboxErrorState(onRetry: {})
            .frame(width: 420, height: 760)
            .background(Color.black)
    }
#endif
