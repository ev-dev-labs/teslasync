//
//  AIInboxAutoCategorization.swift
//  TeslaSync — P4 shared surface · 0021 · AIInboxAutoCategorization (Apple)
//
//  The "Suggest inbox categories" Helix panel — the SwiftUI parity of
//  components/ai/AIInboxAutoCategorization.tsx. Reproduces the web source's composition (the
//  `withAiFeature` gate, the `AIFeatureCard` scaffold — title + cyan Helix badge + description +
//  the universal "Ask Helix" action — the captured proposal block with the "Apply categories as
//  filter" hand-off and the "{category} · {count}" chips, and the streamed `AiOutputPanel`) plus
//  the P4 leaf contract states. Binds through `InboxCategoryModel` (P1/S8); no networking lives
//  here.
//
//  States (every one renders — no hidden surface, except the AI-Off gate which is the sanctioned
//  ADR-015 "render nothing" contract, faithful to web `withAiFeature` → null):
//    • gateLoading  — the AI-Off gate is resolving → skeleton chrome.
//    • ready/idle   — gate on, nothing suggested yet → the resting invite card (header +
//                     description + "Ask Helix"); never a blank surface.
//    • streaming    — SSE open → "Helix is thinking…" + the output thinking indicator.
//    • empty        — a `tool_result` resolved with zero categories → the friendly "no categories"
//                     box (the P4 "never a blank box" leaf; the web shows nothing here).
//    • proposal     — a `tool_result` produced buckets → the Apply button + the category chips.
//    • stream error — the SSE ended in `error` → the Helix error row in the output panel.
//    • gateError    — the gate / context fetch failed → `QueryError` peer with retry.
//    • stale/offline— the orthogonal `connection` axis → freshness chip + banner with a one-shot
//                     auto-refresh on the stale transition; offline disables the action (no stream
//                     is possible) while keeping the cached scope.
//    • gatedOff     — the feature is disabled → renders nothing (web `withAiFeature` null).
//

import SwiftUI

// MARK: - AIInboxAutoCategorization (the feature surface)

/// The "Suggest inbox categories" Helix panel — the SwiftUI parity of
/// `components/ai/AIInboxAutoCategorization.tsx`. Renders every state from the web source plus the
/// P4 leaf states, binding through `InboxCategoryModel`.
public struct AIInboxAutoCategorization: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = InboxCategorySurface.slug

    /// The AI feature id this surface gates on (web `withAiFeature` argument).
    public static let featureID = InboxCategorySurface.featureID

    @State private var model: InboxCategoryModel

    public init(model: InboxCategoryModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ZStack {
            switch model.renderState {
            case .gatedOff:
                // AI-Off contract (ADR-015): the surface renders nothing, faithful to the web
                // `withAiFeature` returning `null`. The model keeps observing so the card appears
                // the moment the gate flips on.
                EmptyView()
            case .gateLoading:
                glass { InboxCategoryGateLoadingView() }
            case let .gateError(message):
                glass {
                    InboxCategoryGateErrorView(message: message) { model.refresh() }
                }
            case .ready:
                readyCard
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    // MARK: Ready card (web `AIFeatureCard` + `proposal` + `AiOutputPanel`)

    private var readyCard: some View {
        glass {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                statusRow
                if model.connection != .live {
                    connectivityBanner
                }
                InboxCategoryHeader()
                InboxCategorySuggestButton(
                    isStreaming: model.phase == .streaming,
                    disabled: model.suggestDisabled
                ) {
                    model.categorize()
                }
                if model.showsEmptyProposal {
                    InboxCategoryEmptyMessage()
                }
                if model.showsProposal, let buckets = model.proposal {
                    InboxCategoryProposalView(
                        buckets: buckets,
                        applyDisabled: model.applyDisabled
                    ) {
                        model.applyCategories()
                    }
                }
                InboxCategoryOutputPanel(phase: model.phase, text: model.streamText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// The VoiceOver summary — the title plus the captured-proposal verdict (empty message or one
    /// line per bucket), built through the testable `InboxCategoryAccessibility` seam so it is
    /// asserted without rendering.
    private var accessibilitySummary: String {
        InboxCategoryAccessibility.summary(
            title: InboxCategoryStrings.string(
                "notifications.inbox.aiCategorize.title", "Suggest inbox categories"
            ),
            buckets: model.proposal,
            emptyLabel: InboxCategoryStrings.string(
                "notifications.inbox.aiCategorize.emptyMessage",
                "No categories suggested for the current inbox view."
            ),
            countLabel: { count in
                InboxCategoryStrings.format(
                    "notifications.inbox.aiCategorize.countA11y", "%lld alerts", count
                )
            }
        )
    }

    // MARK: Panel shell

    private func glass(@ViewBuilder _ content: @escaping () -> some View) -> some View {
        TSGlassPanel {
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Freshness chip + banner (P4 leaf connectivity axis)

private extension AIInboxAutoCategorization {
    var statusRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
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
            label = InboxCategoryStrings.string("notifications.inbox.aiCategorize.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = InboxCategoryStrings.string("notifications.inbox.aiCategorize.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = InboxCategoryStrings.string("notifications.inbox.aiCategorize.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: InboxCategoryStrings.string(
            "notifications.inbox.aiCategorize.refresh", "Refresh"
        )))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? InboxCategoryStrings.string(
                "notifications.inbox.aiCategorize.offlineBanner", "Offline — showing last known data"
            )
            : InboxCategoryStrings.string(
                "notifications.inbox.aiCategorize.staleBanner", "Reconnecting — data may be stale"
            )
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}
