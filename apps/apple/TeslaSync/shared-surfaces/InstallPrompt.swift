//
//  InstallPrompt.swift
//  TeslaSync — P4 shared surface · 0125 · InstallPrompt (Apple)
//
//  The SwiftUI surface — the public API of the install prompt, the parity of the web `InstallPrompt`
//  (`components/feedback/InstallPrompt.tsx`). The view binds through `InstallPromptModel` (P1/S8) for
//  the resolved availability + the once-only `view.opened` telemetry (P1/S11); no probing, persistence
//  or broadcast lives here. Chrome is token-driven (P1/S9) and every string resolves through the
//  P1/S10 facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the install-availability probe in flight → skeleton prompt chrome.
//    • empty   — already installed / dismissed within 14 days / no affordance (web standalone /
//                wasDismissedRecently / no beforeinstallprompt) → a calm, honest card per kind (the
//                native improvement over the web prompt rendering nothing), never a blank box.
//    • error   — the probe failed → a retryable error tile (web `QueryError` peer).
//    • data    — the active install prompt: the gradient glyph + title + subtitle + Install + dismiss
//                (web visible bottom card).
//    • stale / offline — the orthogonal connectivity axis → a freshness chip beneath the surface with
//                a one-shot auto-refresh (re-probe) on the stale transition.
//
//  Mounting parity: the web prompt is mounted once globally in `<Layout>`. The app mounts
//  `InstallPrompt(model: .live(onInstall:))` as bottom chrome.
//

import SwiftUI

// MARK: - InstallPrompt (the shared surface)

/// The install prompt — the SwiftUI parity of `InstallPrompt.tsx`. Renders every state plus the P4
/// leaf connectivity states, binding through `InstallPromptModel`.
public struct InstallPrompt: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — re-exposed from the model so app callers can
    /// reference `InstallPrompt.surfaceSlug` while the canonical value lives in the pure core.
    public static let surfaceSlug = InstallPromptModel.surfaceSlug

    @State private var model: InstallPromptModel

    public init(model: InstallPromptModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for controlled / preview / test usage. The supplied signals drive the
    /// rendered state without touching the device probe, persistence, or broadcast; production mounts
    /// `InstallPrompt(model: .live(onInstall:))` instead.
    ///
    /// - Parameter onInstall: the embedder's real install action — returns whether the user accepted
    ///   (web `userChoice.outcome === 'accepted'`), so the prompt can hide on success.
    public init(
        canInstall: Bool = true,
        isInstalled: Bool = false,
        dismissed: Bool = false,
        connection: InstallPromptConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        onInstall: (@MainActor () -> Bool)? = nil,
        telemetry: any InstallPromptTelemetry = OSLogInstallPromptTelemetry()
    ) {
        let source = InMemoryInstallPromptSource(initial: InstallPromptInput(
            canInstall: canInstall,
            isInstalled: isInstalled,
            dismissed: dismissed,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        ))
        _model = State(initialValue: InstallPromptModel(
            source: source,
            telemetry: telemetry,
            onInstall: onInstall
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                InstallPromptFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            InstallPromptLoadingView()
        case .empty:
            InstallPromptEmptyView(kind: model.resolved.emptyKind ?? .unavailable)
        case let .error(message):
            InstallPromptErrorView(message: message) { model.refresh() }
        case .data:
            InstallPromptCard(
                onInstall: { model.install() },
                onDismiss: { model.dismiss() }
            )
        }
    }
}
