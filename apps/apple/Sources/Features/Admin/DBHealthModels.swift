import Foundation

// MARK: - Table Info (web `TableInfo`)

/// One database table's metadata — the native peer of the web `TableInfo`.
/// Field names/types mirror the wire 1:1 so the production data source binding
/// maps straight across. Byte counts are unit-agnostic (not SI-bearing), so they
/// round-trip verbatim and are only formatted at the display boundary.
public struct DBTableInfo: Identifiable, Hashable, Sendable {
    public let name: String
    public let schema: String
    public let rowCount: Int64
    public let sizeBytes: Int64
    public let indexCount: Int
    public let lastVacuum: String?

    /// Web `keyExtractor={(tbl) => tbl.name}`.
    public var id: String {
        name
    }

    public init(
        name: String,
        schema: String,
        rowCount: Int64,
        sizeBytes: Int64,
        indexCount: Int,
        lastVacuum: String?
    ) {
        self.name = name
        self.schema = schema
        self.rowCount = rowCount
        self.sizeBytes = sizeBytes
        self.indexCount = indexCount
        self.lastVacuum = lastVacuum
    }
}

// MARK: - DB Stats (web `DBStats`, GET /dev-tools/db-stats)

/// The database statistics report (web `DBStats`).
public struct DBStats: Equatable, Sendable {
    public let tables: [DBTableInfo]
    public let tableCount: Int
    public let databaseSize: Int64 // bytes

    public init(tables: [DBTableInfo], tableCount: Int, databaseSize: Int64) {
        self.tables = tables
        self.tableCount = tableCount
        self.databaseSize = databaseSize
    }
}

// MARK: - Migration Info (web `MigrationInfo`)

/// One applied migration (web `MigrationInfo`).
public struct DBMigrationInfo: Identifiable, Hashable, Sendable {
    public let version: String
    public let name: String
    public let appliedAt: String?

    /// Web does not define a key extractor; we use version as the unique identifier.
    public var id: String {
        version
    }

    public init(version: String, name: String, appliedAt: String?) {
        self.version = version
        self.name = name
        self.appliedAt = appliedAt
    }
}

// MARK: - Migration Status (web `MigrationStatus`, GET /dev-tools/migration-status)

/// The migration status report (web `MigrationStatus`).
public struct DBMigrationStatus: Equatable, Sendable {
    public let currentVersion: String
    public let dirty: Bool
    public let pending: Int
    public let migrations: [DBMigrationInfo]

    public init(currentVersion: String, dirty: Bool, pending: Int, migrations: [DBMigrationInfo]) {
        self.currentVersion = currentVersion
        self.dirty = dirty
        self.pending = pending
        self.migrations = migrations
    }
}

// MARK: - Connection Pool (web `ConnectionPool`, GET /dev-tools/runtime-info)

/// The connection pool statistics (web `ConnectionPool`).
public struct DBConnectionPool: Equatable, Sendable {
    public let maxOpen: Int
    public let open: Int
    public let inUse: Int
    public let idle: Int
    public let waitCount: Int
    public let waitDurationMs: Int

    public init(maxOpen: Int, open: Int, inUse: Int, idle: Int, waitCount: Int, waitDurationMs: Int) {
        self.maxOpen = maxOpen
        self.open = open
        self.inUse = inUse
        self.idle = idle
        self.waitCount = waitCount
        self.waitDurationMs = waitDurationMs
    }
}

// MARK: - Data source seams

/// Supplies the database statistics the page renders. The production implementation
/// binds the API endpoint (ADR-004 — the view holds no networking); previews and
/// tests inject doubles to drive the loading / empty / error / success states.
public protocol DBStatsDataSource: Sendable {
    func load() async throws -> DBStats
}

/// Supplies the migration status the page renders.
public protocol MigrationStatusDataSource: Sendable {
    func load() async throws -> DBMigrationStatus
}

/// Supplies the connection pool statistics the page renders.
public protocol ConnectionPoolDataSource: Sendable {
    func load() async throws -> DBConnectionPool
}
