//
//  LegacyAlertStudioRedirect.swift
//  TeslaSync — P4 feature view · 0186 · LegacyAlertStudioRedirect (Apple)
//
//  The legacy Alert Studio redirect — the SwiftUI parity of
//  features/notifications/components/LegacyAlertStudioRedirect.tsx, whose whole body is
//  `<Navigate to={`/notifications/studio${search}`} replace />` driven by `useLocation()`. Binds through
//  `LegacyAlertStudioRedirectModel` (P1/S8); no routing lives in the view. The automatic redirect is the
//  model's `onRedirect` seam (web `<Navigate replace>`); this view renders the surface chrome around it —
//  the redirecting / resolved / empty / error phases plus the live-state freshness envelope — so the
//  surface is never a blank box while the host performs the route change.
//

import SwiftUI

/// The legacy Alert Studio redirect surface. The host owns the navigation (the model's injected
/// `onRedirect`); this view shows the redirect chrome and switches over the bound model's phase so every
/// prompt-required state renders (redirecting / resolved / empty / error) under the stale / offline
/// freshness envelope.
public struct LegacyAlertStudioRedirect: View {
    @State private var model: LegacyAlertStudioRedirectModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: LegacyAlertStudioRedirectModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            header
            if model.connection != .live {
                LegacyAlertStudioRedirectConnectivityBanner(connection: model.connection)
            }
            panel { phaseBody }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: model.phase)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The surface title (the destination's human name) plus the freshness chip.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            LegacyAlertStudioRedirectStrings.text("legacyAlertStudioRedirect.title", "Alert Studio")
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            LegacyAlertStudioRedirectFreshnessChip(connection: model.connection)
        }
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch model.phase {
        case .redirecting:
            LegacyAlertStudioRedirectProgress(breadcrumb: model.breadcrumb)
        case .resolved:
            LegacyAlertStudioRedirectConfirmation(breadcrumb: model.breadcrumb) { model.confirm() }
        case .empty:
            LegacyAlertStudioRedirectEmptyState { model.goToParent() }
        case let .error(message):
            LegacyAlertStudioRedirectErrorView(message: message) { model.retry() }
        }
    }

    private func panel(@ViewBuilder _ content: @escaping () -> some View) -> some View {
        content()
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}
