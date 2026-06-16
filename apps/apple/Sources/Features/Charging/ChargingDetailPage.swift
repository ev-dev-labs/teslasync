import SwiftUI

/// Native SwiftUI parity of `web/src/features/charging/pages/ChargingDetailPage.tsx`
/// (route `/charging/:id`). A completed charge session in full: the header (date title,
/// vehicle, and the DC/AC + live-state + charger + place badges), five hero gauges
/// (energy / end-SoC / peak-power / duration / avg-power), the battery-progress meter,
/// the eight headline stat cards, the more-details panel, the charge-curve area chart, the
/// three synced time-series charts (SoC·energy·range, temperature, voltage·current), the
/// live advanced-parameters panel, and the timestamps footer. Every data state the source
/// produces is implemented (loading / error, plus each chart's own empty / success).
///
/// Adaptive (ADR-002/006): the gauge + stat grids reflow for macOS / iPad regular width
/// vs. compact iPhone, and the panels stack in a scroll view; in a `NavigationStack` the
/// system back button replaces the web back link. All copy resolves from
/// `Localizable.xcstrings` with the web key names; numeric values format at the render
/// boundary through `Units` / the `TS*` SI formatter components — nothing non-SI is stored
/// or computed (ADR-005). Data binds through the `@Observable` `ChargingDetailPageModel`
/// (no networking in the view).
public struct ChargingDetailPage: View {
    @State private var model: ChargingDetailPageModel

    public init(model: ChargingDetailPageModel) {
        _model = State(initialValue: model)
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
        .navigationTitle(Text("charging.detail.title"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading else { return }
            await model.load()
        }
    }

    // MARK: - Top-level phase switch (web `isLoading || !session ? Skeleton : body`)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChargingDetailPageSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    /// Retryable failure of the session fetch — the Apple-native error region (the web
    /// detail page has no error branch, so HIG adds a retry affordance, ADR-011).
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
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main body — every panel always renders)

    @ViewBuilder
    private var readyView: some View {
        if let session = model.session {
            ChargingDetailHeader(session: session, vehicle: model.vehicle, live: model.live)
            ChargingHeroGaugeSection(session: session)
            ChargingBatteryProgressSection(session: session)
            ChargingStatGridSection(session: session)
            ChargingMoreDetailsSection(session: session, vehicle: model.vehicle)
            ChargingLocationSection(session: session)
            ChargingChargeCurveSection(session: session, telemetry: model.telemetry)
            ChargingTimeSeriesSection(telemetry: model.telemetry)
            ChargingTemperatureSection(telemetry: model.telemetry)
            ChargingVoltageCurrentSection(telemetry: model.telemetry)
            ChargingAdvancedSection(live: model.live)
            ChargingTimestampsSection(session: session)
        } else {
            ChargingDetailPageSkeleton()
        }
    }
}

#if DEBUG
    #Preview("Success") {
        NavigationStack {
            ChargingDetailPage(model: ChargingDetailPageModel(sessionID: 42))
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }

    #Preview("Empty charts") {
        NavigationStack {
            ChargingDetailPage(
                model: ChargingDetailPageModel(sessionID: 42, dataSource: EmptyChargingDetailDataSource())
            )
        }
        .tsUnits(.imperial)
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            ChargingDetailPage(
                model: ChargingDetailPageModel(sessionID: 42, dataSource: FailingChargingDetailDataSource())
            )
        }
        .tsUnits(.metric)
        .teslaSyncTheme()
    }
#endif
