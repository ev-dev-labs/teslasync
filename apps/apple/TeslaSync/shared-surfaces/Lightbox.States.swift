//
//  Lightbox.States.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  The image-area phase router + the non-content states the viewer switches over. The web `<Lightbox>` shows
//  a pulsing skeleton until the `<img>` decodes (`!decoded`), then the image (or, on `onError`, a broken
//  image); when `total === 0` it renders nothing. The native peer adds real chrome for every branch so the
//  frame is never an unexplained blank box: a decode skeleton (loading), the decoded image with the live
//  zoom + pan transform (loaded), a retry-able error envelope (failed — also the offline-fetch peer), and a
//  friendly empty state (no images). Copy resolves through the P1/S10 facade; chrome via P1/S9 tokens.
//

import SwiftUI
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Cross-platform decode (web `<img>` decode)

/// Builds a SwiftUI `Image` from the loaded bytes, or `nil` when the bytes do not decode (the native peer of
/// the web `<img onError>` — undecodable data falls through to the error envelope).
func lightboxDecodedImage(from data: Data) -> Image? {
    #if canImport(UIKit)
        return UIImage(data: data).map(Image.init(uiImage:))
    #elseif canImport(AppKit)
        return NSImage(data: data).map(Image.init(nsImage:))
    #else
        return nil
    #endif
}

// MARK: - Image-area phase router

/// The viewer's image frame: switches over the current load phase so loading / loaded / failed each render
/// real chrome. The loaded image carries the live zoom + pan transform (web `transform: translate() scale()`)
/// and the `alt` VoiceOver label; the drag-to-pan gesture + navigation are layered on by the parent so this
/// view stays a pure projection of the phase.
struct LightboxImageContent: View {
    let phase: LightboxLoadPhase
    let image: LightboxImage
    let zoom: Double
    let pan: LightboxPan
    let onRetry: () -> Void
    let reduceMotion: Bool

    var body: some View {
        switch phase {
        case .loading:
            LightboxLoadingSkeleton(reduceMotion: reduceMotion)
        case let .loaded(data):
            if let decoded = lightboxDecodedImage(from: data) {
                loadedImage(decoded)
            } else {
                LightboxErrorState(onRetry: onRetry)
            }
        case .failed:
            LightboxErrorState(onRetry: onRetry)
        }
    }

    private func loadedImage(_ decoded: Image) -> some View {
        decoded
            .resizable()
            .scaledToFit()
            .scaleEffect(zoom)
            .offset(x: pan.x, y: pan.y)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration), value: zoom)
            .accessibilityLabel(Text(verbatim: LightboxAccessibility.imageLabel(for: image)))
            .accessibilityValue(Text(verbatim: LightboxStrings.zoomPercent(LightboxProjector.zoomPercent(zoom))))
    }
}

// MARK: - Loading (decode skeleton — web `!decoded` overlay)

/// The decode skeleton overlaid until the image resolves — the native peer of the web pulsing
/// `bg-[var(--surface-2)]/60` placeholder. A gentle opacity pulse runs unless Reduce Motion is on.
struct LightboxLoadingSkeleton: View {
    let reduceMotion: Bool
    @State private var pulsing = false

    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .opacity(pulsing ? 0.85 : 0.45)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(TSSpacing.x3xl)
            .animation(
                reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true),
                value: pulsing
            )
            .onAppear { pulsing = !reduceMotion }
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: LightboxStrings.loading))
            .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Error (web `onError` → broken image; native retry envelope)

/// The retry-able error envelope shown when the image fails to load or decode (web `onError`). Doubles as the
/// offline-fetch state — a failed network load lands here with a "try again" affordance. Token-driven chrome;
/// copy via the P1/S10 facade; combined into a single VoiceOver element with a retry action.
struct LightboxErrorState: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "photo.badge.exclamationmark")
                .font(.system(size: 40, weight: .regular))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text(verbatim: LightboxStrings.errorTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: LightboxStrings.errorMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            LightboxRetryButton(action: onRetry)
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(LightboxStrings.errorTitle). \(LightboxStrings.errorMessage)"))
    }
}

/// The error-envelope retry control — a token-styled pill (the surface owns no shared `<Button>`; native uses
/// SwiftUI `Button` with the design-system chrome). Carries an explicit VoiceOver label.
struct LightboxRetryButton: View {
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Text(verbatim: LightboxStrings.errorRetry)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textPrimary)
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.surfaceGlass.opacity(isHovering ? 1 : 0.7), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .accessibilityLabel(Text(verbatim: LightboxStrings.errorRetry))
    }
}

// MARK: - Empty (web `total === 0` → null; native never a blank box)

/// The friendly empty state shown when an open viewer has no images — the native "never a blank box" peer of
/// the web `if (total === 0) return null`. Token-driven; copy via the P1/S10 facade; one VoiceOver element.
struct LightboxEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 44, weight: .regular))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text(verbatim: LightboxStrings.emptyTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: LightboxStrings.emptyMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(LightboxStrings.emptyTitle). \(LightboxStrings.emptyMessage)"))
    }
}
