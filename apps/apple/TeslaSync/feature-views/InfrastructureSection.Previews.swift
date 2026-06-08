//
//  InfrastructureSection.Previews.swift
//  TeslaSync — P4 feature view · 0006 · InfrastructureSection (Apple)
//
//  Xcode previews for each surface state (loading / empty / success / error / stale
//  / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface placeholder gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private enum InfraPreviewData {
        static let dbStatsJSON = """
        {
          "connections": 12,
          "database": "teslasync",
          "size_mb": 482,
          "tables": 64
        }
        """

        static let runtimeJSON = """
        {
          "go_version": "go1.25",
          "goroutines": 48,
          "heap_mb": 96,
          "uptime_seconds": 86400
        }
        """

        static func model(
            connection: InfraConnection = .online,
            seedOnline: Bool = true,
            cached: [String: InfraToolResult] = [:],
            cachedAt: Date = Date()
        ) -> InfrastructureModel {
            let initial = seedOnline
                ? InfraConnectivityUpdate(connection: connection, updatedAt: Date())
                : nil
            let source = InMemoryInfrastructureSource(initial: initial)
            let model = InfrastructureModel(source: source)
            model.start()
            if !cached.isEmpty {
                model.restore(cached, at: cachedAt)
            }
            return model
        }
    }

    #Preview("Loading") {
        InfrastructureSection(model: InfraPreviewData.model(seedOnline: false))
    }

    #Preview("Empty (no runs)") {
        InfrastructureSection(model: InfraPreviewData.model())
    }

    #Preview("Success") {
        InfrastructureSection(
            model: InfraPreviewData.model(
                cached: [
                    "db-stats": .success(json: InfraPreviewData.dbStatsJSON),
                    "runtime-info": .success(json: InfraPreviewData.runtimeJSON)
                ]
            )
        )
    }

    #Preview("Error") {
        InfrastructureSection(
            model: InfraPreviewData.model(
                cached: ["migration-status": .failure(message: "pq: relation \"schema_migrations\" does not exist")]
            )
        )
    }

    #Preview("Stale") {
        InfrastructureSection(
            model: InfraPreviewData.model(
                cached: ["db-stats": .success(json: InfraPreviewData.dbStatsJSON)],
                cachedAt: Date().addingTimeInterval(-120)
            )
        )
    }

    #Preview("Offline (cached)") {
        InfrastructureSection(
            model: InfraPreviewData.model(
                connection: .offline,
                cached: ["db-stats": .success(json: InfraPreviewData.dbStatsJSON)],
                cachedAt: Date().addingTimeInterval(-30)
            )
        )
    }
#endif
