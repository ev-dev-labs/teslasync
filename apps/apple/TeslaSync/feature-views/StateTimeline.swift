//
//  StateTimeline.swift
//  TeslaSync — P4 feature view · 0235 · StateTimeline (Apple)
//
//  The composable FSM transition-timeline surface — the SwiftUI parity of
//  features/system/components/state-machine/StateTimeline.tsx. Renders inside a card
//  fading in on appear, surfaces the live-state freshness chip + stale/offline banner
//  (ADR-013), and switches over the bound model's phase so every prompt-required state
//  renders (loading / empty / error / stale / offline / content) — never a blank box.
//  The populated phase shows the window header (start · window · end) above the tick
//  rail, matching the web populated branch; the empty phase shows the actionable
//  "No transitions in window" hint. Binds through `StateTimelineModel` (P1/S8); no
//  networking lives here.
//

import SwiftUI

/// The composable horizontal FSM transition timeline — the SwiftUI parity of the web
/// `StateTimeline`, binding through `StateTimelineModel` (P1/S8).
public struct StateTimeline: View {
    @State private var model: StateTimelineModel

    public init(model: StateTimelineModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.15) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack {
                    Spacer(minLength: TSSpacing.sm)
                    StateTimelineFreshnessChip(connection: model.connection)
                }
                if model.connection != .live {
                    StateTimelineConnectivityBanner(connection: model.connection)
                }
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web `ticks.length === 0 ? <empty> : <header + rail>` branch, widened to the
    /// full load envelope (loading / error / empty / content) so no state is hidden
    /// behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            StateTimelineLoadingView()
        case let .error(message):
            StateTimelineErrorView(message: message) { model.refresh() }
        case .empty:
            StateTimelineEmptyView(
                message: model.emptyMessage,
                lastSeen: model.lastSeenLabel,
                widenLabel: model.showWiden ? model.widenLabel : nil,
                jumpLabel: model.jumpLabel,
                showJump: model.showJump,
                onWiden: { model.widenWindow() },
                onJump: { model.jumpToLast() }
            )
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                StateTimelineHeader(
                    startLabel: model.startLabel,
                    windowLabel: model.windowLabelText,
                    endLabel: model.endLabel
                )
                StateTimelineRail(
                    ticks: model.ticks,
                    selectedID: model.selectedID,
                    tooltip: { model.tooltip(for: $0) },
                    label: { model.tickAccessibilityLabel(for: $0) },
                    onSelect: { model.select($0) }
                )
            }
        }
    }
}
