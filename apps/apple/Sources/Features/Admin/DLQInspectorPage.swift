import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/DLQInspectorPage.tsx`
/// (route `/admin/dlq`). Reproduces the web page chrome (web `PageContainer`: title +
/// subtitle), the dismissible replay-blocked banner (web `AlertBanner`), the status header
/// (web `StatusHeader` — three stat tiles + the env-gate banner, in
/// `DLQInspectorPage.StatusHeader.swift`), and the two web `GlassPanel`s: the dead-letter
/// entries table (`GlassPanel1` — `DLQInspectorPage.Entries.swift`) and the recent
/// replay-activity feed (`GlassPanel2` — `DLQInspectorPage.Audit.swift`). The inspect
/// drawer (web `EntryDrawer`) and the replay confirmation (web `ConfirmDialog`) are
/// presented as HIG-native sheets (`DLQInspectorPage.Drawer.swift` /
/// `DLQInspectorPage.Confirm.swift`), the confirm stacking on the drawer like the web.
///
/// Faithful to the web, both panels always render — each switches its own data state
/// (loading / empty / error / success) in place rather than gating the surface. All copy
/// resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `DLQInspectorPageModel` (no networking in the view, ADR-004). Adaptive
/// across macOS/iPad (regular) + iPhone (compact) per ADR-002/006.
public struct DLQInspectorPage: View {
    @State private var model: DLQInspectorPageModel

    public init(model: DLQInspectorPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                if model.replayDisabledBanner {
                    replayBlockedBanner
                }
                DLQStatusHeader(model: model)
                entriesPanel
                auditPanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loaded = model.listState { return }
            await model.load()
        }
        .sheet(item: $model.selected) { summary in
            DLQEntryDrawer(model: model, summary: summary)
        }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("admin.dlq.pageTitle")
            Text("admin.dlq.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Replay-blocked banner (web `AlertBanner` over `replayDisabledBanner`)

    private var replayBlockedBanner: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "exclamationmark.triangle.fill",
            title: "admin.dlq.banners.replayBlockedTitle",
            message: "admin.dlq.banners.replayBlockedMessage",
            onDismiss: { model.dismissReplayBanner() }
        )
    }

    // MARK: - GlassPanel1 — Dead-letter entries (web entries `GlassPanel`)

    private var entriesPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                panelHeader(systemImage: "exclamationmark.octagon", title: "admin.dlq.panels.entries")
                entriesBody
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.dlq.panels.entries"))
    }

    @ViewBuilder
    private var entriesBody: some View {
        switch model.listState {
        case .loading:
            TSTableSkeleton(rows: 5)
                .accessibilityLabel(Text("admin.dlq.table.loading"))
        case .empty:
            TSEmptyState(title: "admin.dlq.table.empty", systemImage: "tray.and.arrow.down")
                .frame(maxWidth: .infinity)
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.reloadList() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        case let .loaded(result):
            DLQEntriesTable(rows: result.entries, model: model)
        }
    }

    // MARK: - GlassPanel2 — Recent replay activity (web audit `GlassPanel`)

    private var auditPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                panelHeader(systemImage: "clock.arrow.circlepath", title: "admin.dlq.panels.audit")
                auditBody
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.dlq.panels.audit"))
    }

    @ViewBuilder
    private var auditBody: some View {
        switch model.auditState {
        case .loading:
            TSTableSkeleton(rows: 4)
                .accessibilityLabel(Text("admin.dlq.audit.loading"))
        case .empty:
            TSEmptyState(
                title: "admin.dlq.audit.empty.title",
                message: "admin.dlq.audit.empty.globalMessage",
                systemImage: "clock.badge.questionmark"
            )
            .frame(maxWidth: .infinity)
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.reloadAudit() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        case let .loaded(rows):
            DLQAuditTable(rows: rows)
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
        DLQInspectorPage(model: DLQInspectorPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        DLQInspectorPage(model: DLQInspectorPageModel(dataSource: PreviewEmptyDLQ()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        DLQInspectorPage(model: DLQInspectorPageModel(dataSource: PreviewFailingDLQ()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero rows (drives both empty states).
    private struct PreviewEmptyDLQ: DLQInspectorDataSource {
        func loadList() async throws -> DLQListResult {
            DLQListResult(count: 0, replayEnabled: false, entries: [])
        }

        func loadEntry(id _: Int64) async throws -> DLQEntryFull {
            DLQEntryFull(summary: DLQEntrySummary(id: 0, arrivedAt: ""))
        }

        func loadAudit(limit _: Int) async throws -> [DLQReplayAuditRecord] {
            []
        }

        func replay(id _: Int64) async throws -> DLQReplayOutcome {
            DLQReplayOutcome(result: .ok)
        }
    }

    /// Preview seam that fails the reads (drives both error states).
    private struct PreviewFailingDLQ: DLQInspectorDataSource {
        struct Failure: Error {}
        func loadList() async throws -> DLQListResult {
            throw Failure()
        }

        func loadEntry(id _: Int64) async throws -> DLQEntryFull {
            throw Failure()
        }

        func loadAudit(limit _: Int) async throws -> [DLQReplayAuditRecord] {
            throw Failure()
        }

        func replay(id _: Int64) async throws -> DLQReplayOutcome {
            throw Failure()
        }
    }
#endif
