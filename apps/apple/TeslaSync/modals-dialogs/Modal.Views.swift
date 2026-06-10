//
//  Modal.Views.swift
//  TeslaSync — P4 modal/dialog · 0014 · Modal (Apple)
//
//  The overlay chrome for `Modal` — the populated parity of components/ui/Modal.tsx's structure: the
//  backdrop scrim (web `onClick={onClose}` blurred backdrop), the per-edge rounded dialog surface
//  (web `rounded-none` mobile sheet / `sm:rounded-lg` card), the titled header with the 44×44 close
//  button (web `h-11 w-11`, WCAG 2.5.5), the drag grabber for the bottom-sheet idiom, and the
//  scrolling body. All copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Scrim (web blurred backdrop)

/// The dimming backdrop behind the dialog. A tap dismisses (web backdrop `onClick={onClose}`); it is
/// hidden from assistive tech (web `aria-hidden="true"`) — VoiceOver users dismiss via the dialog's
/// escape action instead.
struct ModalScrim: View {
    let onTap: () -> Void

    var body: some View {
        Color.black
            .opacity(0.45)
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture(perform: onTap)
            .accessibilityHidden(true)
    }
}

// MARK: - Close button (web 44×44 close)

/// The header close affordance (web `<button aria-label="Close">`). Sized to the 44pt minimum touch
/// target regardless of the glyph, satisfying WCAG 2.5.5 the same way the web `h-11 w-11` does.
struct ModalCloseButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: ModalAdapter.closeButtonSide, height: ModalAdapter.closeButtonSide)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: ModalStrings.string("modal.close", "Close")))
    }
}

// MARK: - Grabber (bottom-sheet drag handle)

/// The drag handle shown on the compact bottom sheet — the native affordance for the web full-screen
/// mobile sheet. Decorative; hidden from assistive tech.
struct ModalGrabber: View {
    var body: some View {
        Capsule()
            .fill(Color.TS.textMuted.opacity(0.4))
            .frame(width: 36, height: 5)
            .padding(.top, TSSpacing.sm)
            .padding(.bottom, TSSpacing.xs)
            .accessibilityHidden(true)
    }
}

// MARK: - Header (web titled header row)

/// The dialog header (web `title && (<div class="…border-b…">)`): the truncating heading, an
/// optional trailing accessory (the freshness chip), and the close button, over a hairline divider.
struct ModalHeader<Trailing: View>: View {
    let title: String
    let onClose: () -> Void
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            trailing()
            ModalCloseButton(action: onClose)
        }
        .padding(.leading, TSSpacing.lg)
        .padding(.trailing, TSSpacing.sm)
        .padding(.top, TSSpacing.sm)
        .padding(.bottom, TSSpacing.sm)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
        }
    }
}

// MARK: - Dialog surface (web framed panel)

/// The framed dialog itself: an opaque surface (web `bg-[var(--surface-1)]`) clipped to the per-edge
/// radii, stroked with the glass border, elevated with a shadow, sized to the resolved width and
/// capped to the viewport-height fraction. Composes the optional grabber + header over the scrolling
/// body, and carries the full accessibility contract (web `role="dialog"` + `aria-modal` + label +
/// Esc).
struct ModalDialogSurface<HeaderTrailing: View, BodyContent: View>: View {
    let metrics: ModalMetrics
    let title: String?
    let accessibilityLabel: String
    let onClose: () -> Void
    @ViewBuilder let headerTrailing: () -> HeaderTrailing
    @ViewBuilder let bodyContent: () -> BodyContent

    var body: some View {
        VStack(spacing: 0) {
            if metrics.showsGrabber {
                ModalGrabber()
            }
            if let title, !title.isEmpty {
                ModalHeader(title: title, onClose: onClose, trailing: headerTrailing)
            }
            ScrollView {
                bodyContent()
                    .padding(.horizontal, TSSpacing.lg)
                    .padding(.vertical, TSSpacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: metrics.bodyMaxHeight)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(width: metrics.width)
        .frame(maxHeight: metrics.maxHeight)
        .background(Color.TS.surface, in: shape)
        .overlay(shape.strokeBorder(Color.TS.border, lineWidth: 1))
        .clipShape(shape)
        .shadow(color: .black.opacity(0.28), radius: 26, x: 0, y: 14)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(.isModal)
        .accessibilityAction(.escape, onClose)
    }

    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: metrics.radii.topLeading,
            bottomLeadingRadius: metrics.radii.bottomLeading,
            bottomTrailingRadius: metrics.radii.bottomTrailing,
            topTrailingRadius: metrics.radii.topTrailing,
            style: .continuous
        )
    }
}

// MARK: - Resolved metrics (geometry → adapter)

/// The geometry-resolved metrics a `ModalDialogSurface` renders with, computed once per layout pass
/// from `ModalAdapter` so the view holds no breakpoint maths.
struct ModalMetrics: Equatable {
    let width: CGFloat
    let maxHeight: CGFloat
    let bodyMaxHeight: CGFloat
    let radii: ModalCornerRadii
    let showsGrabber: Bool
    let pinsToBottom: Bool

    /// Resolves the metrics for a viewport from the pure adapter.
    static func resolve(size: ModalSize, viewport: CGSize) -> ModalMetrics {
        let width = ModalAdapter.resolvedWidth(for: size, in: viewport.width)
        let fraction = ModalAdapter.maxHeightFraction(width: viewport.width)
        let maxHeight = max(0, viewport.height * fraction)
        return ModalMetrics(
            width: width,
            maxHeight: maxHeight,
            bodyMaxHeight: maxHeight,
            radii: ModalAdapter.cornerRadii(width: viewport.width),
            showsGrabber: ModalAdapter.isCompact(width: viewport.width),
            pinsToBottom: ModalAdapter.pinsToBottom(width: viewport.width)
        )
    }
}
