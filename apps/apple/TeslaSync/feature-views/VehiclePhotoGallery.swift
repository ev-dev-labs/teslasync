//
//  VehiclePhotoGallery.swift
//  TeslaSync — P4 feature view · 0306 · VehiclePhotoGallery (Apple)
//
//  The vehicle-photo gallery — the SwiftUI parity of
//  features/vehicles/components/VehiclePhotoGallery.tsx. Fades in on appear (web `<FadeIn>` is
//  implicit in the page), shows the cached-data banner + freshness chip when the bound
//  live-state is not fresh, and switches its body over the model's resolved phase so every
//  prompt-required state renders (loading skeleton grid / empty card / first-load error with
//  retry / data grid, with the inline-error + stale + offline branches). Tapping a thumbnail
//  opens the immersive viewer, which composes the shared `tsLightbox` presentation (web
//  `<Lightbox>`). All data binds through `PhotoGalleryModel` (P1/S8); no networking lives here.
//
//  Scope note: the deep zoom / pan / focus-trap behavior of the web `<Lightbox>` belongs to
//  the shared lightbox atom (P4 component-library bundle), exactly as the web gallery delegates
//  it to `<Lightbox>`. This surface owns the grid, the empty card, and opening + navigating the
//  viewer (prev / next / counter / caption / swipe) over the shared `tsLightbox` chrome.
//

import SwiftUI

/// The vehicle-photo gallery — the SwiftUI parity of the web `VehiclePhotoGallery`, binding
/// through `PhotoGalleryModel` (P1/S8).
public struct VehiclePhotoGallery: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PhotoGallerySurface.slug

    @State private var model: PhotoGalleryModel

    public init(model: PhotoGalleryModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                headerAccessory
                if model.connection != .live {
                    PhotoGalleryConnectivityBanner(connection: model.connection)
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .tsLightbox(isPresented: viewerBinding) {
            PhotoGalleryViewer(model: model)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The body region switched over the resolved phase. Every branch renders real chrome —
    /// never a blank box (web empty card for empty; the leaf contract adds loading +
    /// error). The data branch shows the inline error above a cached grid when a reload failed.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            PhotoGalleryLoadingGrid()
        case let .error(message):
            PhotoGalleryErrorState(message: message) { model.refresh() }
        case .empty:
            PhotoGalleryEmptyState()
        case .data:
            if let inline = model.inlineErrorMessage {
                PhotoGalleryInlineError(message: inline)
            }
            PhotoGalleryGrid(model: model)
        }
    }

    /// The trailing accessory above the grid: the freshness chip while the bound live-state is
    /// not fresh (P4 connectivity axis), or a small spinner during a live reload (web refetch).
    @ViewBuilder
    private var headerAccessory: some View {
        if model.connection != .live {
            HStack {
                Spacer(minLength: 0)
                PhotoGalleryFreshnessChip(connection: model.connection)
            }
        } else if model.refreshing {
            HStack {
                Spacer(minLength: 0)
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel(
                        PhotoGalleryStrings.text("vehicles.photos.gallery.loadingA11y", "Loading photos")
                    )
            }
        }
    }

    /// Bridges the model's viewer state to the `tsLightbox` presentation binding: reads the
    /// model's open flag; a dismiss (scrim tap / close button) routes back through `close()`.
    private var viewerBinding: Binding<Bool> {
        Binding(
            get: { model.isViewerOpen },
            set: { isPresented in if !isPresented { model.close() } }
        )
    }
}
