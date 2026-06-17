import Foundation
import Observation

// MARK: - Page model

/// The `@Observable` state holder the Diagnostic page binds to (ADR-004 — no networking in the
/// view). Owns the diagnostic run state (web `useRunDiagnostic` mutation state), the latest report
/// (web `data`), and the latest run error (web `error`). The `run()` async method posts to the
/// backend diagnostic endpoint; the view reads the phase + report from here and always renders a
/// populated surface (empty state when no report, loading when running, check cards when complete).
@MainActor
@Observable
public final class DiagnosticPageModel {
    public private(set) var phase: DiagnosticPhase = .idle
    public private(set) var report: DiagnosticReport?
    public private(set) var latestError: String?

    @ObservationIgnored private let dataSource: any DiagnosticDataSource

    public init(dataSource: any DiagnosticDataSource = SampleDiagnosticDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: - Actions

    /// Runs the diagnostic check (web `runDiagnostic.mutate()` / `handleRun`). Sets `phase = .running`,
    /// posts to `POST /system/diagnostic`, then sets `phase = .complete` with the report or
    /// `phase = .error` with the failure message.
    public func run() async {
        phase = .running
        latestError = nil

        do {
            let fetchedReport = try await dataSource.runDiagnostic()
            report = fetchedReport
            phase = .complete
        } catch {
            let message = error.localizedDescription
            latestError = message
            phase = .error(message)
        }
    }

    // MARK: - Derived properties

    /// Whether a diagnostic is currently running (web `isRunning === runDiagnostic.isPending`).
    public var isRunning: Bool {
        phase == .running
    }

    /// Formatted plain-text version of the report for clipboard/download (web `reportText` memo).
    public var reportText: String {
        guard let report else { return "" }
        return formatDiagnosticReportText(report)
    }

    /// Formatted JSON version of the report for clipboard (web `reportJson` memo).
    public var reportJSON: String {
        guard let report else { return "" }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(report),
              let string = String(data: data, encoding: .utf8) else {
            return ""
        }
        return string
    }
}

// MARK: - Sample data source (web hook defaults)

/// Sample data source that returns a synthetic report after a delay, for previews and tests.
public struct SampleDiagnosticDataSource: DiagnosticDataSource {
    public init() {}

    public func runDiagnostic() async throws -> DiagnosticReport {
        try await Task.sleep(for: .seconds(1.5))
        return DiagnosticReport(
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            overallStatus: .ok,
            checks: [
                DiagnosticCheck(
                    id: "db",
                    name: "Database connection",
                    status: .ok,
                    detail: "TimescaleDB responding. Connection pool healthy.",
                    remediation: nil,
                    durationMs: 42
                ),
                DiagnosticCheck(
                    id: "redis",
                    name: "Redis connection",
                    status: .ok,
                    detail: "Redis responding. Live signal cache operational.",
                    remediation: nil,
                    durationMs: 18
                ),
                DiagnosticCheck(
                    id: "mqtt",
                    name: "MQTT broker",
                    status: .warn,
                    detail: "Broker responding but high message backlog detected.",
                    remediation: "Check MQTT worker logs for processing delays.",
                    durationMs: 89
                ),
                DiagnosticCheck(
                    id: "tesla-api",
                    name: "Tesla API",
                    status: .ok,
                    detail: "Fleet API reachable. Rate limits healthy.",
                    remediation: nil,
                    durationMs: 234
                ),
                DiagnosticCheck(
                    id: "circuit-breaker",
                    name: "Circuit breaker health",
                    status: .ok,
                    detail: "All breakers closed. No cascading failures.",
                    remediation: nil,
                    durationMs: 5
                )
            ]
        )
    }
}
