//
//  DataPipelineSection.Adapter.swift
//  TeslaSync — P4 feature view · 0242 · DataPipelineSection (Apple)
//
//  The testable, dependency-free projection core for the dev-tools Data Pipeline
//  surface — the SwiftUI parity of
//  features/system/components/status/DataPipelineSection.tsx plus the web helpers it
//  is fed by: `fmtInt` / `fmtPercent` (lib/numberFormat.ts), `formatDateTime`
//  (lib/dateFormat.ts), and `formatBytes` / `statusTextClass` / `getStatusIcon`
//  (the sibling status `helpers.tsx`). Everything here is pure (no store, no bundle,
//  no rendered view) so the compression / export-job models, the status
//  classification, the locale number / percent / byte / date formatting, and the
//  job-queue counts are all unit tested in isolation.
//
//  Parity note: the byte ladder reproduces the web `formatBytes` arithmetic verbatim
//  (1024-based, one decimal, B…TB). The numbers carried here are unit-free upstream
//  values (position counts, byte estimates, saved percentages) — no SI conversion
//  applies, the surface is a presentational dev-tools panel.
//

import Foundation

// MARK: - Compression model (web `CompressionStats` — the fields this surface renders)

/// One compression-statistics snapshot — the native mirror of the web
/// `CompressionStats`, narrowed to the four values the panel renders (the savings
/// percentage, the estimated saved bytes, and the total / compressed position
/// counts). Values are carried as the raw upstream numbers.
public struct CompressionSnapshot: Equatable, Sendable {
    public var savingsPercent: Double
    public var estimatedSavedBytes: Double
    public var totalPositions: Double
    public var compressedPositions: Double

    public init(
        savingsPercent: Double = 0,
        estimatedSavedBytes: Double = 0,
        totalPositions: Double = 0,
        compressedPositions: Double = 0
    ) {
        self.savingsPercent = savingsPercent
        self.estimatedSavedBytes = estimatedSavedBytes
        self.totalPositions = totalPositions
        self.compressedPositions = compressedPositions
    }
}

// MARK: - Export-job model (web `ExportJobSummary` — the fields this surface renders)

/// One export-job row — the native mirror of the web `ExportJobSummary`, narrowed to
/// the columns the queue table renders (status · type · format · file · records ·
/// created). `createdAt` is a `Date?` so the view formats it through
/// `DataPipelineFormat.dateTime` (the web `formatDateTime` em-dash branch covers a
/// missing/invalid timestamp).
public struct ExportJobItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let type: String
    public let format: String
    public let status: String
    public let fileName: String
    public let recordCount: Double
    public let createdAt: Date?

    public init(
        id: String,
        type: String,
        format: String,
        status: String,
        fileName: String,
        recordCount: Double,
        createdAt: Date?
    ) {
        self.id = id
        self.type = type
        self.format = format
        self.status = status
        self.fileName = fileName
        self.recordCount = recordCount
        self.createdAt = createdAt
    }

    /// The classified status (drives the row icon + accent), web `getStatusIcon`.
    public var statusKind: DataPipelineStatusKind {
        DataPipelineStatusKind(raw: status)
    }
}

// MARK: - Status classification (web `helpers.tsx` status colour / icon / variant)

/// The semantic tone a status maps to — the native, view-free mirror of the web
/// `statusToBadgeVariant` / `statusTextClass`. The view maps this to the shared
/// `TSTone` colour tokens so no raw hex lives here.
public enum DataPipelineTone: String, Sendable, Equatable, CaseIterable {
    case neutral
    case success
    case warning
    case danger
    case info
}

/// The export-job lifecycle states the web source filters on (queued / processing /
/// ready / failed) plus an `unknown` fallback for any other server value. Carries the
/// tone, the SF Symbol, and the i18n key/fallback so the view renders the status
/// without re-deriving any of it (web `getStatusIcon` + `statusTextClass`).
public enum DataPipelineStatusKind: String, Sendable, Equatable, CaseIterable {
    case queued
    case processing
    case ready
    case failed
    case unknown

    /// Classifies a raw server status (case-insensitive), web `(status ?? '').toLowerCase()`.
    public init(raw: String) {
        switch raw.lowercased() {
        case "queued": self = .queued
        case "processing": self = .processing
        case "ready": self = .ready
        case "failed": self = .failed
        default: self = .unknown
        }
    }

    /// The badge / text tone, web `statusToBadgeVariant`.
    public var tone: DataPipelineTone {
        switch self {
        case .ready: .success
        case .queued, .processing: .warning
        case .failed: .danger
        case .unknown: .neutral
        }
    }

    /// The status SF Symbol, web `getStatusIcon` (check / triangle / xmark).
    public var symbolName: String {
        switch tone {
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .danger: "xmark.circle.fill"
        case .neutral, .info: "exclamationmark.triangle.fill"
        }
    }

    /// The localization key for the status label (empty for `unknown` — the view then
    /// renders the raw server value verbatim, matching the web `{row.status}`).
    public var labelKey: String {
        switch self {
        case .queued: "status.queued"
        case .processing: "status.processing"
        case .ready: "status.ready"
        case .failed: "status.failed"
        case .unknown: ""
        }
    }

    /// The English fallback for the status label (web hardcodes the raw lowercase
    /// value; the native chrome title-cases the known states for polish).
    public var labelFallback: String {
        switch self {
        case .queued: "Queued"
        case .processing: "Processing"
        case .ready: "Ready"
        case .failed: "Failed"
        case .unknown: ""
        }
    }
}

// MARK: - Number / byte / date formatting (ports of numberFormat.ts + dateFormat.ts)

/// Pure number, percent, integer, byte, and date formatting ported from the web
/// helpers so the rounding, the grouping separators, the 1024-byte ladder, and the
/// em-dash sentinels match the source exactly. The web global precision is 2 and
/// `safeNumber` coerces non-finite input to 0; both are reproduced here.
public enum DataPipelineFormat {
    /// The em-dash sentinel the web renders for a missing/non-applicable value.
    public static let dash = "—"

    /// The web byte-ladder unit labels (`formatBytes` `sizes`).
    static let byteUnits = ["B", "KB", "MB", "GB", "TB"]

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction
    /// digits, half-away rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `fmtPercent(v)` — `fmtNumber(v)` with a trailing `%`.
    public static func percent(_ value: Double, locale: Locale = .current) -> String {
        number(value, locale: locale) + "%"
    }

    /// Native port of `fmtInt(v)` — `fmtNumber(v, 0)` (locale grouping, no decimals).
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// Native port of `formatBytes(bytes)` (helpers.tsx): `0 B` for non-positive /
    /// non-finite input, otherwise the 1024-based ladder with a one-decimal value and
    /// the matching `B…TB` unit (clamped to the unit table).
    public static func bytes(_ value: Double, locale: Locale = .current) -> String {
        guard value.isFinite, value > 0 else { return "0 \(byteUnits[0])" }
        let exponent = Int((log(value) / log(1024)).rounded(.down))
        let index = min(max(exponent, 0), byteUnits.count - 1)
        let scaled = value / pow(1024, Double(index))
        return "\(number(scaled, decimals: 1, locale: locale)) \(byteUnits[index])"
    }

    /// Native port of `formatDateTime(iso)` (dateFormat.ts): the em-dash fallback for a
    /// missing date, otherwise a locale-ordered "MMM d, yyyy, h:mm a"-style rendering
    /// (the web `month:'short', day:'numeric', year:'numeric', hour/minute:'2-digit'`).
    public static func dateTime(
        _ date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return formatter.string(from: date)
    }
}

// MARK: - Job-queue counts (web `exportJobs.filter((j) => j.status === …).length`)

/// The four status tallies the web source derives plus the combined "active" count
/// (pending + processing) the header badge reads — a pure function of the job list.
public struct DataPipelineCounts: Equatable, Sendable {
    public var pending: Int
    public var processing: Int
    public var completed: Int
    public var failed: Int

    public init(pending: Int = 0, processing: Int = 0, completed: Int = 0, failed: Int = 0) {
        self.pending = pending
        self.processing = processing
        self.completed = completed
        self.failed = failed
    }

    /// Web `pendingJobs + processingJobs` — the header "N active" badge count.
    public var active: Int {
        pending + processing
    }

    /// Tallies a job list by status (web `queued`/`processing`/`ready`/`failed`).
    public static func tally(_ jobs: [ExportJobItem]) -> DataPipelineCounts {
        var counts = DataPipelineCounts()
        for job in jobs {
            switch job.statusKind {
            case .queued: counts.pending += 1
            case .processing: counts.processing += 1
            case .ready: counts.completed += 1
            case .failed: counts.failed += 1
            case .unknown: break
            }
        }
        return counts
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Pure builders for the VoiceOver strings the views attach, composed from
/// already-localised parts so the spoken content is asserted without a rendered view.
public enum DataPipelineAccessibility {
    /// The per-row spoken label: "{status}, {type}, {records} records, {created}".
    public static func rowLabel(status: String, type: String, records: String, created: String) -> String {
        "\(status), \(type), \(records), \(created)"
    }

    /// The compression-summary spoken label: "{ratio} saved, {savings}".
    public static func compressionLabel(ratio: String, savings: String) -> String {
        "\(ratio), \(savings)"
    }
}
