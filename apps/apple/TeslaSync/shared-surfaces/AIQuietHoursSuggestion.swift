//
//  AIQuietHoursSuggestion.swift
//  TeslaSync — P4 shared surface · 0041 · AIQuietHoursSuggestion (Apple)
//
//  The "Suggest a quiet-hours window" Helix panel — the SwiftUI parity of
//  components/ai/AIQuietHoursSuggestion.tsx. Reproduces the web source's composition (the
//  `withAiFeature` gate, the `AIFeatureCard` scaffold — title + cyan Helix badge + description + the
//  universal "Ask Helix" action placed below — the captured-proposal box with "Apply to form" + the
//  reviewable window preview, and the streamed `AiOutputPanel`) plus the P4 leaf contract states.
//  Binds through `QuietHoursSuggestionModel` (P1/S8); no networking lives here. Propose-only:
//  `apply()` forwards the typed window to the baseline QuietHoursPanel form — that panel's Save button
//  stays the sole write path (ADR-015 §I3 + §I8).
//
//  States (every one renders — no hidden surface, except the AI-Off gate which is the sanctioned
//  ADR-015 "render nothing" contract, faithful to web `withAiFeature` → null):
//    • gateLoading — the AI-Off gate is resolving → skeleton chrome.
//    • ready/idle  — gate on, nothing proposed yet → the resting invite card (header + description +
//                    a friendly "nothing proposed yet" hint + "Ask Helix"); never a blank surface.
//    • streaming   — SSE open → "Helix is thinking…" + the output thinking indicator.
//    • proposal    — a `tool_result` produced a window → the cyan proposal box (reviewable window /
//                    weekday bitmask / bypass severities, + the insufficient-history + existing-count
//                    notes) and "Apply to form" (disabled while busy).
//    • stream error— the SSE ended in `error` → the Helix error row in the output panel.
//    • gateError   — the gate / context fetch failed → `QueryError` peer with retry.
//    • stale/offline — the orthogonal `connection` axis → freshness chip + banner with a one-shot
//                    auto-refresh on the stale transition; offline disables the action (no stream is
//                    possible) while keeping the cached context.
//    • gatedOff    — the feature is disabled → renders nothing (web `withAiFeature` null).
//

import SwiftUI

// MARK: - AIQuietHoursSuggestion (the feature surface)

/// The "Suggest a quiet-hours window" Helix panel — the SwiftUI parity of
/// `components/ai/AIQuietHoursSuggestion.tsx`. Renders every state from the web source plus the P4 leaf
/// states, binding through `QuietHoursSuggestionModel`.
public struct AIQuietHoursSuggestion: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = QuietHoursSuggestionSurface.slug

    /// The AI feature id this surface gates on (web `withAiFeature` argument).
    public static let featureID = QuietHoursSuggestionSurface.featureID

    @State private var model: QuietHoursSuggestionModel

    public init(model: QuietHoursSuggestionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ZStack {
            switch model.renderState {
            case .gatedOff:
                // AI-Off contract (ADR-015): the surface renders nothing, faithful to the web
                // `withAiFeature` returning `null`. The model keeps observing so the card appears the
                // moment the gate flips on.
                EmptyView()
            case .gateLoading:
                glass { QuietHoursSuggestionGateLoadingView() }
            case let .gateError(message):
                glass {
                    QuietHoursSuggestionGateErrorView(message: message) { model.refresh() }
                }
            case .ready:
                readyCard
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    // MARK: Ready card (web `AIFeatureCard` + `proposal` children + `AiOutputPanel`)

    private var readyCard: some View {
        glass {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                statusRow
                if model.connection != .live {
                    connectivityBanner
                }
                QuietHoursSuggestionHeader(showIdleHint: model.showIdleHint)
                QuietHoursSuggestionActionButton(
                    isStreaming: model.isStreaming,
                    disabled: model.buttonDisabled
                ) {
                    model.suggest()
                }
                if let proposal = model.proposal {
                    QuietHoursSuggestionProposalBox(
                        proposal: proposal,
                        canApply: model.canApply
                    ) {
                        model.apply()
                    }
                }
                QuietHoursSuggestionOutputPanel(phase: model.phase, text: model.streamText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// The VoiceOver summary — the title, the captured proposed window (when present), and the live
    /// stream status, built through the testable `QuietHoursSuggestionAccessibility` seam so it is
    /// asserted without rendering.
    private var accessibilitySummary: String {
        QuietHoursSuggestionAccessibility.summary(
            labels: .init(
                title: QuietHoursSuggestionStrings.string(
                    "notifications.quietHours.aiSuggestion.title",
                    "Suggest a quiet-hours window from your notification history"
                ),
                proposed: QuietHoursSuggestionStrings.string(
                    "notifications.quietHours.aiSuggestion.proposedA11y", "Proposed quiet-hours window"
                ),
                thinking: QuietHoursSuggestionStrings.string("helix.thinking", "Helix is thinking…"),
                errorLabel: QuietHoursSuggestionStrings.string("helix.errorLabel", "Helix error:"),
                errorUnknown: QuietHoursSuggestionStrings.string("ai.common.errorUnknown", "unknown")
            ),
            proposalSummary: model.proposal.map(QuietHoursSuggestionFormat.proposalSummary),
            phase: model.phase,
            streamText: model.streamText
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

private extension AIQuietHoursSuggestion {
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
            label = QuietHoursSuggestionStrings.string("notifications.quietHours.aiSuggestion.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = QuietHoursSuggestionStrings.string("notifications.quietHours.aiSuggestion.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = QuietHoursSuggestionStrings.string("notifications.quietHours.aiSuggestion.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: QuietHoursSuggestionStrings.string(
            "notifications.quietHours.aiSuggestion.refresh", "Refresh"
        )))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? QuietHoursSuggestionStrings.string(
                "notifications.quietHours.aiSuggestion.offlineBanner", "Offline — showing last known data"
            )
            : QuietHoursSuggestionStrings.string(
                "notifications.quietHours.aiSuggestion.staleBanner", "Reconnecting — data may be stale"
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
