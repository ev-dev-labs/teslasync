//
//  TeslaAccountSection.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  The Tesla-account settings surface — the production-polished, Apple-idiomatic SwiftUI parity of
//  web/src/features/settings/components/TeslaAccountSection.tsx. Renders the IconBox header, the
//  connection status box (connected / disconnected / not-connected with the "expires soon" pill + the
//  token-expiry line), the action group (Connect — or Refresh / Sync / Re-authorize / Disconnect), and
//  the synced-count success line inside a glass panel, binding through `TeslaAccountModel` (P1/S8); the
//  freshness chip, the stale/offline banner, the loading skeleton, the retryable error view, the
//  disconnect confirmation sheet, and the success/failure toast cover every state the web source + the
//  P4 states contract require. No networking, no store access, and no English literals live in the view.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial auth-status fetch → section silhouette skeleton.
//    • empty    — auth status resolved with no concrete `authenticated` value → friendly never-blank
//                 section (the web falsy-auth surface).
//    • error    — auth-status fetch failure → retryable "couldn't load" (P4 leaf).
//    • data     — the concrete connected / disconnected / not-connected surface + the action group.
//    • stale / offline — the orthogonal `connection` axis → freshness chip + banner with a one-shot
//                 auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - TeslaAccountSection (the feature surface)

/// The Tesla-account settings section — renders every state from the web source plus the P4 leaf
/// freshness states, binding through `TeslaAccountModel`. The four account mutations, the disconnect
/// confirmation, and the toast feedback are all owned by the model; the view stays a pure function of
/// its observable state.
public struct TeslaAccountSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TeslaAccountDiagnostics.surface

    @State private var model: TeslaAccountModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameter model: the bound view-model (built over the P1/S8 status + actions + opener seams).
    public init(model: TeslaAccountModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        panel
            .overlay(alignment: .bottom) { toastOverlay }
            .animation(reduceMotion ? nil : .spring(duration: TSMotion.normalDuration), value: model.toast)
            .sheet(isPresented: disconnectBinding) {
                TeslaAccountDisconnectConfirmSheet(model: model)
            }
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: TeslaAccountStrings.string("tesla.title", "Tesla Account")))
    }
}

// MARK: - Panel chrome

private extension TeslaAccountSection {
    var panel: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            header
            if model.connection != .live {
                TeslaAccountConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
    }

    var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TeslaAccountHeader()
            Spacer(minLength: TSSpacing.sm)
            VStack(alignment: .trailing, spacing: TSSpacing.xs) {
                TeslaAccountFreshnessChip(connection: model.connection)
                TeslaAccountRefreshButton { model.refresh() }
            }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension TeslaAccountSection {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            TeslaAccountLoadingView()
        case let .error(message):
            TeslaAccountErrorView(message: message) { model.refresh() }
        case let .empty(presentation), let .data(presentation):
            TSFadeIn {
                resolvedContent(presentation)
            }
        }
    }

    func resolvedContent(_ presentation: TeslaAccountPresentation) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TeslaAccountStatusRow(presentation: presentation)
            TeslaAccountActionRow(model: model, presentation: presentation)
            if let count = model.syncedCount {
                TeslaAccountSyncedMessage(count: count)
            }
        }
    }
}

// MARK: - Disconnect sheet + toast overlay

private extension TeslaAccountSection {
    /// Mirrors the model's disconnect-confirm flag; a swipe-to-dismiss routes back through
    /// `cancelDisconnect()` so the in-flight guard is honored.
    var disconnectBinding: Binding<Bool> {
        Binding(
            get: { model.disconnectPresented },
            set: { newValue in
                if !newValue { model.cancelDisconnect() }
            }
        )
    }

    @ViewBuilder
    var toastOverlay: some View {
        if let toast = model.toast {
            TeslaAccountToastView(toast: toast) { model.dismissToast() }
                .padding(.bottom, TSSpacing.lg)
                .padding(.horizontal, TSSpacing.lg)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: toast.id) {
                    try? await Task.sleep(for: .seconds(3))
                    model.dismissToast()
                }
        }
    }
}
