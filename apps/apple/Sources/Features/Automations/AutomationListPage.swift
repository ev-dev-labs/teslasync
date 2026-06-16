import SwiftUI

/// Native SwiftUI parity of `web/src/features/automations/pages/AutomationListPage.tsx`
/// (route `/automations/list`) — the streamlined "manage many at once" bulk table that co-exists
/// with the card-based `AutomationsListPage`. Reproduces the web `PageContainer` chrome (title +
/// subtitle), the bulk-action toolbar (enable / disable / delete with a delete confirm), and the
/// single `GlassPanel` table of every automation (a select-all checkbox, per-row checkboxes,
/// the name as a navigable link, the description, the run count, and the enabled / disabled badge).
///
/// Every web data state is implemented inside the panel (loading skeleton / retryable error /
/// no-data empty state with the open-builder CTA / populated table) so no region renders blank
/// (ADR-013). Adaptive (ADR-002/006): the toolbar and the table reflow for macOS / iPad regular
/// width vs. compact iPhone. All copy resolves from `Localizable.xcstrings` with the web key names;
/// data binds through the `@Observable` `AutomationListPageModel` (no networking in the view,
/// ADR-004).
public struct AutomationListPage: View {
    @State private var model: AutomationListPageModel
    private let onOpenBuilder: () -> Void
    private let onOpenAutomation: (Int64) -> Void

    public init(
        model: AutomationListPageModel,
        onOpenBuilder: @escaping () -> Void = {},
        onOpenAutomation: @escaping (Int64) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onOpenBuilder = onOpenBuilder
        self.onOpenAutomation = onOpenAutomation
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                if model.hasSelection {
                    AutomationListBulkToolbar(model: model)
                }
                tablePanel
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
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("automationList.title")
            Text("automationList.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Table panel (web single GlassPanel with the table-region states)

    private var tablePanel: some View {
        TSGlassPanel {
            Group {
                switch model.tableState {
                case .loading:
                    loadingView
                case .error:
                    errorView
                case .empty:
                    emptyView
                case .success:
                    AutomationListTable(model: model, onOpenAutomation: onOpenAutomation)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var loadingView: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 40, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityLabel(Text("automationList.title"))
    }

    private var errorView: some View {
        TSQueryError { Task { await model.refresh() } }
    }

    private var emptyView: some View {
        TSEmptyState(
            title: "automationList.empty.title",
            message: "automationList.empty.body",
            systemImage: "wand.and.stars"
        ) {
            TSButton("automationList.empty.cta", size: .small) {
                onOpenBuilder()
            }
        }
    }
}

#if DEBUG
    #Preview("Populated") {
        NavigationStack {
            AutomationListPage(model: AutomationListPageModel())
        }
        .teslaSyncTheme()
    }

    #Preview("Empty") {
        NavigationStack {
            AutomationListPage(model: AutomationListPageModel(dataSource: EmptyAutomationListDataSource()))
        }
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            AutomationListPage(model: AutomationListPageModel(dataSource: FailingAutomationListDataSource()))
        }
        .teslaSyncTheme()
    }
#endif
