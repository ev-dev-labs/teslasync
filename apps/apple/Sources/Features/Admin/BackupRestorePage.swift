import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/BackupRestorePage.tsx`
/// (route `/backup`). Reproduces the web page chrome (`PageContainer` title + subtitle +
/// the Quick Backup / New Config header actions), the four `MetricCard` stat tiles, and the
/// two web `GlassPanel`s — the backup configurations table (GlassPanel5) and the run-history
/// table with its Recent Errors list (GlassPanel6). The create/edit `Modal`, the delete
/// `ConfirmDialog`, and the restore-preview `Modal` are presented as HIG-native sheets.
///
/// All copy resolves from `Localizable.xcstrings` with the web key names; data binds through
/// the `@Observable` `BackupRestorePageModel` (no networking in the view, ADR-004). Each
/// panel owns its data state (loading / empty / error / success) in place, so the body never
/// gates on a single feed. Adaptive across macOS/iPad (regular) + iPhone (compact),
/// ADR-002/006.
public struct BackupRestorePage: View {
    @State private var model: BackupRestorePageModel

    public init(model: BackupRestorePageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                banners
                BackupStatsRow(model: model)
                configsPanel
                historyPanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loading = model.configsState { await model.load() }
        }
        .sheet(isPresented: $model.editorPresented) {
            BackupConfigEditorSheet(model: model)
        }
        .sheet(item: $model.deleteTarget) { target in
            BackupConfigDeleteSheet(model: model, target: target)
        }
        .sheet(isPresented: $model.previewPresented) {
            BackupPreviewSheet(model: model)
        }
    }

    // MARK: - Header (web PageContainer title + subtitle + actions)

    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                titleBlock
                Spacer(minLength: TSSpacing.md)
                actions
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                titleBlock
                actions
            }
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("backup.title")
            Text("backup.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .secondary, size: .medium, isLoading: model.isQuickRunning) {
                Task { await model.quickBackup() }
            } label: {
                Label("backup.quickBackup", systemImage: "bolt.fill")
            }
            TSButton(variant: .primary, size: .medium) {
                model.openCreate()
            } label: {
                Label("backup.newConfig", systemImage: "plus")
            }
        }
    }

    // MARK: - Banners (web anyError banner + toast results)

    @ViewBuilder
    private var banners: some View {
        if let outcome = model.outcome {
            BackupOutcomeBanner(outcome: outcome) { model.dismissOutcome() }
        }
        if model.hasLoadError {
            TSAlertBanner(tone: .danger, systemImage: "exclamationmark.triangle.fill", title: "error.loadFailed")
        }
    }

    // MARK: - GlassPanel5 — Backup configurations

    private var configsPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                panelHeader(systemImage: "externaldrive.fill", title: "backup.configurations")
                BackupConfigsSection(model: model)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("backup.configurations"))
    }

    // MARK: - GlassPanel6 — Backup history

    private var historyPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack {
                    panelHeader(systemImage: "clock.arrow.circlepath", title: "backup.history")
                    Spacer(minLength: TSSpacing.md)
                    TSButton("backup.refresh", variant: .ghost, size: .small) {
                        Task { await model.reloadRuns() }
                    }
                    .accessibilityLabel(Text("backup.refresh"))
                }
                BackupHistorySection(model: model)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("backup.history"))
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
        BackupRestorePage(model: BackupRestorePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        BackupRestorePage(model: BackupRestorePageModel(dataSource: PreviewEmptyBackup()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        BackupRestorePage(model: BackupRestorePageModel(dataSource: PreviewFailingBackup()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero rows (drives both empty states).
    private struct PreviewEmptyBackup: BackupRestoreDataSource {
        func loadConfigs() async throws -> [BackupConfig] {
            []
        }

        func loadRuns() async throws -> [BackupRun] {
            []
        }

        func createConfig(_: BackupConfigForm) async throws {}
        func updateConfig(id _: Int64, form _: BackupConfigForm) async throws {}
        func deleteConfig(id _: Int64) async throws {}
        func triggerConfig(id _: Int64) async throws {}
        func quickBackup() async throws {}
        func verifyRun(id _: Int64) async throws -> Bool {
            true
        }

        func loadPreview(runID _: Int64) async throws -> RestorePreview {
            RestorePreview(tables: [], metadata: [], checksumVerified: true)
        }

        func downloadURL(runID _: Int64) -> URL? {
            nil
        }
    }

    /// Preview seam that fails the reads (drives both error states).
    private struct PreviewFailingBackup: BackupRestoreDataSource {
        struct Failure: Error {}
        func loadConfigs() async throws -> [BackupConfig] {
            throw Failure()
        }

        func loadRuns() async throws -> [BackupRun] {
            throw Failure()
        }

        func createConfig(_: BackupConfigForm) async throws {
            throw Failure()
        }

        func updateConfig(id _: Int64, form _: BackupConfigForm) async throws {
            throw Failure()
        }

        func deleteConfig(id _: Int64) async throws {
            throw Failure()
        }

        func triggerConfig(id _: Int64) async throws {
            throw Failure()
        }

        func quickBackup() async throws {
            throw Failure()
        }

        func verifyRun(id _: Int64) async throws -> Bool {
            throw Failure()
        }

        func loadPreview(runID _: Int64) async throws -> RestorePreview {
            throw Failure()
        }

        func downloadURL(runID _: Int64) -> URL? {
            nil
        }
    }
#endif
