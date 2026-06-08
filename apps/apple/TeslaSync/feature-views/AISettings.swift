//
//  AISettings.swift
//  TeslaSync — P4 feature view · 0202 · AISettings (Apple)
//
//  The Helix (AI) settings surface — the SwiftUI parity of
//  features/settings/components/AISettings.tsx. Renders the web source's regions (the
//  Helix-branded header, the mode picker, the off-mode banner, the cloud cost-cap
//  spend bar, and the save action) inside a glass panel, plus the P4 leaf contract
//  states. Binds through `AiSettingsModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial settings fetch → skeleton chrome.
//    • empty    — settings resolved with no payload → friendly empty state.
//    • error    — settings query failure → retry affordance (web `QueryError` peer).
//    • data     — the full form (mode picker + optional cost-cap bar + save).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AISettings (the feature surface)

/// The Helix (AI) settings surface — the SwiftUI parity of
/// `features/settings/components/AISettings.tsx`. Renders every state from the web
/// source plus the P4 leaf freshness states, binding through `AiSettingsModel`.
public struct AISettings: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AISettings"

    @State private var model: AiSettingsModel

    public init(model: AiSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
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
        .accessibilityLabel(Text(verbatim: AiSettingsStrings.string("ai.settings.title", "Helix")))
    }
}

// MARK: - Header (web IconBox + HelixMark + PanelTitle + Subhead, plus freshness)

private extension AISettings {
    var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            HelixIconBox()
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: AiSettingsStrings.string("ai.settings.title", "Helix"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: AiSettingsStrings.string(
                    "ai.settings.subtitle",
                    "Optional. Helix is off by default; nothing is enabled until you opt in here."
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: TSSpacing.xs) {
                freshnessChip
                refreshButton
            }
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = AiSettingsStrings.string("ai.settings.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = AiSettingsStrings.string("ai.settings.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = AiSettingsStrings.string("ai.settings.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: AiSettingsStrings.string("ai.settings.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? AiSettingsStrings.string("ai.settings.offlineBanner", "Offline — showing last known settings")
            : AiSettingsStrings.string("ai.settings.staleBanner", "Reconnecting — settings may be stale")
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

private extension AISettings {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            AiSettingsLoadingView()
        case .empty:
            AiSettingsEmptyView()
        case let .error(message):
            AiSettingsErrorView(message: message) { model.refresh() }
        case .data:
            AiSettingsForm(model: model)
        }
    }
}
