import Foundation
import os

/// The single sanctioned auth logger. Every message is passed through `redact`
/// before it leaves the process, so tokens, VINs, and precise coordinates can
/// never appear in logs, crash reports, or analytics (ADR-016).
public struct AuthLog: Sendable {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "auth") {
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

    // MARK: - Redaction

    private static let vinPattern = "\\b[A-HJ-NPR-Z0-9]{17}\\b"
    private static let coordinatePattern = "[-+]?\\d{1,3}\\.\\d{4,}"
    private static let secretPattern = "\\b[A-Za-z0-9._-]{32,}\\b"
    private static let sensitiveQueryItems: Set<String> = [
        "code", "state", "access_token", "refresh_token", "id_token", "token",
        "id_token_hint", "code_verifier", "client_secret"
    ]

    /// Masks VINs, high-precision coordinates, and long secret-looking strings
    /// (JWTs, access/refresh tokens, PKCE verifiers) in free-form text.
    public static func redact(_ message: String) -> String {
        var output = message
        output = replacingMatches(output, pattern: vinPattern, with: "‹vin-redacted›")
        output = replacingMatches(output, pattern: coordinatePattern, with: "‹geo-redacted›")
        output = replacingMatches(output, pattern: secretPattern, with: "‹redacted›")
        return output
    }

    private static func replacingMatches(_ input: String, pattern: String, with replacement: String) -> String {
        guard let regex = try? Regex(pattern) else { return input }
        return input.replacing(regex, with: replacement)
    }

    /// A non-reversible marker for a token that reveals only that one was present.
    public static func redactToken(_ token: String?) -> String {
        token == nil ? "‹none›" : "‹redacted›"
    }

    /// Strips sensitive values from a URL's query (e.g. the `code`/`state` on an
    /// OIDC redirect) so a callback URL can be logged for diagnostics safely.
    public static func redactURL(_ url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return "‹url-redacted›"
        }
        if let items = components.queryItems {
            components.queryItems = items.map { item in
                sensitiveQueryItems.contains(item.name.lowercased())
                    ? URLQueryItem(name: item.name, value: "‹redacted›")
                    : item
            }
        }
        components.fragment = components.fragment.map { _ in "‹redacted›" }
        return redact(components.string ?? "‹url-redacted›")
    }
}
