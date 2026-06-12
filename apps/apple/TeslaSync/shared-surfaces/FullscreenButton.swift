//
//  FullscreenButton.swift
//  TeslaSync — P4 shared surface · 0214 · FullscreenButton (Apple)
//
//  The fullscreen toggle button — the SwiftUI parity of `components/ui/FullscreenButton.tsx`. A single
//  `TSButton` (ghost / small by default, the same defaults as the web component) over the fullscreen
//  toggle action, swapping the "expand" glyph + "Enter fullscreen" for the "collapse" glyph + "Exit
//  fullscreen" as the bound target enters / leaves fullscreen. Binds through `FullscreenButtonModel`
//  (the `@MainActor` owner of the target identity + the platform presenter + the support / label
//  overrides); no window plumbing lives in the view. Hides itself entirely when the platform cannot
//  present element-level fullscreen (web `if (!supported) return null`), sources its on/off state
//  from the observable presenter so it stays honest on an Esc-out / system revoke / sibling toggle
//  (web `fullscreenchange`, not the tap), emits `view.opened` once on first appearance (P1/S11), reads
//  its labels from the P1/S10 facade, and honours Reduce Motion for the glyph swap.
//
//  Props mirrored from the web source: `targetRef` → `targetID` (+ `descendantIDs`, the web
//  `target.contains(el)` set), `ariaLabelEnter` / `ariaLabelExit` (override the enter / exit labels),
//  `size` (default small), and `testHookSupported` → `supportOverride` (force the support probe in
//  previews / tests). The web `className` is a Tailwind seam with no native analogue — styling comes
//  from the P1/S9 tokens via `TSButton`, so it is intentionally absent.
//
//  States rendered: hidden (unsupported), the resting "Enter fullscreen" + expand glyph (pressed
//  false), the active "Exit fullscreen" + collapse glyph (pressed true), and the detached-target
//  no-op. The generic data-feed leaf states (loading / empty / stale / offline) do not apply to a
//  stateless, networkless presentation-toggle primitive and are intentionally absent — the same
//  precedent as the sibling action surfaces ChartExportMenu 0066 / CopyLinkButton 0168 /
//  CopyButton 0207.
//

import SwiftUI

// MARK: - FullscreenButton (the shared surface)

/// The fullscreen toggle button — the SwiftUI parity of `components/ui/FullscreenButton.tsx`. A
/// configurable `TSButton` over the fullscreen toggle, binding through `FullscreenButtonModel`.
public struct FullscreenButton: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = FullscreenButtonMeta.surfaceSlug

    @State private var model: FullscreenButtonModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let size: TSButtonSize

    /// Designated initializer binding a pre-built model + the presentation size (composition root /
    /// tests / previews).
    public init(model: FullscreenButtonModel, size: TSButtonSize = .small) {
        _model = State(initialValue: model)
        self.size = size
    }

    /// Convenience initializer wiring the dependency seams directly — the parity of mounting
    /// `<FullscreenButton targetRef=… />`. Supply the `targetID` to toggle (the native parity of
    /// `targetRef`), the optional descendant set (web `target.contains(el)`), the platform `presenter`
    /// (defaults to the process-wide `SystemFullscreenPresenter`), optional enter / exit label
    /// overrides (web `ariaLabelEnter` / `ariaLabelExit`), and the `supportOverride` (web
    /// `testHookSupported`).
    public init(
        targetID: String?,
        descendantIDs: Set<String> = [],
        presenter: any FullscreenPresenting = SystemFullscreenPresenter.shared,
        size: TSButtonSize = .small,
        ariaLabelEnter: String? = nil,
        ariaLabelExit: String? = nil,
        supportOverride: Bool? = nil,
        telemetry: any FullscreenButtonTelemetry = OSLogFullscreenButtonTelemetry()
    ) {
        self.init(
            model: FullscreenButtonModel(
                targetID: targetID,
                descendantIDs: descendantIDs,
                presenter: presenter,
                supportOverride: supportOverride,
                enterLabelOverride: ariaLabelEnter,
                exitLabelOverride: ariaLabelExit,
                telemetry: telemetry
            ),
            size: size
        )
    }

    public var body: some View {
        // Web `if (!supported) return null` — the button removes itself entirely when the platform
        // cannot present element-level fullscreen (no pseudo-fullscreen fallback, by contract).
        if model.isSupported {
            let isFullscreen = model.isFullscreen
            let label = model.resolvedLabel
            TSButton(variant: .ghost, size: size) {
                model.toggle()
            } label: {
                FullscreenButtonLabel(isFullscreen: isFullscreen, reduceMotion: reduceMotion)
            }
            .accessibilityLabel(Text(verbatim: label))
            // aria-pressed parity — VoiceOver reads the control as selected while fullscreen is active.
            .accessibilityAddTraits(isFullscreen ? [.isButton, .isSelected] : .isButton)
            .help(Text(verbatim: label))
            .onAppear { model.markAppeared() }
        }
    }
}
