import SwiftUI

/// The data-state switch for the Backup History panel (web GlassPanel6 body): loading →
/// table skeleton, empty → `EmptyState`, error → retryable error view, success → the run
/// table followed by the Recent Errors list (web `failedRuns`). Never a blank region.
struct BackupHistorySection: View {
    let model: BackupRestorePageModel

    var body: some View {
        switch model.runsState {
        case .loading:
            TSTableSkeleton(rows: 5)
                .accessibilityLabel(Text("backup.history"))
        case .empty:
            TSEmptyState(
                title: "backup.noRuns",
                message: "backup.noRunsMessage",
                systemImage: "clock.badge.xmark"
            )
            .frame(maxWidth: .infinity)
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.reloadRuns() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        case let .loaded(rows):
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                BackupRunsTable(rows: rows, model: model)
                recentErrors
            }
        }
    }

    // MARK: - Recent Errors (web `failedRuns`)

    @ViewBuilder
    private var recentErrors: some View {
        if !model.failedRuns.isEmpty {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text("backup.recentErrors")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityAddTraits(.isHeader)
                ForEach(model.failedRuns) { errorRow($0) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func errorRow(_ run: BackupRun) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: run.fileName ?? "Run #\(run.id)")
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: run.errorMessage ?? "")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.sm)
        .background(
            Color.TS.statusDanger.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
