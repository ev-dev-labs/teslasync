//
//  DataExportPreviewSources.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — Preview seams
//
//  DEBUG-only `DataExportDataSource` doubles that drive the empty and error states
//  in SwiftUI previews (the sample source drives the populated state). Not compiled
//  into release builds.
//

#if DEBUG
    import Foundation

    /// Returns zero jobs / vehicles (drives the `.empty` feed state).
    struct EmptyDataExportDataSource: DataExportDataSource {
        func loadJobs() async throws -> [DataExportJobSummary] { [] }
        func loadVehicles() async throws -> [DataExportVehicle] { [] }
        func useExportColumns(_: DataExportType) async throws -> DataExportColumnsResponse? { nil }

        func submitExport(_ payload: DataExportSubmitPayload) async throws -> DataExportJobSummary {
            DataExportJobSummary(
                id: UUID().uuidString,
                type: payload.type.rawValue,
                format: payload.format.rawValue,
                status: .queued,
                createdAt: DataExportDisplay.today() + "T00:00:00Z"
            )
        }

        func useCreateAccountExport(_: DataExportAccountPayload) async throws -> DataExportJobSummary {
            DataExportJobSummary(
                id: UUID().uuidString,
                type: "account",
                format: "zip",
                status: .queued,
                createdAt: DataExportDisplay.today() + "T00:00:00Z"
            )
        }
    }

    /// Fails every read (drives the `.error` feed state).
    struct FailingDataExportDataSource: DataExportDataSource {
        struct Failure: LocalizedError {
            var errorDescription: String? { "Preview failure" }
        }

        func loadJobs() async throws -> [DataExportJobSummary] { throw Failure() }
        func loadVehicles() async throws -> [DataExportVehicle] { throw Failure() }
        func useExportColumns(_: DataExportType) async throws -> DataExportColumnsResponse? { throw Failure() }
        func submitExport(_: DataExportSubmitPayload) async throws -> DataExportJobSummary { throw Failure() }

        func useCreateAccountExport(_: DataExportAccountPayload) async throws -> DataExportJobSummary {
            throw Failure()
        }
    }
#endif
