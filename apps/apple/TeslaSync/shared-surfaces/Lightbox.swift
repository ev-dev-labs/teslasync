//
//  Lightbox.swift
//  TeslaSync — P4 shared surface · 0219 · Lightbox (Apple)
//
//  The public API of the immersive image viewer — the SwiftUI parity of `components/ui/Lightbox.tsx` and the
//  centerpiece of this surface. Like the web component it is fully controlled: the caller owns `open` and is
//  handed `onClose`; it navigates a sequence with the on-screen prev / next (and ← / → keys), zooms 1x–5x in
//  0.5 steps with the bottom controls (and + / - / 0 keys, plus the web = / _ aliases and Home / End), pans by
//  drag once zoomed, and renders nothing while closed (web `if (!open) return null`). All interaction binds
//  through ``LightboxModel`` (P1/S8); the once-per-open `view.opened` telemetry (P1/S11), the token-driven
//  chrome (P1/S9), and the i18n copy (P1/S10) all live behind the model + the seams. No networking lives in
//  the view — the visible image loads through the injected image-loader seam.
//
//  Host placement: like the web `createPortal(overlay, document.body)`, the caller mounts this at a full-bleed
//  layer (e.g. `.overlay { Lightbox(open: … ) }` or a top-level `ZStack`); it fills the area and dims behind
//  itself, rendering nothing until `open` flips true.
//

import SwiftUI

// MARK: - Public surface (web `<Lightbox open onClose images initialIndex>`)

/// The immersive image viewer — the SwiftUI parity of `components/ui/Lightbox.tsx`. Presents a dimming
/// backdrop behind a counter + close header, a zoom/pan image frame with previous / next navigation, and a
/// caption + zoom-control footer; dismisses via the backdrop, the close button, or Esc. Controlled by the
/// caller's `open` + `onClose`, exactly like the web component.
public struct Lightbox: View {
    @State private var model: LightboxModel
    private let currentInput: LightboxInput
    private let onCloseForUpdate: (@MainActor () -> Void)?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        LightboxSurface.slug
    }

    /// The prop-style initializer — the parity of `<Lightbox open onClose images initialIndex />`. The
    /// `loader` + `telemetry` seams default to the production URLSession loader + the `os.Logger` telemetry;
    /// previews and tests inject in-memory doubles.
    public init(
        open: Bool,
        onClose: @escaping @MainActor () -> Void,
        images: [LightboxImage],
        initialIndex: Int = 0,
        loader: any LightboxImageLoading = URLSessionLightboxImageLoader(),
        telemetry: any LightboxTelemetry = OSLogLightboxTelemetry()
    ) {
        let input = LightboxInput(isOpen: open, images: images, initialIndex: initialIndex)
        currentInput = input
        onCloseForUpdate = onClose
        _model = State(initialValue: LightboxModel(
            input: input,
            onClose: onClose,
            loader: loader,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a static image loader, a
    /// seeded index / zoom). The model owns its own `onClose`, so prop updates here never overwrite it.
    public init(model: LightboxModel) {
        currentInput = model.input
        onCloseForUpdate = nil
        _model = State(initialValue: model)
    }

    public var body: some View {
        ZStack {
            if model.isOpen {
                LightboxOverlay(model: model, reduceMotion: reduceMotion)
                    .background(LightboxKeyAliases(model: model))
                    .modifier(LightboxEscapeDismiss { model.close() })
                    .transition(.opacity)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: currentInput) { _, newInput in
            model.update(newInput, onClose: onCloseForUpdate)
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: model.isOpen)
    }
}

// MARK: - Keyboard aliases (web `=` / `_` / Home / End)

/// The keyboard shortcuts the web routes that have no dedicated on-screen control: `=` / `_` as the zoom-in /
/// zoom-out aliases (so a bare `=` zooms without Shift) and Home / End to jump to the first / last image.
/// Rendered as zero-size, hidden buttons so the shortcuts register without affecting layout; the primary keys
/// (← / → / + / - / 0 / Esc) live on the visible controls.
private struct LightboxKeyAliases: View {
    let model: LightboxModel

    var body: some View {
        ZStack {
            shortcut("=") { model.zoomIn() }
            shortcut("_") { model.zoomOut() }
            shortcut(.home) { model.goFirst() }
            shortcut(.end) { model.goLast() }
        }
        .frame(width: 0, height: 0)
        .opacity(0)
        .accessibilityHidden(true)
    }

    private func shortcut(_ key: KeyEquivalent, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Color.clear.frame(width: 0, height: 0)
        }
        .buttonStyle(.plain)
        .keyboardShortcut(key, modifiers: [])
    }
}

// MARK: - Esc dismissal (macOS)

/// Wires Esc-to-dismiss on macOS as a belt-and-braces companion to the close button's `.cancelAction`
/// shortcut (web Esc handler). A no-op on iOS / iPadOS, where the backdrop tap, the close button, and a
/// hardware-keyboard Esc already dismiss.
private struct LightboxEscapeDismiss: ViewModifier {
    let onClose: () -> Void

    func body(content: Content) -> some View {
        #if os(macOS)
            content.onExitCommand(perform: onClose)
        #else
            content
        #endif
    }
}
