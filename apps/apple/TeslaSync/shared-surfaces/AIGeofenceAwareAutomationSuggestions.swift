//
//  AIGeofenceAwareAutomationSuggestions.swift
//  TeslaSync — P4 shared surface · 0020 · AIGeofenceAwareAutomationSuggestions (Apple)
//
//  The "Suggest a geofence-aware automation" Helix panel — the SwiftUI parity of
//  components/ai/AIGeofenceAwareAutomationSuggestions.tsx. Reproduces the web source's
//  composition (the `withAiFeature` gate, the `AIFeatureCard` scaffold — title + cyan Helix
//  badge + description + the prompt `inputSlot` + the universal "Ask Helix" action — the
//  captured-proposal `draft` box with "Apply to form", and the streamed `AiOutputPanel`)
//  plus the P4 leaf contract states. Binds through `GeofenceAutomationModel` (P1/S8); no
//  networking lives here. Propose-only: `apply()` forwards the graph to the parent form —
//  the baseline AutomationBuilder Save button stays the only API write path (ADR-015).
//
//  States (every one renders — no hidden surface, except the AI-Off gate which is the
//  sanctioned ADR-015 "render nothing" contract, faithful to web `withAiFeature` → null):
//    • gateLoading — the AI-Off gate is resolving → skeleton chrome.
//    • ready/idle  — gate on, nothing streamed yet → the resting invite card (header +
//                    description + prompt + "Ask Helix"); never a blank surface.
//    • streaming   — SSE open → "Helix is thinking…" + the output thinking indicator.
//    • draft       — a `tool_result` produced a proposal → the cyan proposal box +
//                    "Apply to form" (disabled unless the validator returned `ok`).
//    • stream error— the SSE ended in `error` → the Helix error row in the output panel.
//    • gateError   — the gate / context fetch failed → `QueryError` peer with retry.
//    • stale/offline — the orthogonal `connection` axis → freshness chip + banner with a
//                    one-shot auto-refresh on the stale transition; offline disables the
//                    action (no stream is possible) while keeping the cached context.
//    • gatedOff    — the feature is disabled → renders nothing (web `withAiFeature` null).
//

import SwiftUI

// MARK: - AIGeofenceAwareAutomationSuggestions (the feature surface)

/// The "Suggest a geofence-aware automation" Helix panel — the SwiftUI parity of
/// `components/ai/AIGeofenceAwareAutomationSuggestions.tsx`. Renders every state from the
/// web source plus the P4 leaf states, binding through `GeofenceAutomationModel`.
public struct AIGeofenceAwareAutomationSuggestions: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = GeofenceAutomationSurface.slug

    /// The AI feature id this surface gates on (web `withAiFeature` argument).
    public static let featureID = GeofenceAutomationSurface.featureID

    @State private var model: GeofenceAutomationModel

    public init(model: GeofenceAutomationModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ZStack {
            switch model.renderState {
            case .gatedOff:
                // AI-Off contract (ADR-015): the surface renders nothing, faithful to the
                // web `withAiFeature` returning `null`. The model keeps observing so the
                // card appears the moment the gate flips on.
                EmptyView()
            case .gateLoading:
                glass { GeofenceAutomationGateLoadingView() }
            case let .gateError(message):
                glass {
                    GeofenceAutomationGateErrorView(message: message) { model.refresh() }
                }
            case .ready:
                readyCard
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    // MARK: Ready card (web `AIFeatureCard` + `inputSlot` + `draft` + `AiOutputPanel`)

    private var readyCard: some View {
        glass {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                statusRow
                if model.connection != .live {
                    connectivityBanner
                }
                GeofenceAutomationHeader(hint: model.emptyHint)
                GeofenceAutomationPromptField(text: promptBinding)
                GeofenceAutomationActionButton(
                    isStreaming: model.phase == .streaming,
                    disabled: model.buttonDisabled
                ) {
                    model.suggest()
                }
                if let draft = model.draft {
                    GeofenceAutomationProposal(draft: draft) { model.apply() }
                }
                GeofenceAutomationOutputPanel(phase: model.phase, text: model.streamText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// Two-way binding to the model's `prompt` (web `useState`) for the input field. Manual
    /// (rather than `@Bindable`) so the surface keeps owning the model via `@State`.
    private var promptBinding: Binding<String> {
        Binding(get: { model.prompt }, set: { model.prompt = $0 })
    }

    /// The VoiceOver summary — the title plus the captured proposal (name, description,
    /// counts, reason, verdict), built through the testable `GeofenceAutomationAccessibility`
    /// seam so it is asserted without rendering.
    private var accessibilitySummary: String {
        GeofenceAutomationAccessibility.summary(
            labels: .init(
                title: GeofenceAutomationStrings.string(
                    "automations.builder.aiGeofenceAware.title", "Suggest a geofence-aware automation"
                ),
                proposed: GeofenceAutomationStrings.string(
                    "automations.builder.aiGeofenceAware.proposalLabel", "Proposed automation"
                ),
                unnamed: GeofenceAutomationStrings.string(
                    "automations.builder.aiGeofenceAware.unnamed", "(unnamed)"
                ),
                triggers: GeofenceAutomationStrings.string(
                    "automations.builder.aiGeofenceAware.triggersLabel", "Triggers"
                ),
                conditions: GeofenceAutomationStrings.string(
                    "automations.builder.aiGeofenceAware.conditionsLabel", "Conditions"
                ),
                actions: GeofenceAutomationStrings.string(
                    "automations.builder.aiGeofenceAware.actionsLabel", "Actions"
                ),
                rejected: GeofenceAutomationStrings.string(
                    "automations.builder.aiGeofenceAware.rejectedLabel", "Proposal rejected by validator"
                )
            ),
            draft: model.draft
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

private extension AIGeofenceAwareAutomationSuggestions {
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
            label = GeofenceAutomationStrings.string("automations.builder.aiGeofenceAware.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = GeofenceAutomationStrings.string("automations.builder.aiGeofenceAware.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = GeofenceAutomationStrings.string("automations.builder.aiGeofenceAware.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: GeofenceAutomationStrings.string(
            "automations.builder.aiGeofenceAware.refresh", "Refresh"
        )))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? GeofenceAutomationStrings.string(
                "automations.builder.aiGeofenceAware.offlineBanner", "Offline — showing last known data"
            )
            : GeofenceAutomationStrings.string(
                "automations.builder.aiGeofenceAware.staleBanner", "Reconnecting — data may be stale"
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
