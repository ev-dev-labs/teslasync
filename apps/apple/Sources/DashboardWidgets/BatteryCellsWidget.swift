import SwiftUI

// MARK: - Widget surface

/// Native, Apple-idiomatic parity of the web `BatteryCellsWidget`: a cell-level
/// voltage heatmap with min/max/avg/spread stats and (when wide) a per-module
/// temperature summary. Renders loading / empty / error / offline / stale and
/// loaded states, all strings via the P1/S10 catalog.
public struct BatteryCellsWidget: View, DashboardWidgetSurface {
    public nonisolated static let descriptor = DashboardWidgetDescriptor(
        id: "battery-cells",
        titleKey: "translation.widget.batteryCells.title",
        category: .battery,
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    public nonisolated static let surfaceSlug = "BatteryCellsWidget"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    private let props: DashboardWidgetProps
    private let telemetry: (any DashboardWidgetTelemetrySink)?
    @Bindable private var model: BatteryCellsModel

    public init(
        props: DashboardWidgetProps,
        model: BatteryCellsModel,
        telemetry: (any DashboardWidgetTelemetrySink)? = nil
    ) {
        self.props = props
        self.telemetry = telemetry
        self.model = model
    }

    private var isCompact: Bool {
        props.size.cols <= 1
    }

    private var cellWord: String {
        String(localized: "translation.widget.batteryCells.cell")
    }

    public var body: some View {
        let presentation = BatteryCellsPresentation.resolve(
            state: model.state,
            size: props.size,
            cellWord: cellWord
        )
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !isCompact {
                header(for: presentation)
            }
            content(for: presentation)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task {
            telemetry?.record(BatteryCellsWidget.viewOpenedEvent)
            model.start()
        }
        .onDisappear { model.stop() }
    }

    // MARK: Header

    private func header(for presentation: BatteryCellsPresentation) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "cpu")
                .font(.caption)
                .foregroundStyle(Color.TS.accent)
            Text("translation.widget.batteryCells.title")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .textCase(.uppercase)
            Spacer(minLength: TSSpacing.sm)
            headerAccessory(for: presentation)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func headerAccessory(for presentation: BatteryCellsPresentation) -> some View {
        switch presentation {
        case let .content(_, freshness, refreshing):
            HStack(spacing: TSSpacing.xs) {
                BatteryCellsFreshnessChip(freshness: freshness)
                if refreshing {
                    ProgressView().controlSize(.mini)
                }
            }
        case .offlineNoData:
            BatteryCellsFreshnessChip(freshness: .offline)
        case .error:
            BatteryCellsFreshnessChip(freshness: .stale)
        case .loading, .empty:
            EmptyView()
        }
    }

    // MARK: Body states

    @ViewBuilder private func content(for presentation: BatteryCellsPresentation) -> some View {
        switch presentation {
        case .loading:
            BatteryCellsLoadingView(columns: max(2, props.size.cols))
        case .empty:
            emptyState
        case .offlineNoData:
            offlineState
        case let .error(retryable):
            errorState(retryable: retryable)
        case let .content(projection, _, _):
            BatteryCellsContentView(projection: projection)
        }
    }

    private var emptyState: some View {
        TSEmptyState(
            title: "translation.widget.batteryCells.noData",
            systemImage: "cpu"
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var offlineState: some View {
        TSEmptyState(
            title: "translation.widget.batteryCells.noData",
            message: "widget.freshness.offline",
            systemImage: "wifi.slash"
        ) {
            TSButton("translation.common.retry", variant: .secondary, size: .small) {
                model.refresh()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(retryable: Bool) -> some View {
        TSQueryError(message: "translation.widget.batteryCells.noData") {
            model.refresh()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHint(retryable ? Text("translation.common.retry") : Text(verbatim: ""))
    }
}

// MARK: - Previews

#if DEBUG
    private enum BatteryCellsPreviewData {
        static func summary(cellCount: Int = 8, includeOutliers: Bool = true) -> BatteryCellSummary {
            let cells = (1 ... cellCount).map { index -> BatteryCell in
                let drift = includeOutliers && index % 4 == 0 ? 0.02 : 0.001 * Double(index % 3)
                return BatteryCell(
                    cellID: index,
                    module: (index - 1) / 4 + 1,
                    voltage: 3.95 + drift,
                    temperature: 24 + Double(index % 5)
                )
            }
            return BatteryCellSummary(
                totalCells: cellCount,
                avgVoltage: 3.954,
                minVoltage: 3.949,
                maxVoltage: 3.971,
                voltageSpread: 0.022,
                avgTemperature: 25.6,
                minTemperature: 24.0,
                maxTemperature: 28.0,
                tempSpread: 4.0,
                cells: cells
            )
        }
    }

    #Preview("Loaded · 2×4") {
        BatteryCellsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 2, rows: 4)),
            model: BatteryCellsModel(previewState: .loaded(BatteryCellsPreviewData.summary(), stale: false))
        )
        .frame(width: 240, height: 360)
        .padding()
    }

    #Preview("Loaded · 4-wide + temps") {
        BatteryCellsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 4, rows: 6)),
            model: BatteryCellsModel(previewState: .loaded(BatteryCellsPreviewData.summary(cellCount: 12), stale: true))
        )
        .frame(width: 480, height: 420)
        .padding()
    }

    #Preview("Loading") {
        BatteryCellsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 2, rows: 4)),
            model: BatteryCellsModel(previewState: .idle)
        )
        .frame(width: 240, height: 360)
        .padding()
    }

    #Preview("Empty") {
        BatteryCellsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 2, rows: 4)),
            model: BatteryCellsModel(previewState: .empty(stale: false))
        )
        .frame(width: 240, height: 360)
        .padding()
    }

    #Preview("Offline (cached)") {
        BatteryCellsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 2, rows: 4)),
            model: BatteryCellsModel(
                previewState: .failed(.offline, cached: BatteryCellsPreviewData.summary(), stale: true)
            )
        )
        .frame(width: 240, height: 360)
        .padding()
    }

    #Preview("Error") {
        BatteryCellsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 2, rows: 4)),
            model: BatteryCellsModel(
                previewState: .failed(.network(message: "boom"), cached: nil, stale: false)
            )
        )
        .frame(width: 240, height: 360)
        .padding()
    }
#endif
