import SwiftUI

/// Native SwiftUI parity of `web/src/features/vehicles/pages/VehicleListPage.tsx` (route `/vehicles`).
/// The "Fleet" page lists every vehicle and reproduces every region of the web page, binding through
/// the `@Observable` `VehicleListPageModel` (ADR-004 — no networking in the view):
///   • GlassPanel1 — the retryable load-error panel (web `error` branch → `VehicleListErrorPanel`).
///   • GlassPanel2 / GlassPanel3 — the sync success / error banners (`VehicleListSyncBanner`).
///   • Total-Vehicles / Avg-Battery / Total-Range / Charging-Online — four summary `MetricCard`s
///     (`VehicleFleetSummaryGrid`).
///   • GlassPanel8 — the "Fleet Battery Status" panel (`FleetBatteryPanel`; `common.noData` empty).
///   • GlassPanel9 — the per-vehicle card (`VehicleListRow`: status, battery, range, odometer, charge
///     power, lock/sentry, pin / open / delete).
///
/// Adaptive across macOS / iPad (regular) and iPhone (compact) via the P2 tokens + P3 components: the
/// stat grid reflows 1→2→4 columns, the panels take full width, the page scrolls, and each vehicle
/// card stacks its metrics on narrow widths. Every value formats at the render boundary through
/// `Units` / `VehicleListFormat` (SI in, display out — ADR-005); every literal resolves from
/// `Localizable.xcstrings` with the web key names.
public struct VehicleListPage: View {
    @State private var model: VehicleListPageModel
    @Environment(\.tsUnits) private var units

    let onOpenVehicle: (Int64) -> Void
    let onCompare: (Int64, Int64) -> Void

    public init(
        model: VehicleListPageModel,
        onOpenVehicle: @escaping (Int64) -> Void = { _ in },
        onCompare: @escaping (Int64, Int64) -> Void = { _, _ in }
    ) {
        _model = State(initialValue: model)
        self.onOpenVehicle = onOpenVehicle
        self.onCompare = onCompare
    }

    public init(
        dataSource: any VehicleListDataSource = SampleVehicleListDataSource(),
        onOpenVehicle: @escaping (Int64) -> Void = { _ in },
        onCompare: @escaping (Int64, Int64) -> Void = { _, _ in }
    ) {
        _model = State(initialValue: VehicleListPageModel(dataSource: dataSource))
        self.onOpenVehicle = onOpenVehicle
        self.onCompare = onCompare
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text(VehicleListStrings.title))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
        #endif
            .refreshable { await model.refresh() }
            .task {
                guard case .loading = model.state else { return }
                await model.load()
            }
            .overlay(alignment: .top) { toast }
            .confirmationDialog(
                Text(VehicleListStrings.removeTitle),
                isPresented: deleteDialogBinding,
                titleVisibility: .visible,
                presenting: model.deleteTarget,
                actions: deleteActions,
                message: deleteMessage
            )
    }

    // MARK: Header (web `PageContainer` subtitle + actions)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(VehicleListStrings.subtitle)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            actions
        }
    }

    /// Web header actions: Compare (≥ 2 vehicles) + Sync from Tesla.
    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            if model.canCompare {
                TSButton(variant: .secondary, size: .small, action: triggerCompare) {
                    Label(VehicleListStrings.compareButton, systemImage: "arrow.left.arrow.right")
                }
            }
            TSButton(variant: .primary, size: .small, isLoading: model.isSyncing, action: triggerSync) {
                Label(VehicleListStrings.syncButton, systemImage: "arrow.triangle.2.circlepath")
            }
        }
    }

    private func triggerCompare() {
        guard let ids = model.compareIDs else { return }
        onCompare(ids.0, ids.1)
    }

    private func triggerSync() {
        Task { await model.sync() }
    }

    // MARK: Top-level state switch (web `isLoading ? skeleton : error ? … : body`)

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            VehicleListSkeleton()
        case let .error(message):
            VehicleListErrorPanel(message: message) { Task { await model.refresh() } }
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                VehicleListSyncBanner(feedback: model.syncFeedback)
                VehicleListEmptyView(isSyncing: model.isSyncing, onSync: triggerSync)
            }
        case .success:
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                VehicleListSyncBanner(feedback: model.syncFeedback)
                successBody
            }
        }
    }

    // MARK: Success body (web populated `PageContainer`)

    @ViewBuilder
    private var successBody: some View {
        TSFadeIn(delay: 0.05) { VehicleFleetSummaryGrid(model: model, units: units) }
        TSFadeIn(delay: 0.10) { FleetBatteryPanel(model: model, units: units) }
        TSFadeIn(delay: 0.15) { allVehiclesHeader }
        VehicleListCardList(model: model, units: units, onOpenVehicle: onOpenVehicle)
    }

    /// Web "All Vehicles" heading (Car glyph + label).
    private var allVehiclesHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "car.2.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesPower)
                .accessibilityHidden(true)
            TSPanelTitle(VehicleListStrings.allVehicles)
        }
    }

    // MARK: Toast + delete dialog (web `toast.*` + `ConfirmDialog`)

    @ViewBuilder
    private var toast: some View {
        if let toast = model.toast {
            VehicleListToastView(toast: toast) { model.dismissToast() }
        }
    }

    @ViewBuilder
    private func deleteActions(_ target: VehicleListItem) -> some View {
        Button(role: .destructive) { Task { await model.confirmDelete() } } label: {
            Text(VehicleListStrings.commonDelete)
        }
        Button(role: .cancel) { model.cancelDelete() } label: {
            Text("common.cancel")
        }
    }

    private func deleteMessage(_ target: VehicleListItem) -> some View {
        Text(verbatim: VehicleListStrings.removeMessage(name: target.title))
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(
            get: { model.deleteTarget != nil },
            set: { presented in if !presented { model.cancelDelete() } }
        )
    }
}
