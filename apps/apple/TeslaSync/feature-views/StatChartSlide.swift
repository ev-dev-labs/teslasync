//
//  StatChartSlide.swift
//  TeslaSync — P4 feature view · 0067 · StatChartSlide (Apple)
//
//  The composable year-in-review stat slide — the SwiftUI parity of
//  features/analytics/components/review/StatChartSlide.tsx. Binds through
//  `StatChartSlideModel` (P1/S8); the slide fills its container and centers its
//  hero (web `flex flex-col items-center justify-center h-full`). Renders every
//  state (loading / empty / error / offline / stale / content) and emits the P1/S11
//  `view.opened` diagnostics event with the surface slug `StatChartSlide`. No
//  networking lives in the view.
//

import SwiftUI

/// Native, Apple-idiomatic parity of the web `StatChartSlide`: the 🗓️ hero, the
/// counting drive total + "drives" label, the average-per-week caption, and the
/// drives-by-month bar chart — plus the loading / empty / error / stale / offline
/// chrome the P4 surface contract requires. Binds through `StatChartSlideModel`.
public struct StatChartSlide: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = "StatChartSlide"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    @State private var model: StatChartSlideModel
    private let telemetry: (any DashboardWidgetTelemetrySink)?

    /// Live / preview binding: the production app injects a source-backed model.
    public init(model: StatChartSlideModel, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        _model = State(initialValue: model)
        self.telemetry = telemetry
    }

    /// Web-prop binding: the source component renders from a resolved `data` prop
    /// (`<StatChartSlide data={data} />`). Builds the bound model from the prop so the
    /// call site matches the web component.
    @MainActor
    public init(data: StatChartSlideData, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        self.init(model: StatChartSlideModel(data: data), telemetry: telemetry)
    }

    public var body: some View {
        let presentation = StatChartSlidePresentation.resolve(state: model.state)
        return content(for: presentation)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .topTrailing) { freshnessOverlay(for: presentation) }
            .task {
                telemetry?.record(StatChartSlide.viewOpenedEvent)
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

private extension StatChartSlide {
    @ViewBuilder
    func content(for presentation: StatChartSlidePresentation) -> some View {
        switch presentation {
        case .loading:
            StatChartSlideLoadingView()
        case .empty:
            StatChartSlideEmptyView()
        case .offlineNoData:
            StatChartSlideOfflineView { model.refresh() }
        case let .error(retryable):
            StatChartSlideErrorView(retryable: retryable) { model.refresh() }
        case let .content(projection, _, _):
            slide(for: projection)
        }
    }

    /// The hero + chart slide (web centered column). Fills the container and centers
    /// its content; the chart fades in last (web `motion` 0.7s delay).
    func slide(for projection: StatChartSlideProjection) -> some View {
        VStack(spacing: TSSpacing.x2xl) {
            StatChartSlideHeadline(projection: projection, localeIdentifier: localeIdentifier)
            TSFadeIn(delay: 0.7) {
                StatChartSlideChart(bars: projection.bars, localeIdentifier: localeIdentifier)
                    .frame(height: 200)
                    .frame(maxWidth: 480)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, TSSpacing.x2xl)
        .multilineTextAlignment(.center)
    }

    @ViewBuilder
    func freshnessOverlay(for presentation: StatChartSlidePresentation) -> some View {
        if case let .content(_, freshness, _) = presentation, freshness != .live {
            StatChartSlideFreshnessChip(freshness: freshness)
                .padding(TSSpacing.md)
        }
    }

    /// Whether the resolved presentation is stale content (drives auto-refresh).
    func isStale(_ presentation: StatChartSlidePresentation) -> Bool {
        if case let .content(_, freshness, _) = presentation {
            return freshness == .stale
        }
        return false
    }

    /// The render locale (web global locale); the projection texts use the same.
    var localeIdentifier: String {
        Locale.current.identifier
    }
}
