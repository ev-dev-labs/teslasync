//
//  EmptyStateThreshold.swift
//  TeslaSync — P4 shared surface · 0119 · EmptyStateThreshold (Apple)
//
//  The EmptyStateThreshold shared surface — the SwiftUI parity of
//  `components/feedback/EmptyStateThreshold.tsx`. A non-error empty state for sections that only
//  become useful at scale (e.g. a heatmap needs ≥ 30 sessions): a healthy green check plus a friendly
//  count message, so the section is never silently hidden. Driven by the documented data source
//  (`useTranslation`) and the controlled gate counts, binding through `EmptyStateThresholdModel`
//  (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading   — the counts are resolving → skeleton card chrome.
//    • empty     — the section is no longer gated → a friendly "ready" card, never a blank box.
//    • error     — the count feed failed → a retryable error tile (web `QueryError` peer).
//    • threshold — the surface itself: the green check, the section title, the optional description,
//                  the count message (custom or auto), and the optional CTA (web `action`).
//    • stale / offline — the orthogonal connectivity axis → a freshness chip beneath the card with a
//                  one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - EmptyStateThreshold (the shared surface)

/// The EmptyStateThreshold shared surface — renders every state plus the P4 leaf freshness states,
/// binding through `EmptyStateThresholdModel`.
public struct EmptyStateThreshold: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "EmptyStateThreshold"

    @State private var model: EmptyStateThresholdModel

    public init(model: EmptyStateThresholdModel) {
        _model = State(initialValue: model)
    }

    /// Convenience for the controlled-host usage — the parity of a web host mounting
    /// `<EmptyStateThreshold …>` with a pre-built gate. A missing `onAction` hides the CTA, exactly as
    /// the optional web `action` node does.
    public init(
        gate: EmptyStateThresholdGate?,
        connection: EmptyStateThresholdConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        onAction: (@MainActor () -> Void)? = nil
    ) {
        let source = StaticEmptyStateThresholdSource(
            gate: gate,
            connection: connection,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
        _model = State(initialValue: EmptyStateThresholdModel(source: source, onAction: onAction))
    }

    /// Convenience for the common raw-props usage — the parity of `<EmptyStateThreshold sectionLabel=…
    /// currentCount=… threshold=… />`. The string labels are taken verbatim (the host passes copy it
    /// already localised, web parity), and a wired `onAction` + `actionLabel` surface the CTA.
    public init(
        sectionLabel: String,
        currentCount: Int,
        threshold: Int,
        itemNoun: String? = nil,
        description: String? = nil,
        message: String? = nil,
        actionLabel: String? = nil,
        connection: EmptyStateThresholdConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        onAction: (@MainActor () -> Void)? = nil
    ) {
        let gate = EmptyStateThresholdGate(
            currentCount: currentCount,
            threshold: threshold,
            sectionLabel: .verbatim(sectionLabel),
            itemNoun: itemNoun.map(EmptyStateThresholdText.verbatim),
            description: description.map(EmptyStateThresholdText.verbatim),
            customMessage: message.map(EmptyStateThresholdText.verbatim),
            actionLabel: actionLabel.map(EmptyStateThresholdText.verbatim)
        )
        self.init(
            gate: gate,
            connection: connection,
            isLoading: isLoading,
            errorMessage: errorMessage,
            onAction: onAction
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                EmptyStateThresholdFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            EmptyStateThresholdLoadingView()
        case .empty:
            EmptyStateThresholdEmptyView()
        case let .error(message):
            EmptyStateThresholdErrorView(message: message) { model.refresh() }
        case .threshold:
            if let content = model.resolved.content {
                EmptyStateThresholdCard(content: content) { model.performAction() }
            }
        }
    }
}
