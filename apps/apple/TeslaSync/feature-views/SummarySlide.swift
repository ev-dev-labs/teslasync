//
//  SummarySlide.swift
//  TeslaSync — P4 feature view · 0069 · SummarySlide (Apple)
//
//  The composable "Year in Review" recap slide — the SwiftUI parity of
//  web/src/features/analytics/components/review/SummarySlide.tsx. Binds through
//  `SummarySlideModel` (P1/S8); the surface renders every state (loading / empty /
//  error / stale / offline / content) in-place rather than gating the card. No
//  networking lives in the view. Emits the P1/S11 `view.opened` diagnostics event
//  with the surface slug `SummarySlide` on appear.
//

import SwiftUI

// MARK: - SummarySlide (the feature surface)

/// Native, Apple-idiomatic parity of the web `SummarySlide`: the screenshot-ready
/// year-in-review recap card (web gradient `motion.div`) with its staggered stat
/// rows, conditional savings line, and share caption — plus the loading / empty /
/// error / stale / offline chrome the prompt's surface contract requires.
public struct SummarySlide: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = "SummarySlide"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    @Bindable private var model: SummarySlideModel
    private let telemetry: (any DashboardWidgetTelemetrySink)?

    /// Live / preview binding: the production app injects a source-backed model.
    public init(model: SummarySlideModel, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        self.model = model
        self.telemetry = telemetry
    }

    /// Web-prop binding: the source component renders from `data: YearReview` (+ the
    /// `useUnits` distance preference). Constructs the bound model from the prop so
    /// the call site matches the web `<SummarySlide data={data} />`.
    @MainActor
    public init(
        data: YearReviewSummary,
        loading: Bool = false,
        distanceUnit: DistanceDisplayUnit = .kilometers,
        telemetry: (any DashboardWidgetTelemetrySink)? = nil
    ) {
        self.init(
            model: SummarySlideModel(data: data, loading: loading, distanceUnit: distanceUnit),
            telemetry: telemetry
        )
    }

    public var body: some View {
        let presentation = SummarySlidePresentation.resolve(
            state: model.state,
            distanceUnit: model.distanceUnit
        )
        return content(for: presentation)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(TSSpacing.xl)
            .background(Color.TS.bg)
            .task {
                telemetry?.record(SummarySlide.viewOpenedEvent)
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

extension SummarySlide {
    @ViewBuilder
    private func content(for presentation: SummarySlidePresentation) -> some View {
        switch presentation {
        case .loading:
            centered { SummaryLoadingView() }
        case .empty:
            SummaryEmptyView()
        case .offlineNoData:
            SummaryOfflineView { model.refresh() }
        case let .error(retryable):
            SummaryErrorView(retryable: retryable) { model.refresh() }
        case let .content(projection, freshness, refreshing):
            centered {
                TSFadeIn {
                    VStack(spacing: TSSpacing.xl) {
                        SummaryRecapCard(
                            projection: projection,
                            freshness: freshness,
                            refreshing: refreshing,
                            onRefresh: { model.refresh() }
                        )
                        SummaryShareHint(hint: projection.screenshotHint)
                    }
                }
            }
        }
    }

    /// Centers content in the available space (web `items-center justify-center`).
    private func centered(@ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack {
            Spacer(minLength: 0)
            content()
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
    }

    /// Whether the resolved presentation is stale content (drives auto-refresh).
    private func isStale(_ presentation: SummarySlidePresentation) -> Bool {
        if case let .content(_, freshness, _) = presentation {
            return freshness == .stale
        }
        return false
    }
}
