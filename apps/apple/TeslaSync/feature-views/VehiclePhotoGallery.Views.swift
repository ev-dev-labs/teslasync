//
//  VehiclePhotoGallery.Views.swift
//  TeslaSync — P4 feature view · 0306 · VehiclePhotoGallery (Apple)
//
//  The presentational subviews composed by `VehiclePhotoGallery`: the responsive thumbnail
//  grid (web `<ul class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4">`), the square
//  thumbnail button (web `<button><img object-cover></button>`), and the immersive viewer that
//  composes the shared `tsLightbox` presentation (web `<Lightbox>`) with the current image,
//  prev/next navigation, the counter, the caption, and a swipe gesture. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). No networking lives here.
//
//  Colour parity (ADR-006 semantic, not literal): the web `focus-visible:ring-cyan-500` maps
//  to the platform-native focus ring; the `hover:scale-[1.03]` maps to a reduce-motion-gated
//  pointer hover lift; the thumbnail border `border-[var(--glass-border)]` maps to `border`.
//

import SwiftUI
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Localization Text helper

extension PhotoGalleryStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are
    /// never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Cross-platform image bridge (web `<img>`)

/// Builds a SwiftUI `Image` from raw bytes on either idiom (UIKit on iOS/iPadOS, AppKit on
/// macOS) — the native analogue of the web `<img src>`. Returns `nil` when the bytes don't
/// decode, so the caller can fall back to pending chrome rather than a blank box.
func photoGalleryImage(from data: Data) -> Image? {
    #if canImport(UIKit)
        guard let image = UIImage(data: data) else { return nil }
        return Image(uiImage: image)
    #elseif canImport(AppKit)
        guard let image = NSImage(data: data) else { return nil }
        return Image(nsImage: image)
    #else
        return nil
    #endif
}

// MARK: - Thumbnail grid (web `<ul class="grid ...">`)

/// The responsive thumbnail grid — the native parity of the web `<ul>`. Resolves its column
/// count from the container width (web 2 / 3 / 4 ladder) via `onGeometryChange`, labels itself
/// for VoiceOver (named vs unnamed gallery), and opens the immersive viewer on tap.
struct PhotoGalleryGrid: View {
    @Bindable var model: PhotoGalleryModel
    @State private var columns = 2

    var body: some View {
        LazyVGrid(columns: gridItems, spacing: TSSpacing.md) {
            ForEach(model.photos.indices, id: \.self) { index in
                let photo = model.photos[index]
                PhotoGalleryThumbnail(image: photo, label: model.thumbnailLabel(at: index)) {
                    model.open(at: index)
                }
            }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { width in
            columns = PhotoGalleryLayout.columnCount(forWidth: width)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.galleryAccessibilityLabel))
    }

    private var gridItems: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: max(columns, 1))
    }
}

// MARK: - Thumbnail (web `<button><img object-cover></button>`)

/// One square thumbnail — the native parity of the web thumbnail button. Renders the decoded
/// image filling a 1:1 frame (web `object-cover`), lifts subtly on pointer hover (web
/// `group-hover:scale`, reduce-motion gated), and carries the "Open photo n of total" label.
struct PhotoGalleryThumbnail: View {
    let image: PhotoGalleryImage
    let label: String
    let onOpen: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false

    var body: some View {
        Button(action: onOpen) {
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .fill(Color.TS.textPrimary.opacity(0.04))
                .aspectRatio(1, contentMode: .fit)
                .overlay { thumbnailContent }
                .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
                .scaleEffect(hovering && !reduceMotion ? 1.03 : 1)
                .animation(.easeInOut(duration: TSMotion.fastDuration), value: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(.isButton)
    }

    /// The decoded image filling the square, or a pending glyph while the bytes arrive (never a
    /// blank cell).
    @ViewBuilder
    private var thumbnailContent: some View {
        if let data = image.data, let decoded = photoGalleryImage(from: data) {
            decoded
                .resizable()
                .scaledToFill()
        } else {
            Image(systemName: "photo")
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Immersive viewer (web `<Lightbox>` over the shared `tsLightbox` chrome)

/// The immersive viewer composed inside `tsLightbox` — the native parity of the web
/// `<Lightbox>`. Shows the active image scaled to fit, the caption, and a control row
/// (previous / counter / next); a horizontal swipe navigates. Every control carries a
/// VoiceOver label and navigation is bounds-clamped by the model.
struct PhotoGalleryViewer: View {
    @Bindable var model: PhotoGalleryModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let swipeThreshold: CGFloat = 48

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            imageArea
            caption
            controls
        }
        .padding(TSSpacing.x2xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(PhotoGalleryStrings.text("vehicles.photos.gallery.viewerA11y", "Photo viewer"))
    }

    private var imageArea: some View {
        Group {
            if let image = model.activeImage, let data = image.data, let decoded = photoGalleryImage(from: data) {
                decoded
                    .resizable()
                    .scaledToFit()
                    .accessibilityLabel(Text(verbatim: model.imageAlt(image)))
            } else {
                pendingImage
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .id(model.activeIndex)
        .transition(reduceMotion ? .identity : .opacity)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: model.activeIndex)
        .contentShape(Rectangle())
        .gesture(navigationSwipe)
    }

    private var pendingImage: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "photo")
                .font(.system(size: 44, weight: .regular))
                .foregroundStyle(.white.opacity(0.7))
            if let image = model.activeImage {
                Text(verbatim: model.imageAlt(image))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var caption: some View {
        if let caption = model.activeImage?.caption, !caption.isEmpty {
            Text(verbatim: caption)
                .font(Font.TS.bodySm)
                .foregroundStyle(.white.opacity(0.85))
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
    }

    private var controls: some View {
        HStack(spacing: TSSpacing.lg) {
            navButton(
                systemName: "chevron.left",
                labelKey: "vehicles.photos.gallery.previous",
                labelFallback: "Previous photo",
                enabled: model.canGoPrevious
            ) { model.showPrevious() }

            Text(verbatim: model.viewerCounterLabel)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.white)
                .accessibilityLabel(Text(verbatim: model.viewerCounterLabel))

            navButton(
                systemName: "chevron.right",
                labelKey: "vehicles.photos.gallery.next",
                labelFallback: "Next photo",
                enabled: model.canGoNext
            ) { model.showNext() }
        }
        .frame(maxWidth: .infinity)
    }

    private func navButton(
        systemName: String,
        labelKey: String,
        labelFallback: String,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(.white.opacity(enabled ? 0.16 : 0.05), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(PhotoGalleryStrings.text(labelKey, labelFallback))
    }

    private var navigationSwipe: some Gesture {
        DragGesture(minimumDistance: swipeThreshold)
            .onEnded { value in
                if value.translation.width <= -swipeThreshold {
                    model.showNext()
                } else if value.translation.width >= swipeThreshold {
                    model.showPrevious()
                }
            }
    }
}
