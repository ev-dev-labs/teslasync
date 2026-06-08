//
//  helpers.swift
//  TeslaSync — P4 feature view · 0245 · helpers (Apple)
//
//  The status `helpers` surface — the SwiftUI parity of
//  web/src/features/system/components/status/helpers.tsx. The web module is a pure
//  utility leaf (status → colour / icon / badge, plus uptime / byte formatting) with
//  no UI of its own; the real parity value is the ported `StatusHelpers` /
//  `StatusFormat` core in `helpers.Adapter.swift`, consumed by the other native
//  status surfaces exactly as the web status components import these helpers. This
//  surface presents that core as a reference panel — a status legend over a
//  formatting reference — inside a glass panel, plus the P4 leaf contract states.
//  Binds through `StatusHelpersModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome.
//    • empty    — no samples and nothing to format → friendly empty state.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the legend + formatting reference.
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - StatusHelpersPanel (the feature surface)

/// The status `helpers` reference surface. Renders every state from the P4 leaf
/// contract, binding through `StatusHelpersModel`; the displayed treatments come from
/// the ported web helpers (`StatusHelpers` / `StatusFormat`).
public struct StatusHelpersPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Matches the web source file
    /// name (`helpers`).
    public static let surfaceSlug = "helpers"

    @State private var model: StatusHelpersModel

    public init(model: StatusHelpersModel) {
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
        .accessibilityLabel(Text(verbatim: StatusHelpersStrings.string(
            "helpers.title", "Status Helpers"
        )))
    }
}

// MARK: - Header (title + freshness chip + refresh)

private extension StatusHelpersPanel {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: StatusHelpersStrings.string("helpers.title", "Status Helpers"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
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
            label = StatusHelpersStrings.string("helpers.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = StatusHelpersStrings.string("helpers.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = StatusHelpersStrings.string("helpers.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: StatusHelpersStrings.string("helpers.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? StatusHelpersStrings.string("helpers.offlineBanner", "Offline — showing last known data")
            : StatusHelpersStrings.string("helpers.staleBanner", "Reconnecting — data may be stale")
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

// MARK: - Content states (P4 leaf contract)

private extension StatusHelpersPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            StatusHelpersLoadingView()
        case .empty:
            StatusHelpersEmptyView()
        case let .error(message):
            StatusHelpersErrorView(message: message) { model.refresh() }
        case .data:
            StatusHelpersContent(resolved: model.resolved)
        }
    }
}
