import Foundation
import os

/// Redacted connection diagnostics for the live layer (ADR-016). Every message
/// is passed through `AuthLog.redact` before it leaves the process, so VINs,
/// tokens, and precise coordinates can never appear in logs — connection
/// diagnostics describe *state* (target label, phase, attempt, age), never data.
public struct LiveLog: Sendable {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "live") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func info(_ message: String) {
        logger.info("\(AuthLog.redact(message), privacy: .public)")
    }

    public func notice(_ message: String) {
        logger.notice("\(AuthLog.redact(message), privacy: .public)")
    }

    public func error(_ message: String) {
        logger.error("\(AuthLog.redact(message), privacy: .public)")
    }

    public func debug(_ message: String) {
        logger.debug("\(AuthLog.redact(message), privacy: .public)")
    }

    /// Describes a connection transition without leaking payloads: only the
    /// (non-identifying) target label, the new phase, and the retry attempt.
    public func connection(_ target: LiveStreamTarget, phase: LiveConnectionState, attempt: Int) {
        info("sse \(target.diagnosticLabel) -> \(phase) (attempt \(attempt))")
    }
}
