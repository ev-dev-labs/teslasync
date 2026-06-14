import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/FeatureFlagsPage.tsx`
/// (route `/admin/flags`). Reproduces the web page chrome (web `PageContainer`: title +
/// subtitle + the "Add flag" header action) and the two web `GlassPanel`s: the flag
/// registry (`GlassPanel1` — the sortable key/value table with per-row Edit + Delete, in
/// `FeatureFlagsPage.Table.swift`) and the recent change-audit feed (`GlassPanel2`, in
/// `FeatureFlagsPage.Changes.swift`). The create/edit drawer (web `FlagEditDrawer`) and
/// the delete confirmation (web `Modal`) are presented as HIG-native sheets
/// (`FeatureFlagsPage.Editor.swift` / `FeatureFlagsPage.Delete.swift`).
///
/// Faithful to the web, both panels always render — the web `PageContainer` consumes the
/// `flags` query only for its freshness badge, so the body never gates and each panel
/// switches its own data state (loading / empty / error / success) in place. All copy
/// resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `FeatureFlagsPageModel` (no networking in the view, ADR-004). Adaptive
/// across macOS/iPad (regular) + iPhone (compact) per ADR-002/006.
public struct FeatureFlagsPage: View {
    @State private var model: FeatureFlagsPageModel

    public init(model: FeatureFlagsPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                registryPanel
                changesPanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loaded = model.flagsState { return }
            await model.load()
        }
        .sheet(isPresented: $model.editorPresented) {
            FeatureFlagEditorSheet(model: model)
        }
        .sheet(item: $model.deleteTarget) { target in
            FeatureFlagDeleteSheet(model: model, target: target)
        }
    }

    // MARK: - Header (web PageContainer title + subtitle + "Add flag" action)

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPageTitle("admin.flags.pageTitle")
                Text("admin.flags.subtitle")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            addButton
        }
    }

    private var addButton: some View {
        TSButton(variant: .primary, size: .medium) {
            model.beginCreate()
        } label: {
            Label("admin.flags.actions.add", systemImage: "plus")
        }
        .accessibilityLabel(Text("admin.flags.actions.add"))
    }

    // MARK: - GlassPanel1 — Registry (web FlagsTable panel)

    private var registryPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                panelHeader(systemImage: "flag", title: "admin.flags.panels.registry")
                registryBody
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.flags.panels.registry"))
    }

    @ViewBuilder
    private var registryBody: some View {
        switch model.flagsState {
        case .loading:
            TSTableSkeleton(rows: 5)
                .accessibilityLabel(Text("admin.flags.table.loading"))
        case .empty:
            TSEmptyState(
                title: "admin.flags.table.emptyTitle",
                message: "admin.flags.table.empty",
                systemImage: "flag.slash"
            )
            .frame(maxWidth: .infinity)
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.reloadFlags() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        case let .loaded(rows):
            FeatureFlagsTable(rows: rows, model: model)
        }
    }

    // MARK: - GlassPanel2 — Recent changes (web ChangesPanel)

    private var changesPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                panelHeader(systemImage: "clock.arrow.circlepath", title: "admin.flags.panels.changes")
                changesBody
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.flags.panels.changes"))
    }

    @ViewBuilder
    private var changesBody: some View {
        switch model.changesState {
        case .loading:
            TSTableSkeleton(rows: 4)
                .accessibilityLabel(Text("admin.flags.audit.loading"))
        case .empty:
            TSEmptyState(
                title: "admin.flags.audit.empty.title",
                message: "admin.flags.audit.empty.globalMessage",
                systemImage: "clock.badge.questionmark"
            )
            .frame(maxWidth: .infinity)
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.reloadChanges() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        case let .loaded(rows):
            FeatureFlagChangesTable(rows: rows)
        }
    }

    private func panelHeader(systemImage: String, title: LocalizedStringKey) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TSPanelTitle(title)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        FeatureFlagsPage(model: FeatureFlagsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        FeatureFlagsPage(model: FeatureFlagsPageModel(dataSource: PreviewEmptyFeatureFlags()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        FeatureFlagsPage(model: FeatureFlagsPageModel(dataSource: PreviewFailingFeatureFlags()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero rows (drives both empty states).
    private struct PreviewEmptyFeatureFlags: FeatureFlagsDataSource {
        func loadFlags() async throws -> [FeatureFlagEntry] {
            []
        }

        func loadChanges(limit _: Int) async throws -> [FeatureFlagChange] {
            []
        }

        func setFlag(key _: String, value _: FlagJSONValue, reason _: String) async throws {}
        func deleteFlag(key _: String, reason _: String) async throws {}
    }

    /// Preview seam that fails the reads (drives both error states).
    private struct PreviewFailingFeatureFlags: FeatureFlagsDataSource {
        struct Failure: Error {}
        func loadFlags() async throws -> [FeatureFlagEntry] {
            throw Failure()
        }

        func loadChanges(limit _: Int) async throws -> [FeatureFlagChange] {
            throw Failure()
        }

        func setFlag(key _: String, value _: FlagJSONValue, reason _: String) async throws {
            throw Failure()
        }

        func deleteFlag(key _: String, reason _: String) async throws {
            throw Failure()
        }
    }
#endif
