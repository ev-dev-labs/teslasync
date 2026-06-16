import SwiftUI

/// Native SwiftUI parity of `web/src/features/battery/pages/EnergyProductsPage.tsx`
/// (route `/energy-products`). Powerwalls, Solar Panels & Wall Connectors discovered from Tesla:
/// the web page chrome (`PageContainer` title + subtitle + the "Refresh from Tesla" action), the
/// four summary StatCards, and a per-site card (header + Charge/Capacity/Type stats + capability
/// badges + the site-configuration subsection with the backup-reserve `RadialGauge`,
/// Powerwalls/Rated-Power/Rated-Energy stats, firmware, component badges, and the rate-plan
/// section). Every data state the sources produce is implemented (loading / empty / error /
/// success), including each card's own site-info empty + loading states.
///
/// Adaptive (ADR-002/006): the header, the summary grid, and the site-card grid reflow for macOS /
/// iPad regular width vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with the
/// web key names; data binds through the `@Observable` `EnergyProductsPageModel` (no networking in
/// the view). SI watt-hours / watts format to display units only here, at the render boundary.
public struct EnergyProductsPage: View {
    @State private var model: EnergyProductsPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: EnergyProductsPageModel) {
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
        .navigationTitle(Text("energy.products.title"))
        .refreshable { await model.refresh() }
        .task {
            guard model.phase == .loading, model.sites.isEmpty else { return }
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

    // MARK: - Header (web PageContainer title + subtitle + refresh action)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    refreshButton
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    refreshButton
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("energy.products.title")
            Text("energy.products.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web header action `<Button onClick={refreshMutation.mutate()}>Refresh from Tesla</Button>`.
    private var refreshButton: some View {
        TSButton(
            isLoading: model.isRefreshing,
            action: { Task { await model.refresh() } },
            label: { Label("energy.products.refresh", systemImage: "arrow.clockwise") }
        )
        .accessibilityLabel(Text("energy.products.refresh"))
    }

    // MARK: - Phase switch (web PageContainer loading / error / body)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            EnergyProductsSkeleton()
        case let .error(message):
            EnergyProductsErrorPanel(message: message) { Task { await model.load() } }
        case .ready:
            readyView
        }
    }

    // MARK: - Ready body (web PageContainer children)

    private var readyView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSFadeIn { EnergyProductsSummarySection(model: model) }
            TSFadeIn(delay: 0.05) { sitesSection }
        }
    }

    @ViewBuilder
    private var sitesSection: some View {
        if model.hasNoSites {
            EnergyProductsEmptyPanel()
        } else {
            sitesGrid
        }
    }

    /// Web `Grid cols={{ default: 1, lg: 2 }}` of site cards, wrapped in the web
    /// `StaggerContainer` / `StaggerItem` cascade.
    private var sitesGrid: some View {
        let columns = [GridItem(.adaptive(minimum: 380), spacing: TSSpacing.lg, alignment: .top)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(Array(model.sites.enumerated()), id: \.element.id) { index, site in
                TSStaggerItem(index: index) {
                    EnergyProductsSiteCard(
                        site: site,
                        infoState: model.siteInfoState(for: site),
                        onRefreshInfo: { Task { await model.refreshSiteInfo(siteID: site.energySiteID) } }
                    )
                }
            }
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        EnergyProductsPage(model: EnergyProductsPageModel())
            .teslaSyncTheme()
    }

    #Preview("No site info") {
        EnergyProductsPage(model: EnergyProductsPageModel(dataSource: EmptySiteInfoEnergyProductsDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        EnergyProductsPage(model: EnergyProductsPageModel(dataSource: EmptyEnergyProductsDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        EnergyProductsPage(model: EnergyProductsPageModel(dataSource: FailingEnergyProductsDataSource()))
            .teslaSyncTheme()
    }
#endif
