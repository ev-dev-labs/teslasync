//
//  Lightbox.Controls.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  The leaf controls of the immersive viewer — the native peers of the web buttons + chrome: the icon button
//  (close / previous / next / zoom), the "n / total" counter, the caption line, and the zoom-control cluster.
//  Split from Lightbox.Views.swift for the SwiftLint file-length budget. Every control is token-driven (P1/S9)
//  — no raw hex, no Tailwind ports — and carries an explicit VoiceOver label; disabled controls mirror the web
//  `disabled:opacity-40 disabled:cursor-not-allowed` and drop out of the keyboard-shortcut routing.
//

import SwiftUI

// MARK: - Control style

/// The two control fills mirrored from the web: `solid` is the always-visible nav button
/// (`bg-[var(--surface-1)]/80`); `ghost` is the transparent-until-hover close / zoom button
/// (`hover:bg-[var(--surface-2)]`).
enum LightboxControlStyle {
    case solid
    case ghost
}

// MARK: - Icon button (web `<button aria-label>`)

/// A circular (or rounded-square) icon button — the native peer of the web control buttons. Honours a
/// disabled state (web `disabled` → dimmed + inert), a hover tint, and an explicit VoiceOver label. The
/// caller attaches the keyboard shortcut; a disabled button drops the shortcut automatically.
struct LightboxIconButton: View {
    let systemName: String
    let label: String
    var diameter: CGFloat = 44
    var iconSize: CGFloat = 18
    var cornerRadius: CGFloat?
    var style: LightboxControlStyle = .ghost
    var isEnabled: Bool = true
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: iconSize, weight: .semibold))
                .foregroundStyle(isEnabled ? Color.TS.textPrimary : Color.TS.textMuted)
                .frame(width: diameter, height: diameter)
                .background(Color.TS.surfaceGlass.opacity(backgroundOpacity), in: shape)
                .contentShape(shape)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.4)
        .onHover { isHovering = $0 }
        .accessibilityLabel(Text(verbatim: label))
    }

    private var shape: AnyShape {
        if let cornerRadius {
            AnyShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        } else {
            AnyShape(Circle())
        }
    }

    private var backgroundOpacity: Double {
        switch style {
        case .solid: isHovering ? 1 : 0.8
        case .ghost: isHovering ? 0.6 : 0
        }
    }
}

// MARK: - Counter (web `lightbox.counter`)

/// The "n / total" position readout (web `lightbox.counter`), rendered top-leading. 1-based current index.
struct LightboxCounter: View {
    let current: Int
    let total: Int

    var body: some View {
        Text(verbatim: LightboxStrings.counter(current: current, total: total))
            .font(Font.TS.label)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityLabel(Text(verbatim: LightboxStrings.counter(current: current, total: total)))
    }
}

// MARK: - Caption (web `current.caption`)

/// The optional caption rendered below the image (web `current.caption`). Renders nothing when absent or
/// empty, mirroring the web `current.caption ? … : null`.
struct LightboxCaption: View {
    let caption: String?

    var body: some View {
        if let caption, !caption.isEmpty {
            Text(verbatim: caption)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 640)
        }
    }
}

// MARK: - Zoom controls (web zoom cluster)

/// The zoom-control cluster (web bottom pill): zoom-out, the live percentage readout, zoom-in, and reset —
/// each bounds-disabled from the projection (web `disabled={!canZoomOut}` etc.) and keyboard-wired (`-` / `+`
/// / `0`, plus the web `=` / `_` aliases handled by the dialog key router).
struct LightboxZoomControls: View {
    let projection: LightboxProjection
    let onZoomOut: () -> Void
    let onZoomIn: () -> Void
    let onReset: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            LightboxIconButton(
                systemName: "minus",
                label: LightboxStrings.zoomOut,
                diameter: 36,
                iconSize: 14,
                isEnabled: projection.canZoomOut,
                action: onZoomOut
            )
            .keyboardShortcut("-", modifiers: [])

            Text(verbatim: LightboxStrings.zoomPercent(projection.zoomPercent))
                .font(Font.TS.label)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
                .frame(minWidth: 56)
                .accessibilityLabel(Text(verbatim: LightboxStrings.zoomPercent(projection.zoomPercent)))
                .accessibilityAddTraits(.updatesFrequently)

            LightboxIconButton(
                systemName: "plus",
                label: LightboxStrings.zoomIn,
                diameter: 36,
                iconSize: 14,
                isEnabled: projection.canZoomIn,
                action: onZoomIn
            )
            .keyboardShortcut("+", modifiers: [])

            LightboxIconButton(
                systemName: "arrow.counterclockwise",
                label: LightboxStrings.zoomReset,
                diameter: 36,
                iconSize: 14,
                isEnabled: projection.canReset,
                action: onReset
            )
            .keyboardShortcut("0", modifiers: [])
        }
        .padding(TSSpacing.xs)
        .background(Color.TS.surfaceGlass.opacity(0.7), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
    }
}
