//
//  TripDetailPage.swift
//  TeslaSync — P4-APPLE P7 · page:trips/TripDetail (Apple) — Root view
//
//  Native SwiftUI / Apple HIG parity of `web/src/features/trips/pages/TripDetailPage.tsx`, adaptive
//  across macOS + iOS (ADR-002/006). One source of truth — the `@Observable` `TripDetailPageModel` —
//  drives the loading / empty / error / success states. On success the header subtitle (web
//  `trip.name ?? "Trip #{id}"`) sits above the four-tile stat row (Distance, Energy-Used, Efficiency,
//  Cost) and the GlassPanel detail panel. All copy resolves from `Localizable.xcstrings` with the web
//  key names; numeric values format at the render boundary via the shared `Units` facade; no
//  networking lives in the view (ADR-004).
//

import SwiftUI

public struct TripDetailPage: View {
    @State private var model: TripDetailPageModel

    public init(model: TripDetailPageModel) {
        _model = State(initialValue: model)
    }

    public init(
        tripID: Int64,
        currencySymbol: String = TripDetailFormat.defaultCurrencySymbol,
        dataSource: any TripDetailDataSource = SampleTripDetailDataSource()
    ) {
        _model = State(initialValue: TripDetailPageModel(
            tripID: tripID,
            currencySymbol: currencySymbol,
            dataSource: dataSource
        ))
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("translation.trips.detail.title"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .refreshable { await model.refresh() }
            .task {
                guard case .loading = model.state else { return }
                await model.load()
            }
    }

    // MARK: - Top-level status switch (web `loading ? … : error ? … : trip ? body : EmptyState`)

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            TripDetailSkeleton()
        case .empty:
            emptyState
        case let .error(message):
            errorView(message)
        case let .success(record):
            successBody(record)
        }
    }

    // MARK: - Success (web main body)

    @ViewBuilder
    private func successBody(_ record: TripDetailRecord) -> some View {
        Text(verbatim: record.displayTitle)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
        TripDetailStatsSection(model: model)
        TripDetailInfoSection(model: model)
    }

    // MARK: - Empty (web `EmptyState message={t('trips.detail.notFound')}`)

    /// The resolved-but-missing trip state: a HIG `ContentUnavailableView` carrying the web
    /// `trips.detail.notFound` copy (ADR-011 — never a blank region).
    private var emptyState: some View {
        TSEmptyState(
            title: "translation.trips.detail.notFound",
            systemImage: "map"
        )
        .frame(maxWidth: .infinity, minHeight: 280)
    }

    // MARK: - Error (web `PageContainer error`)

    /// Retryable failure of the trip fetch with the HIG retry affordance (ADR-011).
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
    }
}

#if DEBUG
    #Preview("Success") {
        NavigationStack {
            TripDetailPage(tripID: 42)
        }
        .tsUnits(.metric)
    }

    #Preview("Imperial") {
        NavigationStack {
            TripDetailPage(tripID: 42)
        }
        .tsUnits(.imperial)
    }

    #Preview("Empty") {
        NavigationStack {
            TripDetailPage(tripID: 42, dataSource: EmptyTripDetailDataSource())
        }
        .tsUnits(.metric)
    }

    #Preview("Error") {
        NavigationStack {
            TripDetailPage(tripID: 42, dataSource: FailingTripDetailDataSource())
        }
        .tsUnits(.metric)
    }
#endif
