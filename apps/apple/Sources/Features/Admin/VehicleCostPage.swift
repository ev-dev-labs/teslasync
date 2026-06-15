import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/VehicleCostPage.tsx`
/// (route `/admin/vehicle-cost`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle + page-level loading / error), the subsystem-unavailable banner
/// (web `subsystemMissing` → `AlertBanner`), the four fleet stat cards (web `StatCard`
/// grid — Total rows / Total bytes / Rate / DLQ failures, each with its sublabel), and the
/// per-vehicle breakdown panel (web `GlassPanel1` + window `Select` + `DataTable` /
/// `EmptyState`). The adaptive table itself lives in `VehicleCostPage.Table.swift`.
///
/// Adaptive (ADR-002/006): macOS/iPad regular width renders a columnar table; compact
/// iPhone renders per-vehicle cards. Every data state the source produces is implemented
/// (loading / empty / error / success, plus the 503 unavailable variant). All copy
/// resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `VehicleCostPageModel` (no networking in the view).
public struct VehicleCostPage: View {
    @State private var model: VehicleCostPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Number of shimmer rows shown while the report loads (web table `Skeleton`).
    private static let skeletonRowCount = 6

    public init(model: VehicleCostPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                stateContent
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loaded = model.state { return }
            await model.load()
        }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("admin.vehicleCost.pageTitle")
            Text("admin.vehicleCost.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - State router (web PageContainer loading/error + body)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case let .error(message):
            errorPanel(message)
        default:
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                if model.isSubsystemUnavailable {
                    subsystemBanner
                }
                if let totals = model.totals {
                    fleetTotalsGrid(totals)
                }
                breakdownPanel
            }
        }
    }

    /// Web generic PageContainer error (non-503): a panel-level error with retry.
    private func errorPanel(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        }
    }

    // MARK: - Subsystem-unavailable banner (web `subsystemMissing` AlertBanner)

    private var subsystemBanner: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "exclamationmark.triangle.fill",
            title: "admin.subsystem.unavailableTitle",
            message: "admin.vehicleCost.notConfigured"
        )
    }

    // MARK: - Fleet stat cards (web `StatCard` grid — Total rows / bytes / rate / DLQ failures)

    private func fleetTotalsGrid(_ totals: VehicleCostTotals) -> some View {
        LazyVGrid(columns: statColumns, spacing: TSSpacing.md) {
            TSMetricCard(
                title: "admin.vehicleCost.totalRows",
                value: VehicleCostFormat.number(totals.totalRows),
                caption: windowSubCaption
            )
            TSMetricCard(
                title: "admin.vehicleCost.totalBytes",
                value: VehicleCostFormat.bytes(totals.totalBytesEst),
                caption: "admin.vehicleCost.bytesSub"
            )
            TSMetricCard(
                title: "admin.vehicleCost.totalRate",
                value: VehicleCostFormat.number(totals.totalRatePerMinute24h, decimals: 1),
                caption: "admin.vehicleCost.rateSub"
            )
            TSMetricCard(
                title: "admin.vehicleCost.totalFailures",
                value: VehicleCostFormat.number(totals.totalFailures24h),
                caption: "admin.vehicleCost.failuresSub"
            )
        }
    }

    private var statColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]
    }

    /// Web "Total rows" sublabel `Window: {{days}}d`, rendered verbatim through the catalog.
    private var windowSubCaption: LocalizedStringKey {
        "\(Self.windowSubText(model.window.days))"
    }

    // MARK: - Per-vehicle breakdown panel (web `GlassPanel1` — PanelTitle + window Select + DataTable / EmptyState)

    private var breakdownPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                panelHeader
                breakdownContent
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.vehicleCost.tableTitle"))
    }

    /// Web panel header: the title with the window `Select`, side by side on regular width
    /// and stacked on compact width (web `flex-wrap items-end justify-between`).
    @ViewBuilder
    private var panelHeader: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("admin.vehicleCost.tableTitle")
                windowControl
            }
        } else {
            HStack(alignment: .firstTextBaseline) {
                TSPanelTitle("admin.vehicleCost.tableTitle")
                Spacer(minLength: TSSpacing.lg)
                windowControl
            }
        }
    }

    /// The window `Select` with its leading "Window" caption (web `<label>` wrapping
    /// `Caption` + `Select`). Reloads on change (web `setWindowDays` → new `since` query).
    private var windowControl: some View {
        @Bindable var model = model
        return HStack(spacing: TSSpacing.sm) {
            TSCaption("admin.vehicleCost.windowLabel")
            Picker(selection: $model.window) {
                ForEach(VehicleCostWindow.allCases) { option in
                    Text(option.labelKey).tag(option)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text("admin.vehicleCost.windowLabel"))
            .onChange(of: model.window) { _, _ in
                Task { await model.reload() }
            }
        }
    }

    @ViewBuilder
    private var breakdownContent: some View {
        switch model.state {
        case .loading:
            skeletonRows
        case .empty:
            TSEmptyState(
                title: "admin.vehicleCost.emptyTitle",
                message: "admin.vehicleCost.emptyMessage",
                systemImage: "creditcard"
            )
            .frame(maxWidth: .infinity)
        case .unavailable:
            emptyTableNote
        case let .loaded(report):
            VehicleCostTable(rows: report.vehicles)
        case .error:
            EmptyView()
        }
    }

    private var skeletonRows: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< Self.skeletonRowCount, id: \.self) { _ in
                TSSkeleton(height: 44, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityLabel(Text("admin.vehicleCost.tableTitle"))
    }

    /// Web `DataTable` empty message (shown in the 503 unavailable branch, where the web
    /// still renders the table with an empty dataset rather than the `EmptyState`).
    private var emptyTableNote: some View {
        Text("admin.vehicleCost.emptyTable")
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.lg)
    }

    // MARK: - Interpolated stat-card strings (web i18next `{{token}}` → catalog `%lld`)

    /// Resolves `admin.vehicleCost.windowSub` ("Window: %lldd") with the window length.
    static func windowSubText(_ days: Int) -> String {
        String(format: String(localized: "admin.vehicleCost.windowSub"), days)
    }
}

#if DEBUG
    #Preview("Loaded") {
        VehicleCostPage(model: VehicleCostPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        VehicleCostPage(model: VehicleCostPageModel(dataSource: PreviewEmptyVehicleCost()))
            .teslaSyncTheme()
    }

    #Preview("Unavailable") {
        VehicleCostPage(model: VehicleCostPageModel(dataSource: PreviewUnavailableVehicleCost()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        VehicleCostPage(model: VehicleCostPageModel(dataSource: PreviewFailingVehicleCost()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero vehicles but non-zero totals (drives the empty state
    /// while still showing the fleet stat cards, as the web does).
    private struct PreviewEmptyVehicleCost: VehicleCostDataSource {
        func load(window _: VehicleCostWindow) async throws -> VehicleCostReport {
            VehicleCostReport(
                vehicles: [],
                totals: VehicleCostTotals(
                    totalRows: 0,
                    totalBytesEst: 0,
                    totalRatePerMinute24h: 0,
                    totalFailures24h: 0
                )
            )
        }
    }

    /// Preview seam that reports the subsystem missing (drives the 503 banner).
    private struct PreviewUnavailableVehicleCost: VehicleCostDataSource {
        func load(window _: VehicleCostWindow) async throws -> VehicleCostReport {
            throw VehicleCostSubsystemUnavailable()
        }
    }

    /// Preview seam that fails generically (drives the error state).
    private struct PreviewFailingVehicleCost: VehicleCostDataSource {
        struct Failure: Error {}
        func load(window _: VehicleCostWindow) async throws -> VehicleCostReport {
            throw Failure()
        }
    }
#endif
