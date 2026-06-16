import SwiftUI

/// Native SwiftUI parity of `web/src/features/explore/pages/ExplorePage.tsx` (route `/explore`).
/// The Feature Hub: a "front door" to every destination in the app. It re-uses the canonical
/// `AppRoute` catalog (the native equivalent of the web sidebar `navSections`), decorates each entry,
/// and renders a recently-visited strip, a sticky search panel (`GlassPanel1`), per-section anchor
/// chips, a categorized, filterable card grid, and a "did you mean" empty state (`GlassPanel2`).
///
/// Every data state the source produces is implemented: loading (redacted skeleton), the retryable
/// error region, the no-match empty state, and the populated success grid. Adaptive (ADR-002/006):
/// the card grid reflows for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; gating + filtering bind through the `@Observable`
/// `ExplorePageModel` (no networking in the view).
public struct ExplorePage: View {
    @State private var model: ExplorePageModel
    private let onNavigate: (AppRoute) -> Void

    public init(model: ExplorePageModel, onNavigate: @escaping (AppRoute) -> Void) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                content(proxy: proxy)
            }
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("explore.pageTitle"))
        .refreshable { await model.refresh() }
        .task {
            if case .loading = model.loadState { await model.load() }
        }
    }

    // MARK: - Phase switch (web PageContainer phases)

    @ViewBuilder
    private func content(proxy: ScrollViewProxy) -> some View {
        switch model.phase {
        case .loading:
            ExploreSkeleton()
        case let .error(message):
            errorView(message)
        case .ready:
            readyView(proxy: proxy)
        }
    }

    /// Web `PageContainer error` region — a retryable failure surface (the native equivalent of the
    /// web hooks degrading to empties on a total gating-load failure).
    private func errorView(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            titleBlock
            TSGlassPanel {
                TSErrorDisplay(
                    message: LocalizedStringKey(message),
                    onRetry: { Task { await model.refresh() } }
                )
            }
        }
        .padding(TSSpacing.lg)
    }

    // MARK: - Ready (web main body: recent strip + sticky search + bands / empty)

    private func readyView(proxy: ScrollViewProxy) -> some View {
        LazyVStack(alignment: .leading, spacing: TSSpacing.x2xl, pinnedViews: [.sectionHeaders]) {
            titleBlock
            if model.showsRecent {
                ExploreRecentStrip(entries: model.recentEntries, onNavigate: onNavigate)
            }
            Section {
                catalog
            } header: {
                searchHeader(proxy: proxy)
            }
        }
        .padding(TSSpacing.lg)
    }

    @ViewBuilder
    private var catalog: some View {
        if model.isEmptyResult {
            ExploreEmptyResult(
                query: model.query,
                suggestions: model.suggestions,
                onPick: { route in
                    model.clearQuery()
                    onNavigate(route)
                },
                onClear: { model.clearQuery() }
            )
            .padding(.top, TSSpacing.md)
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                ForEach(model.grouped) { section in
                    ExploreSectionBand(section: section, onNavigate: onNavigate)
                }
            }
            .padding(.top, TSSpacing.md)
        }
    }

    /// The sticky search panel header (web `sticky top-0` panel), with an opaque backdrop so the
    /// scrolling catalog never bleeds through while pinned.
    private func searchHeader(proxy: ScrollViewProxy) -> some View {
        ExploreSearchPanel(
            query: queryBinding,
            sections: model.grouped,
            onJump: { anchorID in
                withAnimation { proxy.scrollTo(anchorID, anchor: .top) }
            }
        )
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.bg)
    }

    // MARK: - Title block (web PageContainer title + subtitle)

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("explore.title")
            Text(verbatim: subtitle)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web subtitle: the filtered match count while searching, else the full catalog size.
    private var subtitle: String {
        if model.hasQuery {
            return String(
                format: String(localized: "explore.subtitle.filtered"),
                model.matchCount, model.totalFeatures, model.query
            )
        }
        return String(format: String(localized: "explore.subtitle.all"), model.totalFeatures)
    }

    private var queryBinding: Binding<String> {
        Binding(get: { model.query }, set: { model.setQuery($0) })
    }
}

// MARK: - Loading skeleton (web PageContainer loading)

/// Redacted loading scaffold (web skeleton): a header, a search bar, and a few section grids so the
/// hub's shape is visible while the gating inputs load.
private struct ExploreSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSPageHeaderSkeleton()
            TSSkeleton(width: nil, height: 44, cornerRadius: TSRadius.md)
            ForEach(0 ..< 3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSSkeleton(width: 160, height: 14)
                    TSStatGridSkeleton(count: 4)
                }
            }
        }
        .padding(TSSpacing.lg)
        .accessibilityLabel(Text("explore.title"))
    }
}

#if DEBUG
    #Preview("Loaded") {
        NavigationStack {
            ExplorePage(model: ExplorePageModel(), onNavigate: { _ in })
        }
        .teslaSyncTheme()
    }

    #Preview("Empty (gated)") {
        NavigationStack {
            ExplorePage(model: ExplorePageModel(dataSource: EmptyExploreDataSource()), onNavigate: { _ in })
        }
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            ExplorePage(model: ExplorePageModel(dataSource: FailingExploreDataSource()), onNavigate: { _ in })
        }
        .teslaSyncTheme()
    }
#endif
