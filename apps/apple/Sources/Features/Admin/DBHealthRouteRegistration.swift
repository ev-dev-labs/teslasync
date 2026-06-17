import SwiftUI

/// Registers the native DB Health surface for the `.dbHealth` route so the app shell's
/// route host renders it (web `/db-health`). Mirrors the sibling SystemRouteRegistration:
/// the `@Observable` model is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type.
///
/// The three data sources (DB stats, migration status, connection pool) default to sample
/// sources so the page renders its populated state out of the box; production injects the
/// live API adapters at composition time.
public enum DBHealthRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dbStatsSource: any DBStatsDataSource = SampleDBStatsDataSource(),
        migrationStatusSource: any MigrationStatusDataSource = SampleMigrationStatusDataSource(),
        connectionPoolSource: any ConnectionPoolDataSource = SampleConnectionPoolDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = DBHealthPageModel(
            dbStatsSource: dbStatsSource,
            migrationStatusSource: migrationStatusSource,
            connectionPoolSource: connectionPoolSource
        )
        registry.register(.dbHealth) {
            DBHealthPage(model: model)
        }
        return registry
    }
}
