//
//  Lightbox.Views.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  The composed chrome of the immersive viewer — the native peers of the web overlay structure: the dimming
//  backdrop (web blurred `bg-[var(--bg-app)]/95`, tap-to-close), the top bar (counter + close), the image
//  area (the decode-aware frame with the drag-to-pan surface + the previous / next nav), and the bottom bar
//  (caption + zoom cluster). Composition only — the leaf controls live in Lightbox.Controls.swift and the
//  load-phase chrome in Lightbox.States.swift. The backdrop is a sibling below the content (web pattern) so
//  taps in the margins fall through to it and dismiss, while the content's controls capture their own taps.
//

import SwiftUI

// MARK: - Overlay (web portal overlay)

/// The full-viewport overlay — the native peer of the web `createPortal(overlay, document.body)`. Stacks the
/// tap-to-close backdrop beneath the viewer chrome, exposes the dialog as a single modal accessibility
/// container (web `role="dialog"` + `aria-modal`), and renders the friendly empty state when there are no
/// images (web `total === 0` returns null; native never a blank box).
struct LightboxOverlay: View {
    let model: LightboxModel
    let reduceMotion: Bool

    var body: some View {
        ZStack {
            backdrop
            content
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LightboxStrings.dialog))
        .accessibilityAddTraits(.isModal)
    }

    private var backdrop: some View {
        Color.TS.bg
            .opacity(0.95)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture { model.close() }
            .accessibilityHidden(true)
    }

    @ViewBuilder private var content: some View {
        if model.total == 0 {
            LightboxEmptyChrome(model: model)
        } else {
            VStack(spacing: 0) {
                LightboxTopBar(model: model)
                LightboxImageArea(model: model, reduceMotion: reduceMotion)
                LightboxBottomBar(model: model)
            }
        }
    }
}

// MARK: - Top bar (web counter + close)

/// The top bar — the counter (web `lightbox.counter`, leading) and the close button (web `lightbox.close`,
/// trailing, Esc-wired). Mirrors the web `justify-between` row.
struct LightboxTopBar: View {
    let model: LightboxModel

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            LightboxCounter(current: model.index + 1, total: model.total)
            Spacer(minLength: TSSpacing.md)
            closeButton
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.top, TSSpacing.lg)
        .padding(.bottom, TSSpacing.sm)
    }

    private var closeButton: some View {
        LightboxIconButton(
            systemName: "xmark",
            label: LightboxStrings.close,
            diameter: 44,
            iconSize: 17,
            cornerRadius: TSRadius.md,
            action: { model.close() }
        )
        .keyboardShortcut(.cancelAction)
    }
}

// MARK: - Image area (web flex-1 image frame + nav)

/// The image frame — the decode-aware content (web `<img>` + skeleton) with the live zoom + pan transform,
/// overlaid by the previous / next nav buttons when the sequence has more than one image (web
/// `{total > 1 && …}`). Drag-to-pan is active only while zoomed (web `if (zoom <= 1) return`).
struct LightboxImageArea: View {
    let model: LightboxModel
    let reduceMotion: Bool

    @State private var panStart: LightboxPan?

    var body: some View {
        ZStack {
            if let image = model.currentImage {
                LightboxImageContent(
                    phase: model.loadPhase,
                    image: image,
                    zoom: model.zoom,
                    pan: model.pan,
                    onRetry: { model.retry() },
                    reduceMotion: reduceMotion
                )
                .gesture(panGesture)
            }
            if model.projection.showsNavigation {
                navButtons
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, TSSpacing.x2xl)
        .clipped()
    }

    private var navButtons: some View {
        HStack {
            LightboxIconButton(
                systemName: "chevron.left",
                label: LightboxStrings.previous,
                diameter: 48,
                iconSize: 20,
                style: .solid,
                isEnabled: !model.projection.isFirst,
                action: { model.goPrevious() }
            )
            .keyboardShortcut(.leftArrow, modifiers: [])
            Spacer()
            LightboxIconButton(
                systemName: "chevron.right",
                label: LightboxStrings.next,
                diameter: 48,
                iconSize: 20,
                style: .solid,
                isEnabled: !model.projection.isLast,
                action: { model.goNext() }
            )
            .keyboardShortcut(.rightArrow, modifiers: [])
        }
    }

    /// The drag-to-pan gesture (web pointer drag). Captures the pan at gesture start and tracks the
    /// translation; a no-op unless zoomed, so an un-zoomed image still passes taps through.
    private var panGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { value in
                guard model.projection.isZoomed else { return }
                let base = panStart ?? model.pan
                if panStart == nil { panStart = model.pan }
                model.setPan(LightboxPan(x: base.x + value.translation.width, y: base.y + value.translation.height))
            }
            .onEnded { _ in panStart = nil }
    }
}

// MARK: - Bottom bar (web caption + zoom cluster)

/// The bottom bar — the optional caption (web `current.caption`) above the zoom-control cluster (web bottom
/// pill). Centred, mirroring the web column.
struct LightboxBottomBar: View {
    let model: LightboxModel

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            LightboxCaption(caption: model.currentImage?.caption)
            LightboxZoomControls(
                projection: model.projection,
                onZoomOut: { model.zoomOut() },
                onZoomIn: { model.zoomIn() },
                onReset: { model.zoomReset() }
            )
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, TSSpacing.lg)
        .padding(.top, TSSpacing.sm)
        .padding(.bottom, TSSpacing.lg)
    }
}

// MARK: - Empty chrome (web `total === 0` → null; native never a blank box)

/// The chrome shown when an open viewer has no images: a minimal top bar with just the close button (so the
/// surface is always dismissible) over the friendly empty state.
struct LightboxEmptyChrome: View {
    let model: LightboxModel

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                LightboxIconButton(
                    systemName: "xmark",
                    label: LightboxStrings.close,
                    diameter: 44,
                    iconSize: 17,
                    cornerRadius: TSRadius.md,
                    action: { model.close() }
                )
                .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.top, TSSpacing.lg)
            LightboxEmptyState()
        }
    }
}
