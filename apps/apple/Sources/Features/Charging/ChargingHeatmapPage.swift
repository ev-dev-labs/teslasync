import SwiftUI

/// Native SwiftUI parity of `web/src/features/charging/pages/ChargingHeatmapPage.tsx`
/// (route `/charging-heatmap`). Charging-pattern analytics for the selected vehicle: the web
/// page chrome (`PageContainer` title + subtitle + the header `VehicleSelect` and
/// `RangePicker`), the four summary stat panels (Total Sessions / Energy / Cost / Avg
/// Duration), the Favorite-Charging-Time panel, the weekly day×hour heatmap grid with its
/// legend, and the Top-Charging-Locations bar chart. Every data state the source produces is
/// implemented (loading / error, and each section's own empty / success).
///
/// Adaptive (ADR-002/006): the stat grid reflows from two columns on compact iPhone to four on
/// macOS / iPad regular width, the heatmap scrolls horizontally when it can't fit, and the
/// panels stack in a scroll view. All copy resolves from `Localizable.xcstrings` with the web
/// key names; data binds through the `@Observable` `ChargingHeatmapPageModel` (no networking in
/// the view). The session energy is SI watt-hours and durations are SI seconds; the view
/// converts to the page's fixed kWh / minute display units only at the render boundary via the
/// shared `Units` facade + `ChargingHeatmapFormat` (ADR-005).
public struct ChargingHeatmapPage: View {
    @State private var model: ChargingHeatmapPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: ChargingHeatmapPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("charging.heatmap.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading else { return }
            await model.load()
        }
    }

    var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle + VehicleSelect / RangePicker)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    headerControls
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    headerControls
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("charging.heatmap.title")
            Text("charging.heatmap.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header actions: the `VehicleSelect` plus the `RangePicker` (a preset dropdown here).
    private var headerControls: some View {
        HStack(spacing: TSSpacing.md) {
            if !model.vehicles.isEmpty { vehiclePicker }
            rangePicker
        }
    }

    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .frame(maxWidth: 220)
        .accessibilityLabel(Text("charging.heatmap.selectVehicle"))
    }

    /// Web header `RangePicker` (the canonical preset window → the sessions query start/end).
    private var rangePicker: some View {
        TSSelect(
            selection: rangeBinding,
            options: ChargingHeatmapRange.allCases.map { TSSelectOption($0, LocalizedStringKey($0.labelKey)) }
        )
        .frame(maxWidth: 170)
        .accessibilityLabel(Text("charging.heatmap.range.label"))
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID ?? 0 },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    private var rangeBinding: Binding<ChargingHeatmapRange> {
        Binding(
            get: { model.range },
            set: { newValue in Task { await model.selectRange(newValue) } }
        )
    }

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChargingHeatmapSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    /// Web `PageContainer error` region — message plus a Retry affordance.
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

    // MARK: - Ready (web main PageContainer body — the always-rendered sections)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ChargingHeatmapStatsSection(stats: model.stats, isCompact: isCompact)
            ChargingHeatmapFavoriteSection(grid: model.grid)
            ChargingHeatmapGridSection(grid: model.grid, isCompact: isCompact)
            ChargingHeatmapLocationsSection(locations: model.locations)
        }
    }
}

#if DEBUG
    #Preview("Populated") {
        ChargingHeatmapPage(model: ChargingHeatmapPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        ChargingHeatmapPage(model: ChargingHeatmapPageModel(dataSource: EmptyChargingHeatmapDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        ChargingHeatmapPage(model: ChargingHeatmapPageModel(dataSource: FailingChargingHeatmapDataSource()))
            .teslaSyncTheme()
    }
#endif
