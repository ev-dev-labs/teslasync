import SwiftUI

/// The four headline stat tiles (web `MetricCard` row): Total Configs, Total Backups, Last
/// Backup, Total Size. Adaptive grid (2-up compact, up to 4-up regular). While either feed
/// loads, the row shows four `TSStatSkeleton`s (web `Skeleton` loaders) so the tiles
/// never read as blank.
struct BackupStatsRow: View {
    let model: BackupRestorePageModel

    private let columns = [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]

    private var isLoading: Bool {
        if case .loading = model.configsState { return true }
        if case .loading = model.runsState { return true }
        return false
    }

    private var lastBackupValue: String {
        guard let last = model.lastBackup else { return BackupRestoreFormat.emptyValue }
        return BackupRestoreFormat.relative(last.completedAt ?? last.createdAt)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            if isLoading {
                ForEach(0 ..< 4, id: \.self) { _ in TSStatSkeleton() }
            } else {
                tiles
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var tiles: some View {
        TSStatCard(
            title: "backup.totalConfigs",
            value: BackupRestoreFormat.int(model.totalConfigs),
            systemImage: "externaldrive.fill"
        )
        TSStatCard(
            title: "backup.totalBackups",
            value: BackupRestoreFormat.int(model.totalBackups),
            systemImage: "archivebox.fill"
        )
        TSStatCard(
            title: "backup.lastBackup",
            value: lastBackupValue,
            systemImage: "clock.fill"
        )
        TSStatCard(
            title: "backup.totalSize",
            value: BackupRestoreFormat.bytes(model.totalSize),
            systemImage: "internaldrive.fill"
        )
    }
}
