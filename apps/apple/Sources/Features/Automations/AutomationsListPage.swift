import SwiftUI

/// Native SwiftUI parity of `web/src/features/automations/pages/AutomationsListPage.tsx`
/// (route `/automations`) — the automations hub. Reproduces the web `PageContainer` chrome
/// (title + subtitle + the Import / Create header actions), the four stat tiles (Total / Active
/// / Disabled / Auto-Disabled), the filters panel, the auto-disabled warning banner, the
/// collapsible preset gallery, the automation card list (with its no-data + no-match empty
/// states), and the embedded execution activity feed. Every web data state is implemented
/// (loading / empty / success, plus a retryable error region so no region renders blank).
///
/// Adaptive (ADR-002/006): the stat grid, the filters row, the preset gallery, and the feed
/// header reflow for macOS / iPad regular width vs. compact iPhone. All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `AutomationsListPageModel` (no networking in the view, ADR-004).
public struct AutomationsListPage: View {
    @State private var model: AutomationsListPageModel
    @State private var importing = false
    private let onCreate: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: AutomationsListPageModel, onCreate: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onCreate = onCreate
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
            guard case .loading = model.phase, model.items.isEmpty else { return }
            await model.load()
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            handleImport(result)
        }
        .alert("automations.import", isPresented: importErrorBinding) {
            Button("common.ok", role: .cancel) { model.clearImportError() }
        } message: {
            Text(verbatim: model.importAlertMessage)
        }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle + actions)

    private var header: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    titleBlock
                    actions
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    titleBlock
                    Spacer(minLength: TSSpacing.md)
                    actions
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("automations.title")
            Text("automations.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .ghost, size: .small, action: { importing = true }, label: {
                Label("automations.import", systemImage: "square.and.arrow.up")
            })
            TSButton(variant: .primary, size: .small, action: onCreate, label: {
                Label("automations.create", systemImage: "plus")
            })
        }
    }

    // MARK: - Phase switch (web loading / content / error)

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            AutomationsListSkeleton()
        case .error:
            errorView
        case .ready:
            readyBody
        }
    }

    private var errorView: some View {
        TSGlassPanel {
            TSQueryError { Task { await model.refresh() } }
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
    }

    // MARK: - Ready body (web PageContainer children)

    private var readyBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            AutomationsListStatsSection(stats: model.stats, isCompact: isCompact)
            AutomationsListFiltersPanel(
                statusFilter: statusFilterBinding,
                search: searchBinding,
                showsCount: model.showsFilterCount,
                countText: model.filterCountText,
                isCompact: isCompact
            )
            if model.stats.hasAutoDisabled {
                AutomationsListWarningBanner(count: model.stats.autoDisabled)
            }
            AutomationsListPresetsPanel(isCompact: isCompact) { _ in onCreate() }
            AutomationsListCardsSection(model: model)
            AutomationsListActivitySection(model: model, isCompact: isCompact)
        }
    }

    // MARK: - Bindings + import

    private var statusFilterBinding: Binding<AutomationStatusFilter> {
        Binding(get: { model.statusFilter }, set: { model.setStatusFilter($0) })
    }

    private var searchBinding: Binding<String> {
        Binding(get: { model.search }, set: { model.setSearch($0) })
    }

    private var importErrorBinding: Binding<Bool> {
        Binding(get: { model.importError != nil }, set: { if !$0 { model.clearImportError() } })
    }

    private func handleImport(_ result: Result<URL, Error>) {
        guard case let .success(url) = result else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        Task { await model.importAutomations(from: data) }
    }
}

/// The page loading state (web `PageContainer loading` skeleton).
struct AutomationsListSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 2)) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 72, cornerRadius: TSRadius.lg)
                }
            }
            TSSkeleton(height: 56, cornerRadius: TSRadius.lg)
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 96, cornerRadius: TSRadius.lg)
            }
        }
        .accessibilityLabel(Text("automations.title"))
    }
}

#if DEBUG
    #Preview("Populated") {
        NavigationStack {
            AutomationsListPage(model: AutomationsListPageModel())
        }
        .teslaSyncTheme()
    }

    #Preview("Empty") {
        NavigationStack {
            AutomationsListPage(model: AutomationsListPageModel(dataSource: EmptyAutomationsListDataSource()))
        }
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            AutomationsListPage(model: AutomationsListPageModel(dataSource: FailingAutomationsListDataSource()))
        }
        .teslaSyncTheme()
    }
#endif
