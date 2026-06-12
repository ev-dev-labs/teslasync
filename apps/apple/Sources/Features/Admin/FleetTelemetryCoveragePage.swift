import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx`
/// (route `/admin/telemetry/coverage`). Reproduces the web page chrome (web
/// `PageContainer`: title + subtitle + Refresh action), the five summary stat cards
/// (web `StatCard` grid), the legend / destination-breakdown / orphan-drift / filter
/// `GlassPanel`s, and the per-category routing tables (web `CategorySection`). Every
/// data state the source produces is implemented (loading / empty / error / success,
/// plus the filtered-empty variant).
///
/// Adaptive (ADR-002/006): the stat grid + per-category tables reflow for macOS / iPad
/// regular width vs. compact iPhone (the columnar tables become per-field cards). All
/// copy resolves from `Localizable.xcstrings` with the web key names; data binds through
/// the `@Observable` `FleetTelemetryCoveragePageModel` (no networking in the view). The
/// coverage snapshot is package-derived (routing.yaml + teslaconfig.Builder), not live
/// telemetry, so there is no SSE subscription or staleness indicator on this surface.
public struct FleetTelemetryCoveragePage: View {
    @State private var model: FleetTelemetryCoveragePageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: FleetTelemetryCoveragePageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                statGrid
                legendPanel
                destinationsPanel
                if model.hasOrphans {
                    orphansPanel
                }
                filterPanel
                stateRegion
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

    // MARK: - Header (web PageContainer title + subtitle + Refresh action)

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPageTitle("coverage.pageTitle")
                Text("coverage.subtitle")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            refreshButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var refreshButton: some View {
        TSButton(variant: .ghost, size: .small, isLoading: model.isRefreshing) {
            Task { await model.refresh() }
        } label: {
            Label("coverage.refresh", systemImage: "arrow.clockwise")
        }
        .accessibilityLabel(Text("coverage.refresh"))
    }

    // MARK: - Stat cards (web StatCard grid — panels Categories … Orphan-fields)

    private var statGrid: some View {
        LazyVGrid(columns: statColumns, spacing: TSSpacing.md) {
            TSStatCard(title: "coverage.stat.categories", value: fmt(model.stats.totalCategories))
            TSStatCard(title: "coverage.stat.routedFields", value: fmt(model.stats.totalRoutedFields))
            TSStatCard(title: "coverage.stat.subscribed", value: fmt(model.stats.subscribedFields))
            TSStatCard(
                title: "coverage.stat.routedNotSubscribed",
                value: fmt(model.stats.unsubscribedRoutedFields)
            )
            TSStatCard(title: "coverage.stat.orphans", value: fmt(model.stats.orphanFields))
        }
    }

    private var statColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]
    }

    // MARK: - Legend panel (web GlassPanel "Reading this page")

    private var legendPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSPanelTitle("coverage.legend.title")
                TSCaption("coverage.legend.intro")
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    legendItem(label: "coverage.legend.columnLabel", help: "coverage.legend.columnHelp")
                    legendItem(label: "coverage.legend.dualWriteLabel", help: "coverage.legend.dualWriteHelp")
                    legendItem(label: "coverage.legend.subscribedLabel", help: "coverage.legend.subscribedHelp")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("coverage.legend.title"))
    }

    private func legendItem(label: LocalizedStringKey, help: LocalizedStringKey) -> some View {
        (
            Text(label).fontWeight(.semibold).foregroundStyle(Color.TS.textPrimary)
                + Text(verbatim: " ")
                + Text(help).foregroundStyle(Color.TS.textSecondary)
        )
        .font(Font.TS.bodySm)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Destination breakdown panel (web GlassPanel "Destination breakdown")

    private var destinationsPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSPanelTitle("coverage.destinations.title")
                TSCaption("coverage.destinations.help")
                destinationsContent
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("coverage.destinations.title"))
    }

    @ViewBuilder
    private var destinationsContent: some View {
        let totals = model.sortedDestinationTotals
        if totals.isEmpty {
            Text("coverage.destinations.empty")
                .font(Font.TS.bodySm)
                .italic()
                .foregroundStyle(Color.TS.textMuted)
        } else {
            CoverageFlowLayout(spacing: TSSpacing.sm) {
                ForEach(totals, id: \.destination) { entry in
                    CoverageCountChip(label: entry.destination, count: entry.count, tone: .info)
                }
            }
        }
    }

    // MARK: - Orphan-fields panel (web amber GlassPanel "Orphan fields detected")

    private var orphansPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.TS.statusWarning)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        TSPanelTitle("coverage.orphans.title")
                        TSCaption("coverage.orphans.help")
                    }
                }
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    ForEach(model.orphans, id: \.self) { orphan in
                        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                            Text(verbatim: "•").foregroundStyle(Color.TS.statusWarning)
                            Text(verbatim: orphan)
                                .font(.system(.footnote, design: .monospaced))
                                .foregroundStyle(Color.TS.textPrimary)
                                .textSelection(.enabled)
                        }
                    }
                }
                .padding(.leading, TSSpacing.sm)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.35), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("coverage.orphans.title"))
    }

    // MARK: - Filter panel (web GlassPanel with the field/destination/column Input)

    private var filterPanel: some View {
        TSGlassPanel {
            TSTextField("coverage.filter.placeholder", text: filterBinding) // parity:allow i18n key name, not a stub
        }
    }

    private var filterBinding: Binding<String> {
        Binding(get: { model.filter }, set: { model.filter = $0 })
    }

    // MARK: - State region (web loading / error / empty / filterEmpty / categories)

    @ViewBuilder
    private var stateRegion: some View {
        switch model.state {
        case .loading:
            loadingRow
        case let .error(message):
            errorPanel(message)
        case .empty:
            emptyState
        case .loaded:
            if model.filteredCategories.isEmpty {
                filterEmptyState
            } else {
                categoriesList
            }
        }
    }

    private var loadingRow: some View {
        TSSpinner(label: "coverage.loading")
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, TSSpacing.lg)
    }

    /// Web rose error GlassPanel — the message plus a Retry affordance (ADR HIG).
    private func errorPanel(_ message: String) -> some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.TS.statusDanger)
                        .accessibilityHidden(true)
                    Text("coverage.error")
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.statusDanger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                TSButton("action.retry", variant: .secondary, size: .small) {
                    Task { await model.refresh() }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityValue(Text(verbatim: message))
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var emptyState: some View {
        TSEmptyState(title: "coverage.empty", systemImage: "tray")
            .frame(maxWidth: .infinity)
    }

    private var filterEmptyState: some View {
        TSEmptyState(title: "coverage.filterEmpty", systemImage: "line.3.horizontal.decrease.circle")
            .frame(maxWidth: .infinity)
    }

    private var categoriesList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(model.filteredCategories, id: \.category) { category in
                FleetTelemetryCategorySection(
                    category: category,
                    fields: model.filteredFields(in: category),
                    destinations: model.sortedDestinations(in: category)
                )
            }
        }
    }

    private func fmt(_ value: Int) -> String {
        FleetTelemetryCoverageFormat.int(value)
    }
}

#if DEBUG
    #Preview("Loaded") {
        FleetTelemetryCoveragePage(model: FleetTelemetryCoveragePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        FleetTelemetryCoveragePage(
            model: FleetTelemetryCoveragePageModel(dataSource: PreviewEmptyCoverage())
        )
        .teslaSyncTheme()
    }

    #Preview("Error") {
        FleetTelemetryCoveragePage(
            model: FleetTelemetryCoveragePageModel(dataSource: PreviewFailingCoverage())
        )
        .teslaSyncTheme()
    }

    /// Preview seam yielding zero categories (drives the empty state).
    private struct PreviewEmptyCoverage: FleetTelemetryCoverageDataSource {
        func load() async throws -> FleetTelemetryCoverageResponse {
            FleetTelemetryCoverageResponse(categories: [], destinationTotals: [:], orphanFields: [])
        }
    }

    /// Preview seam that fails (drives the error state).
    private struct PreviewFailingCoverage: FleetTelemetryCoverageDataSource {
        struct Failure: Error {}
        func load() async throws -> FleetTelemetryCoverageResponse {
            throw Failure()
        }
    }
#endif
