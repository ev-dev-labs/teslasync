import Foundation
import Observation

// MARK: - Page state

/// The combined loading state for all three data sources. `.loading` shows when any
/// source is still loading; `.error` surfaces the first encountered error; `.loaded`
/// means all three sources have completed successfully (even if some are empty).
public enum DBHealthPageState: Equatable, Sendable {
    case loading
    case error(String)
    case loaded
}

// MARK: - Sort key (web `SortKey = 'size' | 'rows' | 'name'`)

/// The table sort criteria (web `SortKey`). User toggles between these with the
/// sort buttons at the top of the table panel.
public enum DBHealthSortKey: String, CaseIterable, Sendable {
    case size
    case rows
    case name
}

// MARK: - Page model

/// The `@Observable` state holder the DB Health page binds to (ADR-004 — no networking
/// in the view). Owns the load state for all three data sources (DBStats, MigrationStatus,
/// ConnectionPool) and derives display guards + computed properties from them, reading
/// through the injected data source seams.
@MainActor
@Observable
public final class DBHealthPageModel {
    public private(set) var state: DBHealthPageState = .loading

    /// Database statistics (tables, sizes, etc.).
    public private(set) var dbStats: DBStats?

    /// Migration status (version, dirty, pending).
    public private(set) var migrationStatus: DBMigrationStatus?

    /// Connection pool statistics.
    public private(set) var connectionPool: DBConnectionPool?

    /// Current table sort order (web `sortKey` state).
    public var sortKey: DBHealthSortKey = .size

    @ObservationIgnored private let dbStatsSource: any DBStatsDataSource
    @ObservationIgnored private let migrationStatusSource: any MigrationStatusDataSource
    @ObservationIgnored private let connectionPoolSource: any ConnectionPoolDataSource

    public init(
        dbStatsSource: any DBStatsDataSource = SampleDBStatsDataSource(),
        migrationStatusSource: any MigrationStatusDataSource = SampleMigrationStatusDataSource(),
        connectionPoolSource: any ConnectionPoolDataSource = SampleConnectionPoolDataSource()
    ) {
        self.dbStatsSource = dbStatsSource
        self.migrationStatusSource = migrationStatusSource
        self.connectionPoolSource = connectionPoolSource
    }

    // MARK: - Computed properties (web derived state)

    /// The loaded table rows (empty unless dbStats loaded successfully).
    public var tables: [DBTableInfo] {
        dbStats?.tables ?? []
    }

    /// Sorted table rows (web `sortedTables` useMemo).
    public var sortedTables: [DBTableInfo] {
        var sorted = tables
        switch sortKey {
        case .size:
            sorted.sort { ($0.sizeBytes, $0.name) > ($1.sizeBytes, $1.name) }
        case .rows:
            sorted.sort { ($0.rowCount, $0.name) > ($1.rowCount, $1.name) }
        case .name:
            sorted.sort { $0.name < $1.name }
        }
        return sorted
    }

    /// Chart data: top 15 tables by row count (web `chartData` useMemo).
    /// Always sorted by row count, independent of table sort.
    public var chartData: [(name: String, rows: Int64)] {
        tables
            .sorted { $0.rowCount > $1.rowCount }
            .prefix(15)
            .map { table in
                let displayName = table.name.count > 20
                    ? String(table.name.prefix(18)) + "…"
                    : table.name
                return (displayName, table.rowCount)
            }
    }

    /// Number of tables exceeding 100MB (web `largeTables` const).
    public var largeTableCount: Int {
        let threshold: Int64 = 100 * 1024 * 1024 // 100MB
        return tables.filter { $0.sizeBytes > threshold }.count
    }

    /// Pool usage percentage (web `poolUsage` const).
    public var poolUsagePercent: Double {
        guard let pool = connectionPool, pool.maxOpen > 0 else { return 0.0 }
        return min(Double(pool.inUse) / Double(pool.maxOpen) * 100.0, 100.0)
    }

    /// Database size display string (web `dbSizeDisplay` const).
    public var databaseSizeDisplay: String {
        guard let size = dbStats?.databaseSize else { return "—" }
        return formatBytes(size)
    }

    // MARK: - Actions

    /// Loads all three data sources concurrently. Sets `.error` on first failure,
    /// or `.loaded` when all three complete successfully.
    public func load() async {
        state = .loading
        do {
            async let statsTask = dbStatsSource.load()
            async let migrationTask = migrationStatusSource.load()
            async let poolTask = connectionPoolSource.load()

            let (stats, migration, pool) = try await (statsTask, migrationTask, poolTask)

            dbStats = stats
            migrationStatus = migration
            connectionPool = pool
            state = .loaded
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Refreshes all data (web doesn't expose explicit refresh, but the query
    /// refetches on interval). Exposed for pull-to-refresh or manual retry.
    public func refresh() async {
        await load()
    }

    // MARK: - Helpers

    /// Formats bytes into human-readable size (web `formatBytes` function).
    private func formatBytes(_ bytes: Int64) -> String {
        if bytes < 1024 {
            return "\(bytes) B"
        }
        if bytes < 1024 * 1024 {
            return String(format: "%.1f KB", Double(bytes) / 1024.0)
        }
        if bytes < 1024 * 1024 * 1024 {
            return String(format: "%.1f MB", Double(bytes) / (1024.0 * 1024.0))
        }
        return String(format: "%.2f GB", Double(bytes) / (1024.0 * 1024.0 * 1024.0))
    }
}
