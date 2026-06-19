// DBHealthPage — complex multi-panel dashboard matching web parity
import SwiftUI
import Charts

/// Native SwiftUI parity of `web/src/features/system/pages/DBHealthPage.tsx`
/// (route `/db-health`). Reproduces the web page chrome (web `PageContainer`: title +
/// subtitle + auto-refresh indicator), the four summary stat cards (web `StatCard` grid),
/// the bar chart (web `ChartContainer` + horizontal `BarChart`), the tables panel with
/// sort controls (web `GlassPanel` + `DataTable`), and the right sidebar (migration status
/// + connection pool panels).
///
/// Adaptive (ADR-002/006): macOS/iPad regular width renders a 2-column layout (table +
/// sidebar); compact iPhone stacks vertically. All three data sources load concurrently
/// and surface every state (loading / empty / error / success). All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `DBHealthPageModel` (no networking in the view, ADR-004).
///
/// NOTE: File length exceeds 400 lines due to complex multi-panel layout at web parity.
public struct DBHealthPage: View {
    @State internal var model: DBHealthPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: DBHealthPageModel) {
        _model = State(initialValue: model)
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
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

    // MARK: - Header (web PageContainer title + subtitle + auto-refresh indicator)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                TSPageTitle("translation.dbHealth.title")
                Spacer()
                // Web auto-refresh indicator (web RefreshCw icon + "Auto-refresh 30s")
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.clockwise")
                        .font(.caption2)
                        .foregroundStyle(Color.TS.textMuted)
                    Text("translation.dbHealth.autoRefresh")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            Text("translation.dbHealth.subtitle")
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
        case .loading:
            loadingState
        case let .error(message):
            errorPanel(message)
        case .loaded:
            loadedContent
        }
    }

    private var loadingState: some View {
        VStack(spacing: TSSpacing.lg) {
            // Skeleton stat cards
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.lg), count: isCompact ? 2 : 4),
                spacing: TSSpacing.lg
            ) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 120)
                }
            }
            // Skeleton chart
            TSSkeleton(height: 300)
            // Skeleton table
            TSSkeleton(height: 400)
        }
    }

    /// Web generic PageContainer error: a panel-level error with retry.
    private func errorPanel(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        }
    }

    // MARK: - Loaded content (stat cards + chart + table + sidebar)

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            // Summary stat cards (web StatCard grid)
            TSFadeIn(delay: 0.1) {
                statCardsGrid
            }

            // Table size bar chart (web ChartContainer)
            TSFadeIn(delay: 0.2) {
                tableSizeChart
            }

            // Main content: tables panel + sidebar (web grid-cols-1 lg:grid-cols-3)
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    tablesPanel
                    sidebarPanels
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    tablesPanel.frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                    sidebarPanels.frame(width: 320)
                }
            }
        }
    }

    // MARK: - Stat Cards (web StatCard grid, 4 cards)

    private var statCardsGrid: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.lg), count: isCompact ? 2 : 4),
            spacing: TSSpacing.lg
        ) {
            // Panel 1: Total DB Size
            TSStatCard(
                title: "translation.dbHealth.totalSize",
                value: model.databaseSizeDisplay,
                systemImage: "externaldrive.fill"
            )
            .accessibilityIdentifier("total-db-size-card")

            // Panel 2: Tables count
            TSStatCard(
                title: "translation.dbHealth.tables",
                value: "\(model.tables.count)",
                systemImage: "tablecells"
            )
            .accessibilityIdentifier("tables-count-card")

            // Panel 3: Large Tables (>100MB)
            TSStatCard(
                title: "translation.dbHealth.largeTables",
                value: "\(model.largeTableCount)",
                systemImage: "exclamationmark.triangle"
            )
            .accessibilityIdentifier("large-tables-card")

            // Panel 4: Migration Version
            TSStatCard(
                title: "translation.dbHealth.migration",
                value: model.migrationStatus?.currentVersion ?? "—",
                systemImage: "checkmark.circle"
            )
            .accessibilityIdentifier("migration-version-card")
        }
    }

    // MARK: - Table Size Chart (web ChartContainer + horizontal BarChart)

    private var tableSizeChart: some View {
        TSChartContainer(
            "translation.dbHealth.chartTitle",
            isEmpty: model.chartData.isEmpty
        ) {
            Chart {
                ForEach(Array(model.chartData.enumerated()), id: \.offset) { _, item in
                    BarMark(
                        x: .value("translation.dbHealth.col.rows", Double(item.rows)),
                        y: .value("translation.dbHealth.col.table", item.name)
                    )
                    .foregroundStyle(TSChartPalette.color(at: 0))
                    .cornerRadius(4)
                }
            }
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let numValue = value.as(Double.self) {
                            Text(verbatim: TSChartFormat.axisLabel(numValue))
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks { _ in
                    AxisValueLabel()
                }
            }
            .frame(height: 300)
            .accessibilityLabel("translation.dbHealth.chartTitle.aria")
        }
        .accessibilityIdentifier("table-sizes-chart")
    }

    // MARK: - Tables Panel (web GlassPanel + DataTable + sort controls)

    private var tablesPanel: some View {
        TSFadeIn(delay: 0.3) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    // Panel header + sort controls (web title + ArrowUpDown icon + sort buttons)
                    HStack {
                        TSPanelTitle("translation.dbHealth.tablesTitle")
                        Spacer()
                        HStack(spacing: TSSpacing.xs) {
                            Image(systemName: "arrow.up.arrow.down")
                                .font(.caption)
                                .foregroundStyle(Color.TS.textMuted)
                            ForEach(DBHealthSortKey.allCases, id: \.self) { key in
                                Button {
                                    model.sortKey = key
                                } label: {
                                    Text(sortKeyLabel(key))
                                        .font(Font.TS.caption)
                                        .padding(.horizontal, TSSpacing.sm)
                                        .padding(.vertical, 4)
                                        .background(
                                            model.sortKey == key ? Color.TS.accent.opacity(0.2) : Color.clear,
                                            in: RoundedRectangle(cornerRadius: 4)
                                        )
                                        .foregroundStyle(
                                            model.sortKey == key
                                                ? Color.TS.accent
                                                : Color.TS.textSecondary
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // Table or empty state
                    if model.tables.isEmpty {
                        TSEmptyState(
                            title: "translation.dbHealth.noTables.title",
                            message: "translation.dbHealth.noTables",
                            systemImage: "tablecells.badge.ellipsis"
                        )
                        .frame(maxWidth: .infinity, minHeight: 200)
                    } else {
                        DBHealthTable(rows: model.sortedTables)
                    }
                }
            }
        }
        .accessibilityIdentifier("tables-panel")
    }

    private func sortKeyLabel(_ key: DBHealthSortKey) -> LocalizedStringKey {
        switch key {
        case .size:
            return "translation.dbHealth.sort.size"
        case .rows:
            return "translation.dbHealth.sort.rows"
        case .name:
            return "translation.dbHealth.sort.name"
        }
    }

    // MARK: - Sidebar Panels (Migration Status + Connection Pool)

    private var sidebarPanels: some View {
        TSFadeIn(delay: 0.4) {
            VStack(spacing: TSSpacing.lg) {
                migrationStatusPanel
                connectionPoolPanel
            }
        }
    }

}

#if DEBUG
    #Preview("DB Health") {
        DBHealthPage(model: DBHealthPageModel())
            .teslaSyncTheme()
    }
#endif
