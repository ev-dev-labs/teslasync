//
//  CopyButton.swift
//  TeslaSync — P4 shared surface · 0207 · CopyButton (Apple)
//
//  The one-click clipboard button — the SwiftUI parity of `components/ui/CopyButton.tsx`. A single
//  `TSButton` (ghost / small by default, the same defaults as the web component) over the copy-text
//  action, toggling "Copy" → "Copied" for two seconds and (opt-in) firing a success / error toast.
//  Binds through `CopyButtonModel` (the `@MainActor` owner of the text source + clipboard + optional
//  toast + the `onCopy` callback + the transient "Copied" flag); no networking and no side-effecting
//  `Task` plumbing live in the view. Emits `view.opened` once on first appearance (P1/S11), reads its
//  titles + spoken label from the P1/S10 facade, and honours Reduce Motion for the icon / label swap.
//
//  Props mirrored from the web source: `text`, `label` (override the toggling title), `iconOnly`
//  (drop the title for dense rows), `variant` / `size` (default ghost / small), `withToast` (also fire
//  a toast on success / failure), `ariaLabel` (override / auto-generated when `iconOnly`), `disabled`,
//  `title` (native tooltip), and `onCopy` (success callback).
//
//  States rendered: the resting "Copy" + `Copy` glyph, the transient "Copied" + `CheckCircle` (auto-
//  reset after the model's `autoResetDelay`), the icon-only dense variant, and the disabled state. The
//  success / error announcements are driven by the bound toast presenter when `withToast`. The generic
//  data-feed leaf states (loading / empty / stale / offline) do not apply to a stateless, networkless
//  clipboard action and are intentionally absent — the same precedent as the sibling action surfaces
//  ChartExportMenu 0066 / CopyLinkButton 0168.
//

import SwiftUI

// MARK: - CopyButton (the shared surface)

/// The one-click clipboard button — the SwiftUI parity of `components/ui/CopyButton.tsx`. A
/// configurable `TSButton` over the copy-text action, binding through `CopyButtonModel`.
public struct CopyButton: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = CopyButtonMeta.surfaceSlug

    @State private var model: CopyButtonModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let label: String?
    private let iconOnly: Bool
    private let variant: TSButtonVariant
    private let size: TSButtonSize
    private let ariaLabel: String?
    private let isDisabled: Bool
    private let helpTitle: String?

    /// Designated initializer binding a pre-built model + the presentation props (composition root /
    /// tests / previews).
    public init(
        model: CopyButtonModel,
        label: String? = nil,
        iconOnly: Bool = false,
        variant: TSButtonVariant = .ghost,
        size: TSButtonSize = .small,
        ariaLabel: String? = nil,
        disabled: Bool = false,
        title: String? = nil
    ) {
        _model = State(initialValue: model)
        self.label = label
        self.iconOnly = iconOnly
        self.variant = variant
        self.size = size
        self.ariaLabel = ariaLabel
        isDisabled = disabled
        helpTitle = title
    }

    /// Convenience initializer wiring the dependency seams directly — the parity of mounting
    /// `<CopyButton text=… />`. Supply the `text` to copy (a fixed string), an optional `toast`
    /// presenter (the native `useOptionalToast`) plus `withToast` to announce outcomes, and an
    /// `onCopy` success callback.
    public init(
        text: String,
        label: String? = nil,
        iconOnly: Bool = false,
        variant: TSButtonVariant = .ghost,
        size: TSButtonSize = .small,
        withToast: Bool = false,
        ariaLabel: String? = nil,
        disabled: Bool = false,
        title: String? = nil,
        toast: (any CopyButtonToastPresenter)? = nil,
        onCopy: (@MainActor () -> Void)? = nil,
        telemetry: any CopyButtonTelemetry = OSLogCopyButtonTelemetry()
    ) {
        self.init(
            model: CopyButtonModel(
                textProvider: StaticCopyButtonTextSource(text),
                toast: toast,
                withToast: withToast,
                onCopy: onCopy,
                telemetry: telemetry
            ),
            label: label,
            iconOnly: iconOnly,
            variant: variant,
            size: size,
            ariaLabel: ariaLabel,
            disabled: disabled,
            title: title
        )
    }

    public var body: some View {
        let copied = model.copied
        let visibleLabel = iconOnly ? nil : CopyButtonStrings.visibleLabel(
            labelOverride: label,
            copied: copied
        )
        return TSButton(variant: variant, size: size) {
            model.copyText()
        } label: {
            CopyButtonLabel(copied: copied, visibleLabel: visibleLabel, reduceMotion: reduceMotion)
        }
        .disabled(isDisabled)
        .accessibilityLabel(Text(verbatim: CopyButtonStrings.accessibilityLabel(
            ariaLabel: ariaLabel,
            iconOnly: iconOnly,
            labelOverride: label,
            copied: copied
        )))
        .accessibilityAddTraits(.isButton)
        .copyButtonHelp(helpTitle)
        .onAppear { model.markAppeared() }
    }
}

// MARK: - Optional native tooltip (web `title` attribute)

private extension View {
    /// Applies a native help tooltip when the web `title` prop is present — a no-op otherwise so the
    /// accessibility tree is not polluted with an empty help string.
    @ViewBuilder
    func copyButtonHelp(_ title: String?) -> some View {
        if let title, !title.isEmpty {
            help(Text(verbatim: title))
        } else {
            self
        }
    }
}
