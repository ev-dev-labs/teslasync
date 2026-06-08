//
//  DataPipelineSection.Previews.swift
//  TeslaSync — P4 feature view · 0242 · DataPipelineSection (Apple)
//
//  Xcode previews for each surface state (data / compression-empty / queue-empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum DataPipelinePreviewData {
        static let compression = CompressionSnapshot(
            savingsPercent: 62.4,
            estimatedSavedBytes: 5_368_709_120,
            totalPositions: 1_842_390,
            compressedPositions: 1_150_120
        )

        static let jobs: [ExportJobItem] = [
            ExportJobItem(
                id: "job-1",
                type: "drives",
                format: "csv",
                status: "ready",
                fileName: "drives-2026-04.csv",
                recordCount: 48210,
                createdAt: Date(timeIntervalSince1970: 1_775_649_900)
            ),
            ExportJobItem(
                id: "job-2",
                type: "charging",
                format: "json",
                status: "processing",
                fileName: "charging-2026-04.json",
                recordCount: 12044,
                createdAt: Date(timeIntervalSince1970: 1_775_653_500)
            ),
            ExportJobItem(
                id: "job-3",
                type: "analytics",
                format: "csv",
                status: "queued",
                fileName: "analytics-q1.csv",
                recordCount: 0,
                createdAt: Date(timeIntervalSince1970: 1_775_657_100)
            ),
            ExportJobItem(
                id: "job-4",
                type: "backup",
                format: "json",
                status: "failed",
                fileName: "backup-full.json",
                recordCount: 0,
                createdAt: Date(timeIntervalSince1970: 1_775_660_700)
            )
        ]
    }

    @MainActor
    private func previewSection(_ input: DataPipelineInput) -> DataPipelineSection {
        let source = InMemoryDataPipelineSource(initial: input)
        return DataPipelineSection(source: source, initiallyExpanded: true)
    }

    #Preview("Data") {
        ScrollView {
            previewSection(DataPipelineInput(
                compression: DataPipelinePreviewData.compression,
                jobs: DataPipelinePreviewData.jobs
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Compression empty") {
        ScrollView {
            previewSection(DataPipelineInput(jobs: DataPipelinePreviewData.jobs))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Queue empty") {
        ScrollView {
            previewSection(DataPipelineInput(
                compression: DataPipelinePreviewData.compression,
                jobs: []
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ScrollView {
            previewSection(DataPipelineInput(isLoading: true))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ScrollView {
            previewSection(DataPipelineInput(errorMessage: "Network request timed out"))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView {
            previewSection(DataPipelineInput(
                compression: DataPipelinePreviewData.compression,
                jobs: DataPipelinePreviewData.jobs,
                connection: .stale
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView {
            previewSection(DataPipelineInput(
                compression: DataPipelinePreviewData.compression,
                jobs: DataPipelinePreviewData.jobs,
                connection: .offline
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }
#endif
