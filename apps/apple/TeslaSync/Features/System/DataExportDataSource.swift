//
//  DataExportDataSource.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — Data-source seam
//
//  The networking seam the `@Observable` page model binds to (ADR-004 — the view
//  holds no networking). The production implementation wraps the shared KMP
//  repositories / generated client; previews and tests inject doubles to drive the
//  loading / empty / error / success states.
//
//  Method ↔ web hook map (the web hook names are preserved at these call sites):
//    loadJobs()            ← useExportJobs          → GET  /export/jobs
//    loadVehicles()        ← useVehicles            → GET  /vehicles
//    useExportColumns(_:)  ← useExportColumns       → GET  /exports/columns?type=
//    submitExport(_:)      ← submitExport mutation  → POST /export/jobs
//    useCreateAccountExport(_:) ← useCreateAccountExport → POST /export/jobs/account
//

import Foundation

protocol DataExportDataSource: Sendable {
    /// web `useExportJobs` → `GET /export/jobs`.
    func loadJobs() async throws -> [DataExportJobSummary]

    /// web `useVehicles` → `GET /vehicles`.
    func loadVehicles() async throws -> [DataExportVehicle]

    /// web `useExportColumns(type)` → `GET /exports/columns?type=`. Returns `nil`
    /// when the type publishes no catalog (web hook is `enabled: !!type`).
    func useExportColumns(_ type: DataExportType) async throws -> DataExportColumnsResponse?

    /// web submit mutation → `POST /export/jobs`.
    func submitExport(_ payload: DataExportSubmitPayload) async throws -> DataExportJobSummary

    /// web `useCreateAccountExport` → `POST /export/jobs/account`.
    func useCreateAccountExport(_ payload: DataExportAccountPayload) async throws -> DataExportJobSummary
}

// MARK: - Sample seed (page / preview default until the KMP source is injected)

/// A representative local seed so the surface renders its populated state out of the
/// box (mirrors the sibling `SampleExportsDataSource`). NOT production data — the
/// shared-core adapter replaces it at composition time.
struct SampleDataExportDataSource: DataExportDataSource {
    func loadJobs() async throws -> [DataExportJobSummary] {
        [
            DataExportJobSummary(
                id: "8f4c2b9e-7a1d-4e6f-9c3a-2b5d8e1f0a4c",
                type: "drives",
                format: "csv",
                status: .ready,
                vehicleID: 1,
                recordCount: 1284,
                fileSize: 2_415_919,
                durationMs: 40_318,
                createdAt: "2026-06-16T09:12:00Z",
                completedAt: "2026-06-16T09:12:40Z"
            ),
            DataExportJobSummary(
                id: "1b9d3f70-5c2a-4d18-9f6b-0a7e4c2d1e83",
                type: "charging",
                format: "json",
                status: .processing,
                vehicleID: 1,
                recordCount: 612,
                createdAt: "2026-06-16T09:30:00Z"
            ),
            DataExportJobSummary(
                id: "c5e8a042-6f31-4b7c-8d29-3e1f0a6b4c2d",
                type: "full_backup",
                format: "json",
                status: .failed,
                errorMessage: "storage backend unavailable",
                createdAt: "2026-06-15T18:05:00Z"
            ),
            DataExportJobSummary(
                id: "2d7f6a18-9b04-4e3c-a1d8-5c2b7e0f3a91",
                type: "analytics",
                format: "csv",
                status: .expired,
                fileSize: 51200,
                durationMs: 4200,
                createdAt: "2026-06-01T11:45:00Z",
                completedAt: "2026-06-01T11:46:10Z"
            )
        ]
    }

    func loadVehicles() async throws -> [DataExportVehicle] {
        [
            DataExportVehicle(id: 1, displayName: "Model Y", vin: "5YJYGDEE0MF000001"),
            DataExportVehicle(id: 2, displayName: "Model 3", vin: "5YJ3E1EA7KF000002")
        ]
    }

    func useExportColumns(_ type: DataExportType) async throws -> DataExportColumnsResponse? {
        guard type.supportsColumnSelection else { return nil }
        let columns: [DataExportColumnInfo]
        switch type {
        case .charging:
            columns = [
                DataExportColumnInfo(name: "id", label: "ID", alwaysIncluded: true),
                DataExportColumnInfo(name: "started_at", label: "Started At", alwaysIncluded: true),
                DataExportColumnInfo(name: "energy_added_wh", label: "Energy Added (Wh)", alwaysIncluded: false),
                DataExportColumnInfo(name: "peak_power_w", label: "Peak Power (W)", alwaysIncluded: false),
                DataExportColumnInfo(name: "cost", label: "Cost", alwaysIncluded: false)
            ]
        default:
            columns = [
                DataExportColumnInfo(name: "id", label: "ID", alwaysIncluded: true),
                DataExportColumnInfo(name: "started_at", label: "Started At", alwaysIncluded: true),
                DataExportColumnInfo(name: "distance_m", label: "Distance (m)", alwaysIncluded: false),
                DataExportColumnInfo(name: "duration_s", label: "Duration (s)", alwaysIncluded: false),
                DataExportColumnInfo(name: "efficiency_wh_per_m", label: "Efficiency (Wh/m)", alwaysIncluded: false)
            ]
        }
        return DataExportColumnsResponse(type: type.rawValue, columns: columns, supportsSelection: true)
    }

    func submitExport(_ payload: DataExportSubmitPayload) async throws -> DataExportJobSummary {
        DataExportJobSummary(
            id: UUID().uuidString,
            type: payload.type.rawValue,
            format: payload.format.rawValue,
            status: .queued,
            vehicleID: payload.vehicleID,
            createdAt: DataExportDisplay.today() + "T00:00:00Z"
        )
    }

    func useCreateAccountExport(_ payload: DataExportAccountPayload) async throws -> DataExportJobSummary {
        DataExportJobSummary(
            id: UUID().uuidString,
            type: "account",
            format: "zip",
            status: .queued,
            vehicleID: payload.vehicleID,
            createdAt: DataExportDisplay.today() + "T00:00:00Z"
        )
    }
}
