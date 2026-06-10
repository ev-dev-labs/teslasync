//
//  AICrossRuleConflictDetection.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  The "Detect cross-rule conflicts" Helix panel — the SwiftUI parity of
//  components/ai/AICrossRuleConflictDetection.tsx. Reproduces the web source's composition (the
//  `withAiFeature` gate, the `AIFeatureCard` scaffold — title + cyan Helix badge + description +
//  the universal "Ask Helix" action — the captured-conflicts list with per-row "Review rule"
//  hand-offs, and the streamed `AiOutputPanel`) plus the P4 leaf contract states. Binds through
//  `RuleConflictModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface, except the AI-Off gate which is the sanctioned
//  ADR-015 "render nothing" contract, faithful to web `withAiFeature` → null):
//    • gateLoading  — the AI-Off gate is resolving → skeleton chrome.
//    • ready/idle   — gate on, nothing streamed yet → the resting invite card (header +
//                     description + "Ask Helix"); never a blank surface.
//    • streaming    — SSE open → "Helix is thinking…" + the output thinking indicator.
//    • empty        — a `tool_result` resolved with zero conflicts → the friendly "no structural
//                     conflicts found" box (web `emptyMessage`).
//    • conflicts    — a `tool_result` produced rows → the amber conflict list + per-row chips +
//                     the two "Review rule" buttons.
//    • stream error — the SSE ended in `error` → the Helix error row in the output panel.
//    • gateError    — the gate / context fetch failed → `QueryError` peer with retry.
//    • stale/offline— the orthogonal `connection` axis → freshness chip + banner with a one-shot
//                     auto-refresh on the stale transition; offline disables the action (no
//                     stream is possible) while keeping the cached scope.
//    • gatedOff     — the feature is disabled → renders nothing (web `withAiFeature` null).
//

import SwiftUI

// MARK: - AICrossRuleConflictDetection (the feature surface)

/// The "Detect cross-rule conflicts" Helix panel — the SwiftUI parity of
/// `components/ai/AICrossRuleConflictDetection.tsx`. Renders every state from the web source plus
/// the P4 leaf states, binding through `RuleConflictModel`.
public struct AICrossRuleConflictDetection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RuleConflictSurface.slug

    /// The AI feature id this surface gates on (web `withAiFeature` argument).
    public static let featureID = RuleConflictSurface.featureID

    @State private var model: RuleConflictModel

    public init(model: RuleConflictModel) {
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
                glass { RuleConflictGateLoadingView() }
            case let .gateError(message):
                glass {
                    RuleConflictGateErrorView(message: message) { model.refresh() }
                }
            case .ready:
                readyCard
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    // MARK: Ready card (web `AIFeatureCard` + `conflicts` + `AiOutputPanel`)

    private var readyCard: some View {
        glass {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                statusRow
                if model.connection != .live {
                    connectivityBanner
                }
                RuleConflictHeader(canStart: model.canStart)
                RuleConflictActionButton(
                    isStreaming: model.phase == .streaming,
                    disabled: model.buttonDisabled
                ) {
                    model.detect()
                }
                if model.showsEmptyMessage {
                    RuleConflictEmptyMessage()
                }
                if model.showsConflicts, let conflicts = model.conflicts {
                    RuleConflictList(conflicts: conflicts) { ruleID in
                        model.review(ruleID: ruleID)
                    }
                }
                RuleConflictOutputPanel(phase: model.phase, text: model.streamText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// The VoiceOver summary — the title plus the captured-conflict verdict (empty message or one
    /// line per conflict), built through the testable `RuleConflictAccessibility` seam so it is
    /// asserted without rendering.
    private var accessibilitySummary: String {
        RuleConflictAccessibility.summary(
            title: RuleConflictStrings.string(
                "notifications.alertStudio.aiConflicts.title", "Detect cross-rule conflicts"
            ),
            conflicts: model.conflicts,
            emptyLabel: RuleConflictStrings.string(
                "notifications.alertStudio.aiConflicts.emptyMessage",
                "No structural conflicts found in the current rule set."
            ),
            rulePrefix: RuleConflictStrings.string(
                "notifications.alertStudio.aiConflicts.rulePrefix", "Rule"
            ),
            kindLabel: { RuleConflictRow.label(for: $0) }
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

private extension AICrossRuleConflictDetection {
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
            label = RuleConflictStrings.string("notifications.alertStudio.aiConflicts.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = RuleConflictStrings.string("notifications.alertStudio.aiConflicts.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = RuleConflictStrings.string("notifications.alertStudio.aiConflicts.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: RuleConflictStrings.string(
            "notifications.alertStudio.aiConflicts.refresh", "Refresh"
        )))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? RuleConflictStrings.string(
                "notifications.alertStudio.aiConflicts.offlineBanner", "Offline — showing last known data"
            )
            : RuleConflictStrings.string(
                "notifications.alertStudio.aiConflicts.staleBanner", "Reconnecting — data may be stale"
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
