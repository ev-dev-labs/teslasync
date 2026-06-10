//
//  AIAutoNameUnnamedLocations.swift
//  TeslaSync — P4 shared surface · 0006 · AIAutoNameUnnamedLocations (Apple)
//
//  The "Suggest a name for this location" Helix panel — the SwiftUI parity of
//  components/ai/AIAutoNameUnnamedLocations.tsx. Reproduces the web source's
//  composition (the `withAiFeature` gate, the `AIFeatureCard` scaffold — title + cyan
//  Helix badge + description + the universal "Ask Helix" action — the captured-proposal
//  `draft` box with "Apply to form", and the streamed `AiOutputPanel`) plus the P4 leaf
//  contract states. Binds through `AINameDraftModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface, except the AI-Off gate which is the
//  sanctioned ADR-015 "render nothing" contract, faithful to web `withAiFeature` → null):
//    • gateLoading — the AI-Off gate is resolving → skeleton chrome.
//    • ready/idle  — gate on, nothing streamed yet → the resting invite card (header +
//                    description + "Ask Helix"); never a blank surface.
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

// MARK: - AIAutoNameUnnamedLocations (the feature surface)

/// The "Suggest a name for this location" Helix panel — the SwiftUI parity of
/// `components/ai/AIAutoNameUnnamedLocations.tsx`. Renders every state from the web
/// source plus the P4 leaf states, binding through `AINameDraftModel`.
public struct AIAutoNameUnnamedLocations: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AIAutoNameSurface.slug

    /// The AI feature id this surface gates on (web `withAiFeature` argument).
    public static let featureID = AIAutoNameSurface.featureID

    @State private var model: AINameDraftModel

    public init(model: AINameDraftModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ZStack {
            switch model.renderState {
            case .gatedOff:
                // AI-Off contract (ADR-015): the surface renders nothing, faithful to
                // the web `withAiFeature` returning `null`. The model keeps observing so
                // the card appears the moment the gate flips on.
                EmptyView()
            case .gateLoading:
                glass { AINameDraftGateLoadingView() }
            case let .gateError(message):
                glass {
                    AINameDraftGateErrorView(message: message) { model.refresh() }
                }
            case .ready:
                readyCard
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    // MARK: Ready card (web `AIFeatureCard` + `draft` + `AiOutputPanel`)

    private var readyCard: some View {
        glass {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                statusRow
                if model.connection != .live {
                    connectivityBanner
                }
                AINameDraftHeader(canStart: model.canStart)
                if let currentName = model.currentName, !currentName.isEmpty {
                    AINameDraftCurrentLabel(currentName: currentName)
                }
                AINameDraftActionButton(
                    isStreaming: model.phase == .streaming,
                    disabled: model.buttonDisabled
                ) {
                    model.suggest()
                }
                if let draft = model.draft {
                    AINameDraftProposal(draft: draft) { model.apply() }
                }
                AINameDraftOutputPanel(phase: model.phase, text: model.streamText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// The VoiceOver summary — the title, the current label (when present), and the
    /// captured proposal verdict, built through the testable `AINameDraftAccessibility`
    /// seam so it is asserted without rendering.
    private var accessibilitySummary: String {
        let currentLabel: String? = {
            guard let name = model.currentName, !name.isEmpty else { return nil }
            let prefix = AIAutoNameStrings.string("locations.aiAutoName.currentLabel", "Current label")
            return "\(prefix): \(name)"
        }()
        return AINameDraftAccessibility.summary(
            title: AIAutoNameStrings.string("locations.aiAutoName.title", "Suggest a name for this location"),
            currentLabel: currentLabel,
            proposedLabel: AIAutoNameStrings.string("locations.aiAutoName.proposalLabel", "Proposed name"),
            draft: model.draft,
            rejectedLabel: AIAutoNameStrings.string(
                "locations.aiAutoName.rejectedLabel", "Proposal rejected by validator"
            )
        )
    }

    // MARK: Panel shell

    private func glass(@ViewBuilder _ content: () -> some View) -> some View {
        TSGlassPanel {
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Freshness chip + banner (P4 leaf connectivity axis)

private extension AIAutoNameUnnamedLocations {
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
            label = AIAutoNameStrings.string("locations.aiAutoName.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = AIAutoNameStrings.string("locations.aiAutoName.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = AIAutoNameStrings.string("locations.aiAutoName.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: AIAutoNameStrings.string("locations.aiAutoName.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? AIAutoNameStrings.string("locations.aiAutoName.offlineBanner", "Offline — showing last known data")
            : AIAutoNameStrings.string("locations.aiAutoName.staleBanner", "Reconnecting — data may be stale")
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
