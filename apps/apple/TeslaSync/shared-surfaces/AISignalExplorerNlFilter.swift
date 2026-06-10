//
//  AISignalExplorerNlFilter.swift
//  TeslaSync — P4 shared surface · 0046 · AISignalExplorerNlFilter (Apple)
//
//  The "Helix natural-language filter" panel — the SwiftUI parity of
//  components/ai/AISignalExplorerNlFilter.tsx. Reproduces the web source's composition (the
//  `withAiFeature` gate, the `AIFeatureCard` scaffold — title + cyan Helix badge + description + the
//  prompt `inputSlot` + the universal "Ask Helix" action — the captured-proposal `draft` box with
//  "Apply to filters", and the streamed `AiOutputPanel`) plus the P4 leaf contract states. Binds
//  through `SignalExplorerFilterModel` (P1/S8); no networking lives here. Propose-only: `apply()`
//  forwards the typed filter to the parent SignalExplorer form — the deterministic SignalSelector /
//  RangePicker / PER_PAGE Select stay the canonical write path (ADR-015 §I3 + §I8).
//
//  States (every one renders — no hidden surface, except the AI-Off gate which is the sanctioned
//  ADR-015 "render nothing" contract, faithful to web `withAiFeature` → null):
//    • gateLoading — the AI-Off gate is resolving → skeleton chrome.
//    • ready/idle  — gate on, nothing streamed yet → the resting invite card (header + description +
//                    prompt + "Ask Helix"); never a blank surface.
//    • streaming   — SSE open → "Helix is thinking…" + the output thinking indicator.
//    • draft       — a `tool_result` produced a filter → the cyan proposal box (signals · range ·
//                    per-page summary) + "Apply to filters" (disabled while streaming).
//    • stream error— the SSE ended in `error` → the Helix error row in the output panel.
//    • gateError   — the gate / context fetch failed → `QueryError` peer with retry.
//    • stale/offline — the orthogonal `connection` axis → freshness chip + banner with a one-shot
//                    auto-refresh on the stale transition; offline disables the action (no stream is
//                    possible) while keeping the cached context.
//    • gatedOff    — the feature is disabled → renders nothing (web `withAiFeature` null).
//

import SwiftUI

// MARK: - AISignalExplorerNlFilter (the feature surface)

/// The "Helix natural-language filter" panel — the SwiftUI parity of
/// `components/ai/AISignalExplorerNlFilter.tsx`. Renders every state from the web source plus the P4
/// leaf states, binding through `SignalExplorerFilterModel`.
public struct AISignalExplorerNlFilter: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SignalExplorerFilterSurface.slug

    /// The AI feature id this surface gates on (web `withAiFeature` argument).
    public static let featureID = SignalExplorerFilterSurface.featureID

    @State private var model: SignalExplorerFilterModel

    public init(model: SignalExplorerFilterModel) {
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
                glass { SignalExplorerFilterGateLoadingView() }
            case let .gateError(message):
                glass {
                    SignalExplorerFilterGateErrorView(message: message) { model.refresh() }
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
                SignalExplorerFilterHeader(hint: model.emptyHint)
                SignalExplorerFilterPromptField(text: promptBinding)
                SignalExplorerFilterActionButton(
                    isStreaming: model.isStreaming,
                    disabled: model.buttonDisabled
                ) {
                    model.draftFilter()
                }
                if let draft = model.draft {
                    SignalExplorerFilterProposal(draft: draft, canApply: model.canApply) {
                        model.apply()
                    }
                }
                SignalExplorerFilterOutputPanel(phase: model.phase, text: model.streamText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// Two-way binding to the model's `prompt` (web `useState`) for the input field. Manual (rather
    /// than `@Bindable`) so the surface keeps owning the model via `@State`.
    private var promptBinding: Binding<String> {
        Binding(get: { model.prompt }, set: { model.prompt = $0 })
    }

    /// The VoiceOver summary — the title, the captured proposal (signals/range/per-page), and the
    /// live stream status, built through the testable `SignalExplorerFilterAccessibility` seam so it
    /// is asserted without rendering.
    private var accessibilitySummary: String {
        SignalExplorerFilterAccessibility.summary(
            labels: .init(
                title: SignalExplorerFilterStrings.string(
                    "signalExplorer.aiFilter.title", "Helix natural-language filter"
                ),
                proposed: SignalExplorerFilterStrings.string(
                    "signalExplorer.aiFilter.proposalLabel", "Proposed filter"
                ),
                signals: SignalExplorerFilterStrings.string(
                    "signalExplorer.aiFilter.signalsLabel", "Signals"
                ),
                range: SignalExplorerFilterStrings.string(
                    "signalExplorer.aiFilter.rangeLabel", "Range"
                ),
                perPage: SignalExplorerFilterStrings.string(
                    "signalExplorer.aiFilter.perPageLabel", "Per page"
                ),
                thinking: SignalExplorerFilterStrings.string("helix.thinking", "Helix is thinking…"),
                errorLabel: SignalExplorerFilterStrings.string("helix.errorLabel", "Helix error:"),
                errorUnknown: SignalExplorerFilterStrings.string("ai.common.errorUnknown", "unknown")
            ),
            draft: model.draft,
            phase: model.phase,
            streamText: model.streamText
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

private extension AISignalExplorerNlFilter {
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
            label = SignalExplorerFilterStrings.string("signalExplorer.aiFilter.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SignalExplorerFilterStrings.string("signalExplorer.aiFilter.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SignalExplorerFilterStrings.string("signalExplorer.aiFilter.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: SignalExplorerFilterStrings.string(
            "signalExplorer.aiFilter.refresh", "Refresh"
        )))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? SignalExplorerFilterStrings.string(
                "signalExplorer.aiFilter.offlineBanner", "Offline — showing last known data"
            )
            : SignalExplorerFilterStrings.string(
                "signalExplorer.aiFilter.staleBanner", "Reconnecting — data may be stale"
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
