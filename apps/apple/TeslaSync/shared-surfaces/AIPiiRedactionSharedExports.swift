//
//  AIPiiRedactionSharedExports.swift
//  TeslaSync — P4 shared surface · 0038 · AIPiiRedactionSharedExports (Apple)
//
//  The "Plan PII redactions before sharing" Helix panel — the SwiftUI parity of
//  components/ai/AIPiiRedactionSharedExports.tsx. Reproduces the web source's composition (the
//  `withAiFeature` gate, the `AIFeatureCard` scaffold — title + cyan Helix badge + description +
//  the export-type `inputSlot` + the universal "Ask Helix" action — and the streamed
//  `AiOutputPanel`) plus the P4 leaf contract states. Binds through `PiiRedactionExportsModel`
//  (P1/S8); no networking lives here. The web `onEvent` is a no-op and the catalog-based
//  narrative streams straight into the output panel — there is no draft capture and no proposal
//  children.
//
//  States (every one renders — no hidden surface, except the AI-Off gate which is the sanctioned
//  ADR-015 "render nothing" contract, faithful to web `withAiFeature` → null):
//    • gateLoading — the AI-Off gate is resolving → skeleton chrome.
//    • ready/idle  — gate on, nothing streamed yet → the resting invite card (header +
//                    description + export-type field + "Ask Helix"); never a blank surface.
//    • empty       — gate on, no export type picked → the "Pick an export type…" hint + a
//                    disabled action; the card still renders fully.
//    • streaming   — SSE open → "Helix is thinking…" + the output thinking indicator.
//    • stream error— the SSE ended in `error` → the Helix error row in the output panel.
//    • gateError   — the gate / context fetch failed → `QueryError` peer with retry.
//    • stale/offline — the orthogonal `connection` axis → freshness chip + banner with a one-shot
//                    auto-refresh on the stale transition; offline disables the action (no stream
//                    is possible) while keeping the cached context.
//    • gatedOff    — the feature is disabled → renders nothing (web `withAiFeature` null).
//

import SwiftUI

// MARK: - AIPiiRedactionSharedExports (the feature surface)

/// The "Plan PII redactions before sharing" Helix panel — the SwiftUI parity of
/// `components/ai/AIPiiRedactionSharedExports.tsx`. Renders every state from the web source plus
/// the P4 leaf states, binding through `PiiRedactionExportsModel`.
public struct AIPiiRedactionSharedExports: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PiiRedactionExportsSurface.slug

    /// The AI feature id this surface gates on (web `withAiFeature` argument).
    public static let featureID = PiiRedactionExportsSurface.featureID

    @State private var model: PiiRedactionExportsModel

    public init(model: PiiRedactionExportsModel) {
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
                glass { PiiRedactionExportsGateLoadingView() }
            case let .gateError(message):
                glass {
                    PiiRedactionExportsGateErrorView(message: message) { model.refresh() }
                }
            case .ready:
                readyCard
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    // MARK: Ready card (web `AIFeatureCard` + `inputSlot` + `AiOutputPanel`)

    private var readyCard: some View {
        glass {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                statusRow
                if model.connection != .live {
                    connectivityBanner
                }
                PiiRedactionExportsHeader(hint: model.emptyHint)
                PiiRedactionExportsTypeField(selection: selectionBinding)
                PiiRedactionExportsActionButton(
                    isStreaming: model.phase == .streaming,
                    disabled: model.buttonDisabled
                ) {
                    model.suggest()
                }
                PiiRedactionExportsOutputPanel(phase: model.phase, text: model.streamText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// Two-way binding to the model's `selectedType` (web `useState`) for the menu field. Manual
    /// (rather than `@Bindable`) so the surface keeps owning the model via `@State`.
    private var selectionBinding: Binding<PiiRedactionExportType?> {
        Binding(get: { model.selectedType }, set: { model.selectedType = $0 })
    }

    /// The VoiceOver summary — the title plus the live stream status (thinking / error / streamed
    /// narrative), built through the testable `PiiRedactionExportsAccessibility` seam so it is
    /// asserted without rendering.
    private var accessibilitySummary: String {
        PiiRedactionExportsAccessibility.summary(
            labels: .init(
                title: PiiRedactionExportsStrings.string(
                    "exports.aiRedaction.title", "Plan PII redactions before sharing"
                ),
                thinking: PiiRedactionExportsStrings.string("helix.thinking", "Helix is thinking…"),
                errorLabel: PiiRedactionExportsStrings.string("helix.errorLabel", "Helix error:"),
                errorUnknown: PiiRedactionExportsStrings.string("ai.common.errorUnknown", "unknown")
            ),
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

private extension AIPiiRedactionSharedExports {
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
            label = PiiRedactionExportsStrings.string("exports.aiRedaction.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = PiiRedactionExportsStrings.string("exports.aiRedaction.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = PiiRedactionExportsStrings.string("exports.aiRedaction.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: PiiRedactionExportsStrings.string(
            "exports.aiRedaction.refresh", "Refresh"
        )))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? PiiRedactionExportsStrings.string(
                "exports.aiRedaction.offlineBanner", "Offline — showing last known data"
            )
            : PiiRedactionExportsStrings.string(
                "exports.aiRedaction.staleBanner", "Reconnecting — data may be stale"
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
