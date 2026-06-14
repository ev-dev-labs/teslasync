import Foundation
import Observation

// MARK: - Artifact status (web `GDPRArtifactStatus`)

/// The lifecycle status of a GDPR export artifact (web
/// `GDPRArtifactStatus = 'queued' | 'running' | 'complete' | 'failed' | 'expired'`).
/// Carried as a tolerant enum so an unexpected server token folds to `.unknown`
/// instead of failing decode — mirroring the sibling Disk Forecast severity model's
/// "raw string" robustness strategy. The raw token is rendered verbatim in the badge
/// exactly like the web `{artifact.status}`.
public enum GDPRArtifactStatus: String, CaseIterable, Sendable, Equatable {
    case queued
    case running
    case complete
    case failed
    case expired
    case unknown

    /// Folds a raw wire token onto the canonical status (unknown tokens → `.unknown`).
    public init(wire: String) {
        self = GDPRArtifactStatus(rawValue: wire) ?? .unknown
    }

    /// Web `STATUS_VARIANT` → shared status tone: queued/running → info,
    /// complete → success, failed → danger, expired → warning, else neutral.
    public var tone: TSTone {
        switch self {
        case .queued, .running: .info
        case .complete: .success
        case .failed: .danger
        case .expired: .warning
        case .unknown: .neutral
        }
    }
}

// MARK: - Wire value type (web `GDPRExportArtifact`)

/// A single GDPR export artifact — the native peer of the web `GDPRExportArtifact`
/// (GET `/admin/gdpr/exports/{id}`). Field names mirror the wire (snake_case JSON)
/// 1:1 through camelCase Swift names so the production KMP-backed binding maps
/// straight across. Byte counts / timestamps are admin control-plane values (not
/// SI-unit-bearing), formatted only at the display boundary.
public struct GDPRExportArtifact: Identifiable, Equatable, Sendable {
    public let id: String
    public let userID: String?
    public let status: GDPRArtifactStatus
    public let format: String
    public let bytes: Int64?
    public let sha256: String?
    public let storage: String?
    public let createdAt: String
    public let completedAt: String?
    public let expiresAt: String?
    public let error: String?

    public init(
        id: String,
        userID: String? = nil,
        status: GDPRArtifactStatus,
        format: String,
        bytes: Int64? = nil,
        sha256: String? = nil,
        storage: String? = nil,
        createdAt: String,
        completedAt: String? = nil,
        expiresAt: String? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.userID = userID
        self.status = status
        self.format = format
        self.bytes = bytes
        self.sha256 = sha256
        self.storage = storage
        self.createdAt = createdAt
        self.completedAt = completedAt
        self.expiresAt = expiresAt
        self.error = error
    }
}

// MARK: - Data source seam (web `useGDPRExport`, GET /admin/gdpr/exports/{id})

/// Thrown when the deployment lacks the GDPR export subsystem — the native peer of
/// the web `query.error.status === 503` (`subsystemMissing`) branch that surfaces the
/// "subsystem unavailable" banner. Distinct from a generic failure so the page can
/// reproduce the dedicated not-configured affordance.
public struct GDPRSubsystemUnavailable: Error {
    public init() {}
}

/// Thrown when no artifact exists for the requested id — the native peer of the web
/// `query.error.status === 404` (`notFound`) branch that surfaces the "Artifact not
/// found" banner.
public struct GDPRArtifactNotFound: Error {
    public init() {}
}

/// Supplies the artifact the page renders for a given id. The production implementation
/// binds the shared KMP `OperatorConfidenceStore.gdprExport(id)` feed (ADR-004 — the
/// view holds no networking); previews and tests inject doubles to drive the
/// loading / success / not-found / unavailable / error states.
public protocol GDPRExportDataSource: Sendable {
    func load(id: String) async throws -> GDPRExportArtifact
}

/// A representative local seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production data — it exists so the
/// surface renders its populated state out of the box (mirroring the sibling Disk
/// Forecast `SampleDiskForecastDataSource`). Production replaces it with the
/// `OperatorConfidenceStore.gdprExport(id)` adapter.
public struct SampleGDPRExportDataSource: GDPRExportDataSource {
    /// The id the route registration seeds so the populated state shows by default.
    public static let sampleID = "8f4c2b9e-7a1d-4e6f-9c3a-2b5d8e1f0a4c"

    public init() {}

    public func load(id: String) async throws -> GDPRExportArtifact {
        GDPRExportArtifact(
            id: id.isEmpty ? Self.sampleID : id,
            userID: "user_01HGW3",
            status: .complete,
            format: "zip",
            bytes: 48_318_382,
            sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
            storage: "s3",
            createdAt: "2026-06-12T17:04:00Z",
            completedAt: "2026-06-12T17:06:30Z",
            expiresAt: "2026-06-19T17:06:30Z",
            error: nil
        )
    }
}

// MARK: - Page state (web PageContainer query phases + activeId gating)

/// The page's data state for the artifact lookup. `.idle` is the pre-lookup empty
/// state (web `!activeId` → "No artifact selected"); `.loading` is an in-flight poll;
/// `.loaded` carries the artifact (success); `.notFound` is the 404 branch; `.unavailable`
/// is the 503 subsystem-missing branch; `.error` is a generic retryable failure.
public enum GDPRExportState: Equatable, Sendable {
    case idle
    case loading
    case loaded(GDPRExportArtifact)
    case notFound
    case unavailable
    case error(String)
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the lookup input + active id + load state, and derives the display
/// guards (download availability, banners) from it, reading the artifact through the
/// injected `GDPRExportDataSource` seam.
@MainActor
@Observable
public final class GDPRExportPageModel {
    /// The text-field contents (web `idInput`).
    public var idInput: String

    /// The submitted id currently being looked up (web `activeId`).
    public private(set) var activeId: String

    public private(set) var state: GDPRExportState

    /// Backend origin used to build the binary download URL at the display boundary
    /// (web resolves the relative `/api/v1/...` href against the page origin). Defaults
    /// to the documented local dev origin; production injects the bootstrapped base.
    @ObservationIgnored public let apiBaseURL: URL

    @ObservationIgnored private let dataSource: any GDPRExportDataSource

    public init(
        dataSource: any GDPRExportDataSource = SampleGDPRExportDataSource(),
        initialID: String = "",
        apiBaseURL: URL = URL(string: "http://localhost:8080")!
    ) {
        self.dataSource = dataSource
        self.apiBaseURL = apiBaseURL
        let trimmed = initialID.trimmingCharacters(in: .whitespacesAndNewlines)
        idInput = trimmed
        activeId = trimmed
        state = trimmed.isEmpty ? .idle : .loading
    }

    // MARK: Derived display guards

    /// The loaded artifact (nil unless the state is `.loaded`).
    public var artifact: GDPRExportArtifact? {
        if case let .loaded(artifact) = state { return artifact }
        return nil
    }

    /// Whether a lookup has been submitted (web `activeId` truthiness — gates the
    /// "No artifact selected" empty panel).
    public var hasActiveLookup: Bool {
        !activeId.isEmpty
    }

    /// Whether the subsystem-unavailable banner shows (web `subsystemMissing`, 503).
    public var isSubsystemUnavailable: Bool {
        state == .unavailable
    }

    /// Whether the not-found banner shows (web `notFound`, 404).
    public var isNotFound: Bool {
        state == .notFound
    }

    /// Whether the "Look up" button is enabled (web `disabled={!idInput.trim()}`).
    public var canLookup: Bool {
        !idInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Whether the download affordance is active — web builds `downloadUrl` only when
    /// `artifact.status === 'complete'`.
    public var canDownload: Bool {
        artifact?.status == .complete
    }

    /// The set `encodeURIComponent` leaves un-escaped (`ALPHA / DIGIT / - _ . ! ~ * ' ( )`),
    /// so the native href matches the web `encodeURIComponent(artifact.id)` exactly.
    private static let uriComponentAllowed: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-_.!~*'()")
        return set
    }()

    /// The relative binary-stream href (web `downloadUrl`) when complete, else nil.
    /// Exactly mirrors `/api/v1/admin/gdpr/exports/{id}/download` with the id escaped
    /// like the web `encodeURIComponent(artifact.id)`.
    public var downloadHref: String? {
        guard let artifact, artifact.status == .complete else { return nil }
        let encoded = artifact.id
            .addingPercentEncoding(withAllowedCharacters: Self.uriComponentAllowed) ?? artifact.id
        return "/api/v1/admin/gdpr/exports/\(encoded)/download"
    }

    /// The absolute download URL the native button opens (web `<a href>` resolved
    /// against the origin) — nil unless the artifact is complete.
    public var downloadURL: URL? {
        guard let href = downloadHref else { return nil }
        return URL(string: href, relativeTo: apiBaseURL)?.absoluteURL
    }

    /// The reason key shown when no download is available (web ternary on status):
    /// queued/running → wait, expired → expired, else → failed.
    public var downloadUnavailableKey: String {
        switch artifact?.status {
        case .queued, .running: "admin.gdprExport.downloadWait"
        case .expired: "admin.gdprExport.downloadExpired"
        default: "admin.gdprExport.downloadFailed"
        }
    }

    // MARK: Intents

    /// Submits the typed id as the active lookup and loads it (web `handleLookup`).
    public func lookup() async {
        let trimmed = idInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        activeId = trimmed
        await load()
    }

    /// Loads the active id if one is set, resolving the terminal state. No-ops when
    /// there is no active lookup (web query `enabled: Boolean(id)`).
    public func load() async {
        guard !activeId.isEmpty else {
            state = .idle
            return
        }
        state = .loading
        do {
            let artifact = try await dataSource.load(id: activeId)
            state = .loaded(artifact)
        } catch is GDPRArtifactNotFound {
            state = .notFound
        } catch is GDPRSubsystemUnavailable {
            state = .unavailable
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Loads on first appearance when an id was seeded but not yet resolved
    /// (web `useGDPRExport(activeId)` auto-fetch). Idempotent for already-loaded state.
    public func loadIfNeeded() async {
        guard hasActiveLookup else { return }
        if case .loaded = state { return }
        await load()
    }

    /// Re-runs the active lookup (web error-retry / poll refetch).
    public func refresh() async {
        await load()
    }
}

// MARK: - Display-boundary formatters (web `formatBytes` / `formatDateTime` / `formatRelative`)

/// Pure, testable display formatters ported from `web/src/lib/numberFormat.ts` and
/// `web/src/lib/dateFormat.ts`. Byte counts use binary units (1024) labelled KB/MB/GB
/// exactly as the web `formatBytes`; dates render medium date + short time and the
/// relative phrase matches the web `formatRelative` thresholds. No SI conversion
/// applies — these are unit-agnostic control-plane values.
public enum GDPRExportFormat {
    /// The em-dash shown for nil / unrenderable values (web universal `'—'`).
    public static let emptyValue = "—"

    /// Web `formatBytes(bytes)`: binary units, 1 decimal for KB/MB/GB, `—` for
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

    /// Web `formatDateTime`: "Apr 4, 2026, 2:30 AM" (medium date + short time) in the
    /// user's locale; `—` for nil / unparseable input.
    public static func dateTime(_ iso: String?) -> String {
        guard let date = parseISO(iso) else { return emptyValue }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Web `formatRelative`: "just now" (<60s), "Nm ago" (<60m), "Nh ago" (<24h),
    /// "Nd ago" (<7d), else the medium date; `—` for nil / unparseable input.
    public static func relative(_ iso: String?, now: Date = Date()) -> String {
        guard let date = parseISO(iso) else { return emptyValue }
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        return date.formatted(date: .abbreviated, time: .omitted)
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
