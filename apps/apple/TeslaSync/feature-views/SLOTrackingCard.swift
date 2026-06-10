//
//  SLOTrackingCard.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  The personal "Uptime & SLO" surface — the SwiftUI parity of
//  features/system/components/status/SLOTrackingCard.tsx. Renders inside a frosted
//  panel (web `<GlassPanel>`) fading in on appear (the shared status-page `<FadeIn>`
//  pattern): a header with the editable personal target, the big tone-colored
//  percentage figure (switched over the bound model's phase so every prompt-required
//  state renders — loading / content / empty / error — never a blank box), the
//  always-visible window selector, and the snapshot caveat, with the stale / offline
//  freshness chrome layered above. Binds through `SLOTrackingModel` (P1/S8); no
//  networking lives here.
//

import SwiftUI

/// The personal "Uptime & SLO" card — the SwiftUI parity of the web
/// `SLOTrackingCard`, binding through `SLOTrackingModel` (P1/S8).
public struct SLOTrackingCard: View {
    @State private var model: SLOTrackingModel

    public init(model: SLOTrackingModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return TSFadeIn(delay: 0.045) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    SLOTrackingHeader(
                        titleKey: "Uptime & SLO",
                        titleFallback: "Uptime & SLO",
                        connection: model.connection,
                        targetToken: model.targetToken,
                        isEditing: model.isEditingTarget,
                        draft: $model.draftTarget,
                        onEdit: { model.beginEditingTarget() },
                        onSave: { model.saveTarget() },
                        onCancel: { model.cancelEditingTarget() }
                    )

                    if model.connection != .live {
                        SLOTrackingConnectivityBanner(connection: model.connection)
                    }

                    SLOTrackingFigureRegion(
                        phase: model.phase,
                        percentText: model.percentText,
                        tone: model.tone,
                        windowLabel: model.windowLabel,
                        componentsClause: model.componentsClause,
                        figureSummary: model.figureSummary,
                        onRetry: { model.retry() }
                    )

                    SLOWindowSelector(
                        selected: model.selectedWindow,
                        onSelect: { model.selectWindow($0) }
                    )

                    if model.phase == .content, model.showsCaveat {
                        SLOHistoricalCaveat(text: model.caveatText)
                    }
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}
