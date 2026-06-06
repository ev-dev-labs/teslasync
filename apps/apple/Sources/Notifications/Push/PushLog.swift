import Foundation
import os

/// Redacted push/notification diagnostics (ADR-016). Every message is passed
/// through `AuthLog.redact` before it leaves the process, so APNs device tokens,
/// auth tokens, VINs, and precise coordinates can never appear in logs, crash
/// reports, or analytics. Push diagnostics describe *state* (category, route,
/// authorization, registration outcome) — never payload contents.
public struct PushLog: Sendable {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "push") {
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

    /// A non-reversible marker for an APNs device token: reveals only that one was
    /// present and its byte length, never the bytes themselves. A hex token is two
    /// characters per byte, so the length is a non-identifying sanity surrogate.
    public static func maskToken(_ token: String?) -> String {
        guard let token, !token.isEmpty else { return "‹none›" }
        return "‹token-redacted:\(token.count / 2)B›"
    }
}
