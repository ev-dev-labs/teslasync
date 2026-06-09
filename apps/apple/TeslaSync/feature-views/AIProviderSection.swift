//
//  AIProviderSection.swift
//  TeslaSync — P4 feature view · 0200 · AIProviderSection (Apple)
//
//  The AI provider configuration surface — the SwiftUI parity of
//  features/settings/components/AIProviderSection.tsx. Renders the web source's
//  `<section aria-label="Provider configuration">` (the Subhead header + the
//  controlled provider form) inside a glass panel, plus the P4 leaf contract states.
//  Binds through `AiProviderModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton field chrome.
//    • empty    — config resolved with no payload → friendly empty state.
//    • error    — settings query failure → retry affordance (web `QueryError` peer).
//    • data     — the full provider form (provider/model, Azure block, base URLs,
//                 cloud secrets, validate flows, explainers).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AIProviderSection (the feature surface)

/// The AI provider configuration surface — the SwiftUI parity of
/// `features/settings/components/AIProviderSection.tsx`. Renders every state from the
/// web source plus the P4 leaf freshness states, binding through `AiProviderModel`.
public struct AIProviderSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIProviderSection"

    @State private var model: AiProviderModel

    public init(model: AiProviderModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if model.connection != .live {
                    connectivityBanner
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: AiProviderStrings.string(
            "ai.settings.provider.label",
            "Provider configuration"
        )))
    }
}

// MARK: - Header (web `<Subhead>` + freshness chip + refresh)

private extension AIProviderSection {
    var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: AiProviderStrings.string("ai.settings.provider.label", "Provider configuration"))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = AiProviderStrings.string("ai.settings.provider.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = AiProviderStrings.string("ai.settings.provider.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = AiProviderStrings.string("ai.settings.provider.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: AiProviderStrings.string("ai.settings.provider.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? AiProviderStrings.string("ai.settings.provider.offlineBanner", "Offline — showing last known settings")
            : AiProviderStrings.string("ai.settings.provider.staleBanner", "Reconnecting — settings may be stale")
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states (web form + the P4 leaf contract)

private extension AIProviderSection {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            AiProviderLoadingView()
        case .empty:
            AiProviderEmptyView()
        case let .error(message):
            AiProviderErrorView(message: message) { model.refresh() }
        case .data:
            AiProviderForm(model: model)
        }
    }
}
