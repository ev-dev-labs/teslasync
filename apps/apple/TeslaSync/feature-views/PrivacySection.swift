//
//  PrivacySection.swift
//  TeslaSync — P4 feature view · 0209 · PrivacySection (Apple)
//
//  The Privacy settings surface — the production-polished, Apple-idiomatic SwiftUI
//  parity of web/src/features/settings/components/PrivacySection.tsx. Renders the header,
//  the recent-pages control, and the cookie/analytics consent control inside a glass
//  panel, binding through `PrivacyModel` (P1/S8); the consent-policy status banner, the
//  loading skeleton, the destructive clear-confirmation sheet (with its silence opt-in),
//  and the success toast cover every state the web source + the P4 states contract require.
//  No networking, no store access, and no English literals live in the view.
//

import SwiftUI

/// The Privacy settings section — the SwiftUI parity of the web `PrivacySection`. Always
/// rendered (web contract); the loading skeleton shows only until the deployment consent
/// policy first resolves, after which the always-on client-side controls are revealed.
public struct PrivacySection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PrivacyDiagnostics.surface

    @State private var model: PrivacyModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameter model: the bound view-model (built over the four P1/S8 seams).
    public init(model: PrivacyModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { toastOverlay }
            .animation(reduceMotion ? nil : .spring(duration: TSMotion.normalDuration), value: model.toast)
            .sheet(isPresented: confirmBinding) { confirmationSheet }
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(PrivacyStrings.text("privacy.section.a11y", "Privacy settings"))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            PrivacySkeleton()
                .padding(TSSpacing.xl)
                .tsGlassPanel()
        case .ready:
            loaded
        }
    }

    private var loaded: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let banner = PrivacyAdapter.statusBanner(status: model.status, freshness: model.freshness) {
                PrivacyStatusBannerView(banner: banner) { model.refresh() }
            }
            PrivacyHeader()
            PrivacyRowPanel {
                PrivacyRecentRow(count: model.recentCount) { model.requestClearRecentPages() }
            }
            PrivacyRowPanel {
                PrivacyConsentRow(
                    consent: model.consent,
                    requireConsent: model.requireConsent
                ) { action in
                    model.performConsent(action)
                }
            }
        }
        .padding(TSSpacing.xl)
        .tsGlassPanel()
    }

    // MARK: Toast

    @ViewBuilder
    private var toastOverlay: some View {
        if let toast = model.toast {
            PrivacyToastView(message: toast.message)
                .padding(.bottom, TSSpacing.xl)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: toast.id) {
                    try? await Task.sleep(for: .seconds(2.5))
                    model.dismissToast()
                }
        }
    }

    // MARK: Confirmation sheet

    private var confirmBinding: Binding<Bool> {
        Binding(
            get: { model.confirmPresented },
            set: { if !$0 { model.cancelClearRecentPages() } }
        )
    }

    private var confirmationSheet: some View {
        @Bindable var model = model
        return PrivacyClearConfirmation(
            dontAskAgain: $model.dontAskAgain,
            onConfirm: { model.confirmClearRecentPages() },
            onCancel: { model.cancelClearRecentPages() }
        )
        .presentationDetentsCompat()
    }
}

// MARK: - Cross-platform presentation detents

private extension View {
    /// Applies a medium sheet detent on iOS/iPadOS (HIG: a compact confirmation sheet),
    /// a no-op on macOS where sheets are auto-sized to their content.
    @ViewBuilder
    func presentationDetentsCompat() -> some View {
        #if os(iOS)
            presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        #else
            self
        #endif
    }
}
