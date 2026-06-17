import Foundation

// Sample data sources — intentionally large function bodies with representative test data.

/// Sample data source for DBStats — representative local seed used as the page/preview
/// default until the KMP-backed source is injected at composition time. It is NOT
/// production telemetry — it exists so the surface renders its populated state out of
/// the box. Production replaces it with the API adapter.
public struct SampleDBStatsDataSource: DBStatsDataSource {
    public init() {}

    // swiftlint:disable:next function_body_length
    public func load() async throws -> DBStats {
        DBStats(
            tables: [
                DBTableInfo(
                    name: "signal_log",
                    schema: "public",
                    rowCount: 48_318_382,
                    sizeBytes: 12_884_901_888,
                    indexCount: 5,
                    lastVacuum: "2024-03-15T14:32:00Z"
                ),
                DBTableInfo(
                    name: "drives",
                    schema: "public",
                    rowCount: 6_442_451,
                    sizeBytes: 2_147_483_648,
                    indexCount: 3,
                    lastVacuum: "2024-03-14T08:15:00Z"
                ),
                DBTableInfo(
                    name: "charging_sessions",
                    schema: "public",
                    rowCount: 1_024_000,
                    sizeBytes: 536_870_912,
                    indexCount: 2,
                    lastVacuum: "2024-03-13T12:00:00Z"
                ),
                DBTableInfo(
                    name: "vehicles",
                    schema: "public",
                    rowCount: 128,
                    sizeBytes: 8_388_608,
                    indexCount: 1,
                    lastVacuum: nil
                ),
                DBTableInfo(
                    name: "positions",
                    schema: "public",
                    rowCount: 5_242_880,
                    sizeBytes: 1_073_741_824,
                    indexCount: 4,
                    lastVacuum: "2024-03-12T18:45:00Z"
                ),
                DBTableInfo(
                    name: "energy_daily_summary",
                    schema: "public",
                    rowCount: 32_768,
                    sizeBytes: 134_217_728,
                    indexCount: 2,
                    lastVacuum: "2024-03-11T09:30:00Z"
                ),
                DBTableInfo(
                    name: "alerts",
                    schema: "public",
                    rowCount: 4_096,
                    sizeBytes: 16_777_216,
                    indexCount: 1,
                    lastVacuum: nil
                ),
                DBTableInfo(
                    name: "notifications",
                    schema: "public",
                    rowCount: 8_192,
                    sizeBytes: 33_554_432,
                    indexCount: 1,
                    lastVacuum: "2024-03-10T11:00:00Z"
                )
            ],
            tableCount: 8,
            databaseSize: 17_179_869_184 // ~16 GB
        )
    }
}

/// Sample data source for Migration Status.
public struct SampleMigrationStatusDataSource: MigrationStatusDataSource {
    public init() {}

    public func load() async throws -> DBMigrationStatus {
        DBMigrationStatus(
            currentVersion: "000185",
            dirty: false,
            pending: 0,
            migrations: [
                DBMigrationInfo(
                    version: "000185",
                    name: "add_si_unit_columns",
                    appliedAt: "2024-03-15T10:00:00Z"
                ),
                DBMigrationInfo(
                    version: "000184",
                    name: "create_vehicle_units_history",
                    appliedAt: "2024-03-14T15:30:00Z"
                ),
                DBMigrationInfo(
                    version: "000183",
                    name: "add_indexes_signal_log",
                    appliedAt: "2024-03-13T09:15:00Z"
                ),
                DBMigrationInfo(
                    version: "000182",
                    name: "create_fleet_telemetry_coverage",
                    appliedAt: "2024-03-12T14:45:00Z"
                ),
                DBMigrationInfo(
                    version: "000181",
                    name: "normalize_timestamps",
                    appliedAt: "2024-03-11T11:20:00Z"
                )
            ]
        )
    }
}

/// Sample data source for Connection Pool.
public struct SampleConnectionPoolDataSource: ConnectionPoolDataSource {
    public init() {}

    public func load() async throws -> DBConnectionPool {
        DBConnectionPool(
            maxOpen: 25,
            open: 18,
            inUse: 12,
            idle: 6,
            waitCount: 342,
            waitDurationMs: 1250
        )
    }
}
