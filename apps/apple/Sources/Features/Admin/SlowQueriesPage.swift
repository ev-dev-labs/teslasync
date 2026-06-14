import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/SlowQueriesPage.tsx`
/// (route `/admin/slow-queries`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle + page-level loading / error), the subsystem-unavailable banner
/// (web `subsystemMissing` → `AlertBanner`), and the single web `GlassPanel` (GlassPanel1)
/// holding the order-by + limit controls and the top-queries table / empty states. The
/// adaptive table itself lives in `SlowQueriesPage.Table.swift`.
///
/// Adaptive (ADR-002/006): macOS/iPad regular width renders a columnar table; compact
/// iPhone renders per-query cards. Every data state the source produces is implemented
/// (loading / empty / error / success, plus the 503 unavailable variant). All copy
/// resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `SlowQueriesPageModel` (no networking in the view).
public struct SlowQueriesPage: View {
    @State private var model: SlowQueriesPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Number of shimmer rows shown while the report loads (web table `Skeleton`).
    private static let skeletonRowCount = 8

    public init(model: SlowQueriesPageModel) {
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
            TSPageTitle("admin.slowQueries.pageTitle")
            Text("admin.slowQueries.subtitle")
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
                queriesPanel
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
            message: "admin.slowQueries.notConfigured"
        )
    }

    // MARK: - Top-queries panel (web `GlassPanel` — PanelTitle + controls + DataTable / EmptyState)

    private var queriesPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                panelHeader
                queriesContent
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.slowQueries.tableTitle"))
    }

    /// Web panel header: the title with the order-by + limit selects, laid out side by
    /// side on regular width and stacked on compact width (web `flex-wrap`).
    @ViewBuilder
    private var panelHeader: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("admin.slowQueries.tableTitle")
                controls
            }
        } else {
            HStack(alignment: .firstTextBaseline) {
                TSPanelTitle("admin.slowQueries.tableTitle")
                Spacer(minLength: TSSpacing.lg)
                controls
            }
        }
    }

    /// The two labelled selects (web `Order by` + `Limit` `Select`s).
    private var controls: some View {
        @Bindable var model = model
        return HStack(spacing: TSSpacing.lg) {
            labeledPicker(label: "admin.slowQueries.orderBy") {
                Picker(selection: $model.orderBy) {
                    ForEach(SlowQueryOrderBy.allCases, id: \.self) { option in
                        Text(Self.orderLabel(option)).tag(option)
                    }
                } label: {
                    EmptyView()
                }
                .pickerStyle(.menu)
                .tint(Color.TS.accent)
                .accessibilityLabel(Text("admin.slowQueries.orderBy"))
                .onChange(of: model.orderBy) { _, _ in
                    Task { await model.reload() }
                }
            }
            labeledPicker(label: "admin.slowQueries.limit") {
                Picker(selection: $model.limit) {
                    ForEach(SlowQueriesPageModel.limitOptions, id: \.self) { option in
                        Text(verbatim: String(option)).tag(option)
                    }
                } label: {
                    EmptyView()
                }
                .pickerStyle(.menu)
                .tint(Color.TS.accent)
                .accessibilityLabel(Text("admin.slowQueries.limit"))
                .onChange(of: model.limit) { _, _ in
                    Task { await model.reload() }
                }
            }
        }
    }

    private func labeledPicker(label: LocalizedStringKey, @ViewBuilder picker: () -> some View) -> some View {
        HStack(spacing: TSSpacing.sm) {
            TSCaption(label)
            picker()
        }
    }

    @ViewBuilder
    private var queriesContent: some View {
        switch model.state {
        case .loading:
            skeletonRows
        case .empty:
            TSEmptyState(
                title: "admin.slowQueries.emptyTitle",
                message: "admin.slowQueries.emptyMessage",
                systemImage: "timer"
            )
            .frame(maxWidth: .infinity)
        case .unavailable:
            emptyTableNote
        case let .loaded(rows):
            SlowQueriesTable(rows: rows)
        case .error:
            EmptyView()
        }
    }

    private var skeletonRows: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< Self.skeletonRowCount, id: \.self) { _ in
                TSSkeleton(height: 40, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityLabel(Text("admin.slowQueries.tableTitle"))
    }

    /// Web `DataTable` empty message (shown in the 503 unavailable branch, alongside the
    /// banner — the web else-branch renders the empty `DataTable` whose `emptyMessage` is
    /// `admin.slowQueries.emptyTable`).
    private var emptyTableNote: some View {
        Text("admin.slowQueries.emptyTable")
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.lg)
    }

    // MARK: - Order-by labels (web `ORDER_BY_OPTIONS` labelKey → catalog)

    /// Web `ORDER_BY_OPTIONS` label keys (Mean time / Total time / Calls / Max time).
    static func orderLabel(_ option: SlowQueryOrderBy) -> LocalizedStringKey {
        switch option {
        case .meanTime: "admin.slowQueries.orderMean"
        case .totalTime: "admin.slowQueries.orderTotal"
        case .calls: "admin.slowQueries.orderCalls"
        case .maxTime: "admin.slowQueries.orderMax"
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        SlowQueriesPage(model: SlowQueriesPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        SlowQueriesPage(model: SlowQueriesPageModel(dataSource: PreviewEmptySlowQueries()))
            .teslaSyncTheme()
    }

    #Preview("Unavailable") {
        SlowQueriesPage(model: SlowQueriesPageModel(dataSource: PreviewUnavailableSlowQueries()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        SlowQueriesPage(model: SlowQueriesPageModel(dataSource: PreviewFailingSlowQueries()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero rows (drives the empty state).
    private struct PreviewEmptySlowQueries: SlowQueriesDataSource {
        func load(orderBy: SlowQueryOrderBy, limit _: Int) async throws -> SlowQueriesResult {
            SlowQueriesResult(orderBy: orderBy, rows: [])
        }
    }

    /// Preview seam that reports the subsystem missing (drives the 503 banner).
    private struct PreviewUnavailableSlowQueries: SlowQueriesDataSource {
        func load(orderBy _: SlowQueryOrderBy, limit _: Int) async throws -> SlowQueriesResult {
            throw SlowQueriesSubsystemUnavailable()
        }
    }

    /// Preview seam that fails generically (drives the error state).
    private struct PreviewFailingSlowQueries: SlowQueriesDataSource {
        struct Failure: Error {}
        func load(orderBy _: SlowQueryOrderBy, limit _: Int) async throws -> SlowQueriesResult {
            throw Failure()
        }
    }
#endif
