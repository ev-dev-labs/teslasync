import os

// MARK: - Diagnostics seam (P1/S11 `view.opened`)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The `ToolCard` view
/// reports its appearance through this protocol so production wiring, previews,
/// and tests can each supply their own sink. It is `Sendable` (and its members
/// are non-isolated) so the view can emit from its `.task` without main-actor
/// hops and so a default sink can be supplied as an `init` default argument.
public protocol ToolCardTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug
/// is a static, non-identifying constant logged verbatim; no payload, VIN, or
/// location is ever recorded.
public struct OSLogToolCardTelemetry: ToolCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}
