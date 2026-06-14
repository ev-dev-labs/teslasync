//
//  PrintButton.swift
//  TeslaSync — P4 shared surface · 0223 · PrintButton (Apple)
//
//  The print button — the SwiftUI parity of `components/ui/PrintButton.tsx`. A single `TSButton`
//  (ghost / small by default, the same defaults as the web component) over the print action, opening
//  the platform print panel after an optional awaited `beforePrint` setup hook. Binds through
//  `PrintButtonModel` (the `@MainActor` owner of the print presenter + the `beforePrint` hook + the
//  transient `isPrinting` re-entrancy guard); no print-server plumbing lives in the view. Emits
//  `view.opened` once on first appearance (P1/S11) and reads its label + spoken label from the P1/S10
//  facade.
//
//  Props mirrored from the web source: `label` (override the "Print" title), `iconOnly` (drop the
//  title for dense toolbars), `beforePrint` (the awaited setup hook), `variant` / `size` (default
//  ghost / small), `ariaLabel` (override / auto-derived when `iconOnly`), and `disabled`. The web
//  `className` is a Tailwind seam with no native analogue (styling comes from the P1/S9 tokens via
//  `TSButton`) and the web `data-print-hide` attribute has no analogue either (the native print panel
//  renders the supplied document, never the live control), so both are intentionally absent.
//
//  States rendered: the resting "Print" + `Printer` glyph, the icon-only dense variant, the
//  custom-label variant, and the disabled state. The in-flight `printing` guard is reproduced in the
//  model (non-visual in the web source, so the control's appearance is intentionally unchanged). The
//  generic data-feed leaf states (loading / empty / stale / offline) do not apply to a stateless,
//  networkless print trigger and are intentionally absent — the same precedent as the sibling action
//  surfaces ChartExportMenu 0066 / CopyLinkButton 0168 / CopyButton 0207 / FullscreenButton 0214.
//

import SwiftUI

// MARK: - PrintButton (the shared surface)

/// The print button — the SwiftUI parity of `components/ui/PrintButton.tsx`. A configurable `TSButton`
/// over the print action, binding through `PrintButtonModel`.
public struct PrintButton: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PrintButtonMeta.surfaceSlug

    @State private var model: PrintButtonModel

    private let label: String?
    private let iconOnly: Bool
    private let variant: TSButtonVariant
    private let size: TSButtonSize
    private let ariaLabel: String?
    private let isDisabled: Bool

    /// Designated initializer binding a pre-built model + the presentation props (composition root /
    /// tests / previews).
    public init(
        model: PrintButtonModel,
        label: String? = nil,
        iconOnly: Bool = false,
        variant: TSButtonVariant = .ghost,
        size: TSButtonSize = .small,
        ariaLabel: String? = nil,
        disabled: Bool = false
    ) {
        _model = State(initialValue: model)
        self.label = label
        self.iconOnly = iconOnly
        self.variant = variant
        self.size = size
        self.ariaLabel = ariaLabel
        isDisabled = disabled
    }

    /// Convenience initializer wiring the dependency seams directly — the parity of mounting
    /// `<PrintButton beforePrint=… />`. Supply the optional `beforePrint` setup hook (awaited before
    /// the dialog opens) and the platform `presenter` (defaults to the process-wide
    /// `SystemPrintPresenter`).
    public init(
        beforePrint: (@MainActor () async throws -> Void)? = nil,
        presenter: any PrintPresenting = SystemPrintPresenter.shared,
        label: String? = nil,
        iconOnly: Bool = false,
        variant: TSButtonVariant = .ghost,
        size: TSButtonSize = .small,
        ariaLabel: String? = nil,
        disabled: Bool = false,
        telemetry: any PrintButtonTelemetry = OSLogPrintButtonTelemetry()
    ) {
        self.init(
            model: PrintButtonModel(
                presenter: presenter,
                beforePrint: beforePrint,
                telemetry: telemetry
            ),
            label: label,
            iconOnly: iconOnly,
            variant: variant,
            size: size,
            ariaLabel: ariaLabel,
            disabled: disabled
        )
    }

    public var body: some View {
        let visibleLabel = iconOnly ? nil : PrintButtonStrings.visibleLabel(labelOverride: label)
        return TSButton(variant: variant, size: size) {
            model.requestPrint()
        } label: {
            PrintButtonLabel(visibleLabel: visibleLabel)
        }
        .disabled(isDisabled)
        .accessibilityLabel(Text(verbatim: PrintButtonStrings.accessibilityLabel(
            ariaLabel: ariaLabel,
            labelOverride: label
        )))
        .accessibilityAddTraits(.isButton)
        .onAppear { model.markAppeared() }
    }
}
