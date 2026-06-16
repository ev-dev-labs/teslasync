import Foundation

// MARK: - Job status (web `ExportJobSummary['status']`)

/// The lifecycle status of an export job (web
/// `'queued' | 'processing' | 'ready' | 'failed' | 'expired'`). Carried as a tolerant
/// enum so an unexpected server token folds to `.unknown` instead of failing decode
/// (mirroring the sibling `GDPRArtifactStatus` robustness strategy). The original wire
/// token is preserved on `ExportJobSummary.rawStatus` so an unknown status still renders
/// verbatim — exactly like the web `t('exportsList.status.${status}', status)` fallback.
public enum ExportsJobStatus: String, CaseIterable, Sendable, Equatable {
    case queued
    case processing
    case ready
    case failed
    case expired
    case unknown

    /// Folds a raw wire token onto the canonical status (unknown tokens → `.unknown`).
    public init(wire: String) {
        self = ExportsJobStatus(rawValue: wire) ?? .unknown
    }

    /// Web `statusVariant`: ready → success, failed → danger, processing/queued → info,
    /// expired (and unknown) → neutral.
    public var tone: TSTone {
        switch self {
        case .ready: .success
        case .failed: .danger
        case .processing, .queued: .info
        case .expired, .unknown: .neutral
        }
    }
}

// MARK: - Wire value type (web `ExportJobSummary`)

/// A single export-job summary — the native peer of the web `ExportJobSummary`
/// (`GET /export/jobs`). Field names mirror the wire (snake_case JSON) 1:1 through
/// camelCase Swift names so the production KMP-backed binding maps straight across.
/// Byte counts / timestamps are control-plane values (not SI-unit-bearing) and are
/// formatted only at the display boundary by `ExportsFormat`.
public struct ExportJobSummary: Identifiable, Equatable, Sendable {
    public let id: String
    public let type: String
    public let format: String
    public let status: ExportsJobStatus
    /// The raw status token as received (web renders it verbatim when no label key
    /// exists). Defaults to the canonical status' rawValue for the known cases.
    public let rawStatus: String
    public let vehicleID: Int64?
    public let fileName: String?
    public let fileSize: Int64?
    public let recordCount: Int?
    public let errorMessage: String?
    public let durationMs: Int?
    public let createdAt: String
    public let completedAt: String?

    public init(
        id: String,
        type: String,
        format: String,
        status: ExportsJobStatus,
        rawStatus: String? = nil,
        vehicleID: Int64? = nil,
        fileName: String? = nil,
        fileSize: Int64? = nil,
        recordCount: Int? = nil,
        errorMessage: String? = nil,
        durationMs: Int? = nil,
        createdAt: String,
        completedAt: String? = nil
    ) {
        self.id = id
        self.type = type
        self.format = format
        self.status = status
        self.rawStatus = rawStatus ?? status.rawValue
        self.vehicleID = vehicleID
        self.fileName = fileName
        self.fileSize = fileSize
        self.recordCount = recordCount
        self.errorMessage = errorMessage
        self.durationMs = durationMs
        self.createdAt = createdAt
        self.completedAt = completedAt
    }

    /// Whether the job exposes a download affordance (web `j.status === 'ready'`).
    public var isDownloadable: Bool {
        status == .ready
    }
}

// MARK: - Bulk-delete report (web `ExportBulkResult`)

/// One failed deletion in a bulk operation (web `{ id, reason }`).
public struct ExportBulkFailure: Equatable, Sendable {
    public let id: String
    public let reason: String

    public init(id: String, reason: String) {
        self.id = id
        self.reason = reason
    }
}

/// The server report for a bulk delete (web `ExportBulkResult` —
/// `{ deleted: number, failed: { id, reason }[] }`). Returned so a future
/// partial-success UI can surface the failures; the current page mirrors the web by
/// optimistically dropping the deleted rows and clearing the selection.
public struct ExportBulkResult: Equatable, Sendable {
    public let deleted: Int
    public let failed: [ExportBulkFailure]

    public init(deleted: Int, failed: [ExportBulkFailure] = []) {
        self.deleted = deleted
        self.failed = failed
    }
}

// MARK: - Data source seam (web `useExportJobs` / `useBulkExportsDelete`)

/// Supplies the export jobs the page renders and performs the bulk delete. The
/// production implementation binds the shared KMP repositories/use-cases (ADR-004 — the
/// view holds no networking); previews and tests inject doubles to drive the
/// loading / empty / error / success states.
///
/// Method ↔ web hook map:
/// `loadJobs` ← `useExportJobs` → `GET /export/jobs`;
/// `bulkDelete` ← `useBulkExportsDelete` → `POST /export/jobs/bulk`.
public protocol ExportsDataSource: Sendable {
    func loadJobs() async throws -> [ExportJobSummary]
    func bulkDelete(ids: [String]) async throws -> ExportBulkResult
}

/// A representative local seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production data — it exists so the
/// surface renders its populated state out of the box (mirroring the sibling
/// `SampleGDPRExportDataSource`). Production replaces it with the shared-core adapter.
public struct SampleExportsDataSource: ExportsDataSource {
    public init() {}

    public func loadJobs() async throws -> [ExportJobSummary] {
        [
            ExportJobSummary(
                id: "8f4c2b9e-7a1d-4e6f-9c3a-2b5d8e1f0a4c",
                type: "drives",
                format: "csv",
                status: .ready,
                fileSize: 2_415_919,
                recordCount: 1284,
                createdAt: "2026-06-14T09:12:00Z",
                completedAt: "2026-06-14T09:12:40Z"
            ),
            ExportJobSummary(
                id: "1b9d3f70-5c2a-4d18-9f6b-0a7e4c2d1e83",
                type: "charging",
                format: "json",
                status: .processing,
                createdAt: "2026-06-14T09:30:00Z"
            ),
            ExportJobSummary(
                id: "c5e8a042-6f31-4b7c-8d29-3e1f0a6b4c2d",
                type: "account",
                format: "zip",
                status: .failed,
                errorMessage: "storage backend unavailable",
                createdAt: "2026-06-13T18:05:00Z"
            ),
            ExportJobSummary(
                id: "2d7f6a18-9b04-4e3c-a1d8-5c2b7e0f3a91",
                type: "analytics",
                format: "csv",
                status: .expired,
                fileSize: 51200,
                createdAt: "2026-06-01T11:45:00Z",
                completedAt: "2026-06-01T11:46:10Z"
            )
        ]
    }

    public func bulkDelete(ids: [String]) async throws -> ExportBulkResult {
        ExportBulkResult(deleted: ids.count)
    }
}

// MARK: - Download URL (web `exportDownloadUrl`)

/// Builds the relative href the client hits to download a finished export-job artifact —
/// the native peer of the web `exportDownloadUrl(jobId)`
/// (`/api/v1/export/jobs/${jobId}/download`). The id is a server UUID, so — like the web —
/// it is interpolated verbatim without percent-encoding.
public func exportDownloadUrl(_ jobID: String) -> String {
    "/api/v1/export/jobs/\(jobID)/download"
}

// MARK: - Display-boundary formatters (web `formatBytes` / `formatDateTime`)

/// Pure, testable display formatters ported from `web/src/lib/numberFormat.ts`
/// (`formatBytes`) and `web/src/lib/dateFormat.ts` (`formatDateTime`). Byte counts use
/// binary units (1024) labelled B/KB/MB/GB exactly as the web; dates render medium date
/// + short time in the user's locale. No SI conversion applies — these are unit-agnostic
/// control-plane values.
public enum ExportsFormat {
    /// The em-dash shown for nil / unrenderable values (web universal `'—'`).
    public static let emptyValue = "—"

    /// Web `formatBytes(bytes)`: `<n> B` below 1 KiB, then 1-decimal KB/MB/GB; `—` for
    /// nil / non-finite.
    public static func bytes(_ value: Double?) -> String {
        guard let value, value.isFinite else { return emptyValue }
        if value < 1024 { return "\(wholeOrDecimal(value)) B" }
        if value < 1024 * 1024 { return String(format: "%.1f KB", value / 1024) }
        if value < 1024 * 1024 * 1024 { return String(format: "%.1f MB", value / (1024 * 1024)) }
        return String(format: "%.1f GB", value / (1024 * 1024 * 1024))
    }

    /// Convenience for the optional `Int64` byte field.
    public static func bytes(_ value: Int64?) -> String {
        guard let value else { return emptyValue }
        return bytes(Double(value))
    }

    /// Web `formatDateTime`: "Jun 14, 2026, 9:12 AM" (medium date + short time) in the
    /// user's locale; `—` for nil / unparseable input.
    public static func dateTime(_ iso: String?) -> String {
        guard let date = parseISO(iso) else { return emptyValue }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Web `String(format).toUpperCase()` for the format column (e.g. `csv` → `CSV`).
    public static func upper(_ value: String) -> String {
        value.uppercased()
    }

    /// Parses a backend ISO-8601 UTC timestamp (web `new Date(iso)`), tolerating the
    /// fractional-seconds variant; returns nil for nil / malformed input.
    static func parseISO(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// JS `String(n)`: integral values render without a trailing decimal.
    private static func wholeOrDecimal(_ value: Double) -> String {
        value == value.rounded() ? String(Int64(value)) : String(value)
    }
}
