//
//  TimeToChargeSection.swift
//  TeslaSync — P4 feature view · 0094 · TimeToChargeSection (Apple)
//
//  The composable time-to-charge analysis section — the SwiftUI parity of
//  web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx.
//  Binds through `TimeToChargeModel` (P1/S8); the section is always mounted so the
//  persistent title + description render in-place and every state (loading /
//  empty / error / stale / offline / content) renders rather than gating the
//  surface. No networking lives in the view. Emits the P1/S11 `view.opened`
//  diagnostics event with the surface slug `TimeToChargeSection` on appear.
//
//  Composition scope: the web section also renders a `YearlyTrendChart` child. In
//  the native decomposition that chart is its own sibling surface (this prompt
//  scopes the title + description + four metric cards). The full `yearlyTrend`
//  series is still computed by the adapter — it is part of this section's data and
//  the sibling chart binds to it — and is exposed on the resolved content state.
//

import SwiftUI

// MARK: - TimeToChargeSection (the feature surface)

/// Native, Apple-idiomatic parity of the web `TimeToChargeSection`: the
/// title + description and the four metric cards (10→80 / 20→80 average duration,
/// fastest / slowest session rate), plus the loading / empty / error / stale /
/// offline chrome the prompt's surface contract requires.
public struct TimeToChargeSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = "TimeToChargeSection"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    @Bindable private var model: TimeToChargeModel
    private let telemetry: (any DashboardWidgetTelemetrySink)?

    /// Live / preview binding: the production app injects a source-backed model.
    public init(model: TimeToChargeModel, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        self.model = model
        self.telemetry = telemetry
    }

    /// Web-prop binding: the web section renders from `sessions` (+ a `loading`
    /// flag owned by the parent ChargingCurve page). Constructs the bound model
    /// from the props so the call site matches the web `<TimeToChargeSection sessions />`.
    @MainActor
    public init(
        sessions: [TimeToChargeSectionChargingSessionSummary],
        loading: Bool = false,
        telemetry: (any DashboardWidgetTelemetrySink)? = nil
    ) {
        self.init(
            model: TimeToChargeModel(sessions: sessions, loading: loading),
            telemetry: telemetry
        )
    }

    public var body: some View {
        let presentation = model.presentation
        return VStack(alignment: .leading, spacing: TSSpacing.md) {
            TTCHeader { headerAccessory(for: presentation) }
            content(for: presentation)
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .task {
            telemetry?.record(TimeToChargeSection.viewOpenedEvent)
            model.start()
        }
        .onDisappear { model.stop() }
        .onChange(of: isStale(presentation)) { _, stale in
            if stale { model.refresh() }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header accessory

extension TimeToChargeSection {
    @ViewBuilder
    private func headerAccessory(for presentation: TimeToChargePresentation) -> some View {
        switch presentation {
        case let .content(content):
            TTCStatusAccessory(
                freshness: content.freshness,
                refreshing: content.refreshing
            ) { model.refresh() }
        case .offlineNoData:
            TTCFreshnessChip(freshness: .offline)
        case .error:
            TTCFreshnessChip(freshness: .stale)
        case .loading, .empty:
            EmptyView()
        }
    }
}

// MARK: - Content states

extension TimeToChargeSection {
    @ViewBuilder
    private func content(for presentation: TimeToChargePresentation) -> some View {
        switch presentation {
        case .loading:
            TTCLoadingView()
        case .empty:
            TTCEmptyView()
        case .offlineNoData:
            TTCOfflineView { model.refresh() }
        case let .error(retryable):
            TTCErrorView(retryable: retryable) { model.refresh() }
        case let .content(content):
            TTCCardsGrid(cards: content.cards)
        }
    }

    /// Whether the resolved presentation is stale content (drives auto-refresh).
    private func isStale(_ presentation: TimeToChargePresentation) -> Bool {
        if case let .content(content) = presentation {
            return content.freshness == .stale
        }
        return false
    }
}
