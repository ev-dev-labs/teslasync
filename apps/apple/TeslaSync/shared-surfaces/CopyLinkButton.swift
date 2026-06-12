//
//  CopyLinkButton.swift
//  TeslaSync — P4 shared surface · 0168 · CopyLinkButton (Apple)
//
//  The copy-link button — the SwiftUI parity of `components/layout/CopyLinkButton.tsx`. A single
//  ghost / small `TSButton` that copies the current view's URL to the clipboard so a filtered /
//  deep-linked view can be shared, showing a transient "Copied" confirmation + a success / error
//  toast. Binds through `CopyLinkButtonModel` (the `@MainActor` owner of the ambient URL provider +
//  clipboard + optional toast); no networking and no side-effecting `Task` plumbing live in the
//  view. Emits `view.opened` once on first appearance (P1/S11), reads its title + spoken label from
//  the P1/S10 facade, and honours Reduce Motion for the icon / label swap.
//
//  States rendered: the resting "Copy link" + `Link2`, the transient "Copied" + `Check` (auto-reset
//  after the model's `autoResetDelay`), and the native graceful inert state when no shareable URL is
//  available. The success / error announcements are driven by the bound toast presenter. The generic
//  data-feed leaf states (loading / empty / stale / offline) do not apply to a stateless, networkless
//  clipboard action and are intentionally absent — the same precedent as the sibling action surface
//  ChartExportMenu 0066.
//

import SwiftUI

// MARK: - CopyLinkButton (the shared surface)

/// The copy-link button — the SwiftUI parity of `components/layout/CopyLinkButton.tsx`. A ghost /
/// small control over the copy-current-URL action, binding through `CopyLinkButtonModel`.
public struct CopyLinkButton: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = CopyLinkButtonMeta.surfaceSlug

    @State private var model: CopyLinkButtonModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Designated initializer binding a pre-built model (composition root / tests / previews).
    public init(model: CopyLinkButtonModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the dependency seams directly — the parity of mounting
    /// `<CopyLinkButton/>`. Supply a `urlProvider` for the current view's shareable URL (the native
    /// ambient `window.location.href`), an optional `toast` presenter (the native `useToast`) to
    /// announce outcomes, and the platform clipboard (defaulted).
    public init(
        urlProvider: any CopyLinkURLProviding,
        clipboard: any CopyLinkClipboard = SystemCopyLinkClipboard(),
        toast: (any CopyLinkButtonToastPresenter)? = nil,
        telemetry: any CopyLinkButtonTelemetry = OSLogCopyLinkButtonTelemetry()
    ) {
        _model = State(initialValue: CopyLinkButtonModel(
            urlProvider: urlProvider,
            clipboard: clipboard,
            toast: toast,
            telemetry: telemetry
        ))
    }

    /// Convenience initializer for the common case — a closure that resolves the current view's URL
    /// fresh on each copy (the native parity of reading the ambient `window.location.href`), wired to
    /// the system clipboard. Supply a `toast` presenter to announce outcomes.
    public init(
        url: @escaping @MainActor () -> String,
        toast: (any CopyLinkButtonToastPresenter)? = nil,
        telemetry: any CopyLinkButtonTelemetry = OSLogCopyLinkButtonTelemetry()
    ) {
        self.init(
            urlProvider: ResolvingCopyLinkURLSource(url),
            toast: toast,
            telemetry: telemetry
        )
    }

    public var body: some View {
        TSButton(variant: .ghost, size: .small) {
            model.copyLink()
        } label: {
            CopyLinkButtonLabel(copied: model.copied, reduceMotion: reduceMotion)
        }
        .disabled(!model.canCopy)
        .accessibilityLabel(Text(verbatim: CopyLinkButtonStrings.accessibilityLabel()))
        .accessibilityValue(Text(verbatim: CopyLinkButtonStrings.label(copied: model.copied)))
        .accessibilityAddTraits(.isButton)
        .onAppear { model.markAppeared() }
    }
}
