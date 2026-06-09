//
//  ChargingBreakdownSlide.swift
//  TeslaSync — P4 feature view · 0061 · ChargingBreakdownSlide (Apple)
//
//  The composable year-in-review charging slide — the SwiftUI parity of
//  features/analytics/components/review/ChargingBreakdownSlide.tsx. Binds through
//  `ChargingBreakdownSlideModel` (P1/S8); the slide fills its container and centers
//  its hero (web `flex flex-col items-center justify-center h-full`). Renders every
//  state (loading / empty / error / offline / stale / content) and emits the P1/S11
//  `view.opened` diagnostics event with the surface slug `ChargingBreakdownSlide`.
//  No networking lives in the view.
//

import SwiftUI

/// Native, Apple-idiomatic parity of the web `ChargingBreakdownSlide`: the 🔌 hero,
/// the "{sessions} charge sessions" headline, the average-plug-in-SOC caption, the
/// charging-mix donut, and the colored legend — plus the loading / empty / error /
/// stale / offline chrome the P4 surface contract requires. Binds through
/// `ChargingBreakdownSlideModel`.
public struct ChargingBreakdownSlide: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = "ChargingBreakdownSlide"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    @State private var model: ChargingBreakdownSlideModel
    private let telemetry: (any DashboardWidgetTelemetrySink)?

    /// Live / preview binding: the production app injects a source-backed model.
    public init(model: ChargingBreakdownSlideModel, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        _model = State(initialValue: model)
        self.telemetry = telemetry
    }

    /// Web-prop binding: the source component renders from a resolved `data` prop
    /// (`<ChargingBreakdownSlide data={data} />`). Builds the bound model from the
    /// prop so the call site matches the web component.
    @MainActor
    public init(data: ChargingBreakdownSlideData, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        self.init(model: ChargingBreakdownSlideModel(data: data), telemetry: telemetry)
    }

    public var body: some View {
        let presentation = ChargingBreakdownSlidePresentation.resolve(state: model.state)
        return content(for: presentation)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .topTrailing) { freshnessOverlay(for: presentation) }
            .task {
                telemetry?.record(ChargingBreakdownSlide.viewOpenedEvent)
                model.start()
            }
            .onDisappear { model.stop() }
            .onChange(of: isStale(presentation)) { _, stale in
                if stale { model.refresh() }
            }
            .accessibilityElement(children: .contain)
    }
}

// MARK: - Content states

private extension ChargingBreakdownSlide {
    @ViewBuilder
    func content(for presentation: ChargingBreakdownSlidePresentation) -> some View {
        switch presentation {
        case .loading:
            ChargingBreakdownSlideLoadingView()
        case .empty:
            ChargingBreakdownSlideEmptyView()
        case .offlineNoData:
            ChargingBreakdownSlideOfflineView { model.refresh() }
        case let .error(retryable):
            ChargingBreakdownSlideErrorView(retryable: retryable) { model.refresh() }
        case let .content(projection, _, _):
            slide(for: projection)
        }
    }

    /// The hero + donut + legend slide (web centered column). Fills the container and
    /// centers its content; the donut fades in (web `motion` 0.5s) and the legend
    /// last (web 0.8s). When the recap has sessions but no mix slices, the donut is
    /// omitted and the hero stands alone (never a blank ring).
    func slide(for projection: ChargingBreakdownSlideProjection) -> some View {
        VStack(spacing: TSSpacing.lg) {
            ChargingBreakdownSlideHero(projection: projection)
            if projection.hasSlices {
                TSFadeIn(delay: 0.5) {
                    ChargingBreakdownDonutChart(slices: projection.slices)
                }
                TSFadeIn(delay: 0.8) {
                    ChargingBreakdownSlideLegend(slices: projection.slices)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, TSSpacing.x2xl)
        .multilineTextAlignment(.center)
    }

    @ViewBuilder
    func freshnessOverlay(for presentation: ChargingBreakdownSlidePresentation) -> some View {
        if case let .content(_, freshness, _) = presentation, freshness != .live {
            ChargingBreakdownSlideFreshnessChip(freshness: freshness)
                .padding(TSSpacing.md)
        }
    }

    /// Whether the resolved presentation is stale content (drives auto-refresh).
    func isStale(_ presentation: ChargingBreakdownSlidePresentation) -> Bool {
        if case let .content(_, freshness, _) = presentation {
            return freshness == .stale
        }
        return false
    }
}
