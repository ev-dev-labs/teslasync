import Foundation

// MARK: - API types (match web src/api/types.ts)

/// Status of a single diagnostic check (web `DiagnosticCheckStatus`).
public enum DiagnosticCheckStatus: String, Codable, Sendable {
    case ok, warn, fail
}

/// Overall system health status (web `DiagnosticOverallStatus`).
public enum DiagnosticOverallStatus: String, Codable, Sendable {
    case ok, degraded, down
}

/// A single diagnostic check result (web `DiagnosticCheck`).
public struct DiagnosticCheck: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let status: DiagnosticCheckStatus
    public let detail: String
    public let remediation: String?
    public let durationMs: Int

    enum CodingKeys: String, CodingKey {
        case id, name, status, detail, remediation
        case durationMs = "duration_ms"
    }

    public init(
        id: String,
        name: String,
        status: DiagnosticCheckStatus,
        detail: String,
        remediation: String?,
        durationMs: Int
    ) {
        self.id = id
        self.name = name
        self.status = status
        self.detail = detail
        self.remediation = remediation
        self.durationMs = durationMs
    }
}

/// Complete diagnostic report (web `DiagnosticReport`).
public struct DiagnosticReport: Codable, Hashable, Sendable {
    public let generatedAt: String
    public let overallStatus: DiagnosticOverallStatus
    public let checks: [DiagnosticCheck]

    enum CodingKeys: String, CodingKey {
        case generatedAt = "generated_at"
        case overallStatus = "overall_status"
        case checks
    }

    public init(generatedAt: String, overallStatus: DiagnosticOverallStatus, checks: [DiagnosticCheck]) {
        self.generatedAt = generatedAt
        self.overallStatus = overallStatus
        self.checks = checks
    }
}

// MARK: - Data source seam (web hooks: useRunDiagnostic, formatDiagnosticReportText)

/// Supplies every datum the Diagnostic page renders. The production implementation posts to the
/// backend diagnostic endpoint (web `POST /system/diagnostic` via `useRunDiagnostic`); previews and
/// tests inject doubles.
///
/// Method ↔ web hook map:
/// `runDiagnostic` ← `useRunDiagnostic().mutate()` → `POST /system/diagnostic`.
public protocol DiagnosticDataSource: Sendable {
    func runDiagnostic() async throws -> DiagnosticReport
}

// MARK: - Page phase (web mutation states: idle, isPending, data, error)

/// The page's diagnostic run state, mirroring the web mutation phases (web `useRunDiagnostic`
/// returns `isPending` / `data` / `error`).
public enum DiagnosticPhase: Equatable, Sendable {
    case idle           // No report yet (web `data === undefined`)
    case running        // Diagnostic in progress (web `isPending === true`)
    case complete       // Report available (web `data !== undefined`)
    case error(String)  // Diagnostic failed (web `error !== undefined`)
}
