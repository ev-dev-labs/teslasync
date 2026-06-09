//
//  LegacyAlertsRedirect.swift
//  TeslaSync — P4 feature view · 0185 · LegacyAlertsRedirect (Apple)
//
//  Native, Apple-idiomatic parity of the web `LegacyAlertsRedirect`
//  (web/src/features/notifications/components/LegacyAlertsRedirect.tsx): the smart,
//  query-aware redirect from the legacy `/alerts?tab=…` route to the new top-level
//  notifications routes, forwarding the remaining search params so filter / search /
//  severity / vehicle deep-link state survives.
//
//  The web component returns a bare `<Navigate to replace />` (no UI). Native cannot
//  redirect invisibly and instantly, so this surface binds the location through the
//  P1/S8 seam, dispatches the resolved replace through the navigation seam, emits the
//  P1/S11 `view.opened` event, and renders a real, accessible redirect affordance with
//  a manual "Continue" fallback — never a blank box.
//

import SwiftUI

/// The legacy alerts redirect surface. Construct it with a model bound to a location
/// source + router (the production app wires the shared P1/S8 navigation state;
/// previews + tests inject in-memory seams).
public struct LegacyAlertsRedirect: View {
    @State private var model: LegacyAlertsRedirectModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: LegacyAlertsRedirectModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.phase)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            LegacyAlertsRedirectIcon(systemImage: headerSystemImage)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                LegacyAlertsRedirectStrings.text(
                    "legacyAlertsRedirect.title",
                    "Redirecting"
                )
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
                LegacyAlertsRedirectStrings.text(
                    "legacyAlertsRedirect.subtitle",
                    "Sending you to the Notifications you asked for"
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
        }
    }

    /// The header icon: the destination's glyph once resolved, else a generic alerts
    /// redirect badge.
    private var headerSystemImage: String {
        model.destination?.tab.systemImage ?? "bell.badge.fill"
    }

    // MARK: Phase content

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .resolving:
            LegacyAlertsResolvingView()
        case let .redirecting(redirect):
            LegacyAlertsDestinationView(redirect: redirect) {
                model.redirectNow()
            }
        }
    }
}
