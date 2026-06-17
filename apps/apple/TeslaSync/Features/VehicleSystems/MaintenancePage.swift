import SwiftUI

/// Native SwiftUI parity of `web/src/features/vehicle-systems/pages/MaintenancePage.tsx` (route
/// `/maintenance`). The vehicle maintenance tracker: the web `PageContainer` chrome (title + subtitle
/// + the global `VehicleSelect`), the four summary `MetricCard`s, the category-filter / sort / Schedule
/// toolbar, the maintenance-items grid, the Estimated-Annual-Cost + Service-Projections panels, and the
/// Service-Records table. Every data state the source produces is implemented (loading / empty / error /
/// success), including each panel's own empty state and the web `anyError` non-fatal banner.
///
/// Adaptive (ADR-002/006): the summary grid, items grid, and the cost/projections row reflow for macOS
/// / iPad regular width vs. compact iPhone, and the records table becomes a card list on compact width.
/// All copy resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `MaintenancePageModel` (no networking in the view). The opt-in AI Predictive-Maintenance
/// card the web renders has its own parity unit and is out of this page's manifest scope.
public struct MaintenancePage: View {
    @State private var model: MaintenancePageModel
    private let onSchedule: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: MaintenancePageModel, onSchedule: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onSchedule = onSchedule
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
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.items.isEmpty else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + vehicle VehicleSelect)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    if !model.vehicles.isEmpty { vehiclePicker }
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    if !model.vehicles.isEmpty { vehiclePicker.frame(maxWidth: 260) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("Maintenance")
            Text("Service schedule, records, and upcoming maintenance")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header `VehicleSelect` (shown only when `vehicles.length > 0`).
    private var vehiclePicker: some View {
        TSSelect(
            selection: vehicleBinding,
            options: model.vehicles.map { TSSelectOption($0.id, LocalizedStringKey($0.name)) }
        )
        .accessibilityLabel(Text("route.vehicles"))
    }

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID ?? 0 },
            set: { newValue in Task { await model.selectVehicle(newValue) } }
        )
    }

    // MARK: - Top-level phase switch (web PageContainer phases)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            MaintenanceSkeleton()
        case .empty:
            emptyView
        case let .error(message):
            errorView(message)
        case .ready:
            readyView
        }
    }

    /// Web items-grid no-data EmptyState (no recovery action — transient source gap).
    private var emptyView: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "No maintenance items",
                message: "No maintenance items found for this vehicle.",
                systemImage: "wrench.and.screwdriver"
            )
            .frame(maxWidth: .infinity)
        }
    }

    /// Web primary-source error — message plus a Retry affordance (web `PageContainer` error region).
    private func errorView(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: "error.loadFailed",
                message: LocalizedStringKey(message),
                onRetry: { Task { await model.refresh() } }
            )
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready (web main PageContainer body)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            // Web `anyError` AlertBanner — a non-fatal service-records load failure surfaced above
            // content that still renders.
            if model.hasSecondaryError {
                TSAlertBanner(
                    tone: .danger,
                    systemImage: "exclamationmark.triangle.fill",
                    title: "error.loadFailed"
                )
            }
            MaintenanceSummarySection(summary: model.summary)
            MaintenanceToolbar(
                categoryFilter: $model.categoryFilter,
                sortKey: $model.sortKey,
                categories: model.categories,
                onSchedule: onSchedule
            )
            MaintenanceItemsSection(
                items: model.filteredItems,
                isCategoryFiltered: model.categoryFilter != MaintenancePageModel.allCategories
            )
            MaintenanceCostRow(
                costStats: model.costStats,
                projections: model.projections,
                currencySymbol: model.currencySymbol
            )
            MaintenanceRecordsSection(records: model.records, currencySymbol: model.currencySymbol)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        MaintenancePage(model: MaintenancePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        MaintenancePage(model: MaintenancePageModel(dataSource: EmptyMaintenanceDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        MaintenancePage(model: MaintenancePageModel(dataSource: FailingMaintenanceDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Partial error") {
        MaintenancePage(model: MaintenancePageModel(dataSource: SecondaryFailingMaintenanceDataSource()))
            .teslaSyncTheme()
    }
#endif
