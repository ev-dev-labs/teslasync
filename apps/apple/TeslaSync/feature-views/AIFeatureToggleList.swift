//
//  AIFeatureToggleList.swift
//  TeslaSync — P4 feature view · 0199 · AIFeatureToggleList (Apple)
//
//  The AI feature-toggle settings surface — the SwiftUI parity of
//  features/settings/components/AIFeatureToggleList.tsx. Renders the web `<section>` (a subtle-bordered
//  card with the `Per-feature opt-in` legend and one switch per AI feature) plus the P4 leaf contract
//  states, binding through `AIFeatureToggleListModel` (P1/S8). No networking lives here; the freshness
//  chip + the stale auto-refresh reflect the bound source's live-state.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial settings fetch → skeleton rows.
//    • empty    — settings resolved with no record → friendly empty state.
//    • error    — settings query failure → retry affordance (web `QueryError` peer).
//    • data     — the full toggle list (web `AI_FEATURE_IDS.map(...)`).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension AIFeatureToggleStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so the
    /// model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - AIFeatureToggleList (the settings surface)

/// The composable AI feature-toggle surface — the SwiftUI parity of
/// `features/settings/components/AIFeatureToggleList.tsx`. Renders every state from the web source plus
/// the P4 leaf freshness states, binding through `AIFeatureToggleListModel` (P1/S8). No networking
/// lives here.
public struct AIFeatureToggleList: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AIFeatureToggleListSurface.slug

    @State private var model: AIFeatureToggleListModel

    public init(model: AIFeatureToggleListModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.1) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                header
                if model.connection != .live {
                    connectivityBanner
                }
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(AIFeatureToggleStrings.text(
            "ai.settings.feature.legend", "Per-feature opt-in (all default off)"
        ))
    }
}

// MARK: - Header (web `<Subhead>` legend + freshness chip)

private extension AIFeatureToggleList {
    /// The always-visible legend (web `<Subhead>{t('ai.settings.feature.legend', …)}</Subhead>`) with
    /// the freshness chip trailing while fetching or when the bound source is stale / offline.
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            AIFeatureToggleStrings.text("ai.settings.feature.legend", "Per-feature opt-in (all default off)")
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsFreshnessChip {
                AIFeatureToggleFreshnessChip(connection: model.connection, isFetching: model.isFetching)
            }
        }
    }

    /// The chip appears only while fetching or when the bound source is stale / offline; when live +
    /// idle the header is just the legend.
    var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }

    /// The cached-data banner shown while reconnecting (stale) or disconnected (offline), so cached
    /// opt-ins are clearly labeled as last-saved.
    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? AIFeatureToggleStrings.string(
                "ai.settings.feature.offlineBanner", "Offline — showing last saved feature settings"
            )
            : AIFeatureToggleStrings.string(
                "ai.settings.feature.staleBanner", "Reconnecting — feature settings may be stale"
            )
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

// MARK: - Content states

private extension AIFeatureToggleList {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            AIFeatureToggleLoadingList()
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .data:
            if let projection = model.projection {
                AIFeatureToggleListContent(projection: projection, model: model)
            } else {
                emptyState
            }
        }
    }

    /// The native empty branch (the web leaf always has the registry, so this is reachable only when a
    /// brand-new install has no settings record yet): a friendly empty state, never a blank box.
    var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                AIFeatureToggleStrings.string("ai.settings.feature.empty", "No AI features available")
            ),
            message: LocalizedStringKey(
                AIFeatureToggleStrings.string(
                    "ai.settings.feature.emptyMessage", "The AI feature registry is empty for this install."
                )
            ),
            systemImage: "sparkles"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    /// Native failure branch (the web leaf has no error state of its own): a retryable QueryError
    /// equivalent with the bound source's message, mirroring the affordance the prompt requires.
    func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            AIFeatureToggleStrings.text("ai.settings.feature.errorTitle", "Couldn't load AI feature settings")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(
                LocalizedStringKey(AIFeatureToggleStrings.string("ai.settings.feature.retry", "Retry")),
                variant: .secondary,
                size: .small
            ) {
                model.refresh()
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
