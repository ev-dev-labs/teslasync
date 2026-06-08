//
//  SavingsSlide.swift
//  TeslaSync — P4 feature view · 0065 · SavingsSlide (Apple)
//
//  The composable "Year in Review" savings slide — the SwiftUI parity of
//  web/src/features/analytics/components/review/SavingsSlide.tsx. Binds through
//  `SavingsSlideModel` (P1/S8); the slide is always mounted so the loading +
//  empty states render in-place rather than gating the surface. Renders every
//  state (loading / empty / error / stale / offline / content). No networking
//  lives in the view. Emits the P1/S11 `view.opened` diagnostics event with the
//  surface slug `SavingsSlide` on appear.
//

import SwiftUI

// MARK: - SavingsSlide (the feature surface)

/// Native, Apple-idiomatic parity of the web `SavingsSlide`: the centered savings
/// celebration (💰 emoji, count-up `$` hero, gas-vs-electric comparison bars, and
/// the cups-of-coffee note) plus the loading / empty / error / stale / offline
/// chrome the prompt's surface contract requires.
public struct SavingsSlide: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = "SavingsSlide"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    @Bindable private var model: SavingsSlideModel
    private let telemetry: (any DashboardWidgetTelemetrySink)?

    /// Live / preview binding: the production app injects a source-backed model.
    public init(model: SavingsSlideModel, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        self.model = model
        self.telemetry = telemetry
    }

    /// Web-prop binding: the source component renders from `data: YearReview`.
    /// Constructs the bound model from the savings slice so the call site matches
    /// the web `<SavingsSlide data={data} />`.
    @MainActor
    public init(
        data: YearReviewSavings,
        loading: Bool = false,
        telemetry: (any DashboardWidgetTelemetrySink)? = nil
    ) {
        self.init(model: SavingsSlideModel(data: data, loading: loading), telemetry: telemetry)
    }

    public var body: some View {
        let presentation = SavingsSlidePresentation.resolve(state: model.state)
        return ZStack(alignment: .topTrailing) {
            content(for: presentation)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            accessory(for: presentation)
                .padding(TSSpacing.md)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.xl)
        .background(Color.TS.bg)
        .task {
            telemetry?.record(SavingsSlide.viewOpenedEvent)
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

extension SavingsSlide {
    @ViewBuilder
    private func content(for presentation: SavingsSlidePresentation) -> some View {
        switch presentation {
        case .loading:
            SavingsLoadingView()
        case .empty:
            SavingsEmptyView()
        case .offlineNoData:
            SavingsOfflineView { model.refresh() }
        case let .error(retryable):
            SavingsErrorView(retryable: retryable) { model.refresh() }
        case let .content(projection, _, _):
            SavingsContent(projection: projection)
        }
    }

    @ViewBuilder
    private func accessory(for presentation: SavingsSlidePresentation) -> some View {
        switch presentation {
        case let .content(_, freshness, refreshing):
            SavingsStatusAccessory(freshness: freshness, refreshing: refreshing) { model.refresh() }
        case .offlineNoData:
            SavingsFreshnessChip(freshness: .offline)
        case .error:
            SavingsFreshnessChip(freshness: .stale)
        case .loading, .empty:
            EmptyView()
        }
    }

    /// Whether the resolved presentation is stale content (drives auto-refresh).
    private func isStale(_ presentation: SavingsSlidePresentation) -> Bool {
        if case let .content(_, freshness, _) = presentation {
            return freshness == .stale
        }
        return false
    }
}
