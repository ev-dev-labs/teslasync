import SwiftUI

/// Native SwiftUI parity of `web/src/features/exports/pages/ExportsPage.tsx` (route
/// `/exports`). Reproduces the web page chrome (web `PageContainer`: title + subtitle),
/// the bulk-action toolbar shown above a selection (web `BulkActionToolbar` — selected
/// count + noun, a destructive Delete routed through a confirmation, and Clear), and the
/// single web `GlassPanel` (`GlassPanel1`) hosting the export-jobs table. The table lives
/// in `ExportsPage.Table.swift`.
///
/// Faithful to the web, the panel always renders and switches its own data state in place
/// (loading skeletons / error + retry / empty / the table) rather than gating the surface.
/// Adaptive (ADR-002/006): macOS / iPad regular width lays the jobs out as a columnar
/// grid; compact iPhone stacks them as cards. Every data state the source produces is
/// implemented; all copy resolves from `Localizable.xcstrings` with the web key names;
/// data binds through the `@Observable` `ExportsPageModel` (no networking in the view,
/// ADR-004).
public struct ExportsPage: View {
    @State private var model: ExportsPageModel
    @State private var confirmingDelete = false

    public init(model: ExportsPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                if model.hasSelection {
                    bulkToolbar
                }
                listPanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            await model.loadIfNeeded()
        }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("exportsList.title")
            Text("exportsList.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Bulk toolbar (web `BulkActionToolbar` — count + noun + Delete + Clear)

    private var bulkToolbar: some View {
        HStack(spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: "\(model.selectedCount)")
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.accent)
                Text(LocalizedStringKey(model.selectionNounKey))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: TSSpacing.sm)
            Button(role: .destructive) {
                confirmingDelete = true
            } label: {
                Label("exportsList.bulk.delete", systemImage: "trash")
            }
            .disabled(model.isDeleting)
            Button("table.clearSelection") {
                model.clearSelection()
            }
            .buttonStyle(.plain)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.accent)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.accent.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("exportsList.title"))
        .confirmationDialog(
            Text("exportsList.bulk.deleteConfirm.title"),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button("common.delete", role: .destructive) {
                Task { await model.deleteSelected() }
            }
        } message: {
            Text("exportsList.bulk.deleteConfirm.body")
        }
    }

    // MARK: - List panel (web `GlassPanel1` — loading / error / empty / table)

    private var listPanel: some View {
        TSGlassPanel {
            bodyRegion
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("exportsList.title"))
    }

    @ViewBuilder
    private var bodyRegion: some View {
        switch model.state {
        case .loading:
            loadingRegion
        case let .error(message):
            errorRegion(message)
        case .empty:
            emptyRegion
        case let .loaded(jobs):
            ExportsTable(model: model, jobs: jobs)
        }
    }

    // MARK: Loading (web three `<Skeleton>` rows)

    private var loadingRegion: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 40, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityLabel(Text("exportsList.title"))
    }

    // MARK: Error (web `<ErrorDisplay error={error} />` — retryable)

    private func errorRegion(_ message: String) -> some View {
        TSErrorDisplay(onRetry: { Task { await model.refresh() } })
            .frame(maxWidth: .infinity)
            .accessibilityValue(Text(verbatim: message))
    }

    // MARK: Empty (web `<EmptyState title message />`)

    private var emptyRegion: some View {
        TSEmptyState(
            title: "exportsList.empty.title",
            message: "exportsList.empty.body",
            systemImage: "tray.and.arrow.down"
        )
        .frame(maxWidth: .infinity)
    }
}

#if DEBUG
    #Preview("Loaded") {
        ExportsPage(model: ExportsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        ExportsPage(model: ExportsPageModel(dataSource: PreviewEmptyExports()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        ExportsPage(model: ExportsPageModel(dataSource: PreviewFailingExports()))
            .teslaSyncTheme()
    }

    /// Preview seam returning zero rows (drives the empty state).
    private struct PreviewEmptyExports: ExportsDataSource {
        func loadJobs() async throws -> [ExportJobSummary] {
            []
        }

        func bulkDelete(ids _: [String]) async throws -> ExportBulkResult {
            ExportBulkResult(deleted: 0)
        }
    }

    /// Preview seam that fails (drives the error state).
    private struct PreviewFailingExports: ExportsDataSource {
        struct Failure: Error {}
        func loadJobs() async throws -> [ExportJobSummary] {
            throw Failure()
        }

        func bulkDelete(ids _: [String]) async throws -> ExportBulkResult {
            throw Failure()
        }
    }
#endif
