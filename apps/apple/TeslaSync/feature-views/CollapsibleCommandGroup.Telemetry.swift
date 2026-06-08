//
//  CollapsibleCommandGroup.Telemetry.swift
//  TeslaSync — P4 feature view · 0224 · CollapsibleCommandGroup (Apple)
//
//  The P1/S11 `view.opened` diagnostics seam for the surface. The web component
//  emits no telemetry; the native surface adds the standard `view.opened` event
//  through this protocol so production wiring, previews, and tests can each
//  supply their own sink. It is `Sendable` (members non-isolated) so the view can
//  emit from its `.task` without a main-actor hop and a default sink can be passed
//  as an `init` default argument.
//

import os

// MARK: - Diagnostics seam (P1/S11 `view.opened`)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The
/// `CollapsibleCommandGroup` view reports its appearance through this protocol.
public protocol CollapsibleCommandGroupTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is
/// a static, non-identifying constant logged verbatim; no command, VIN, payload,
/// or location is ever recorded.
public struct OSLogCollapsibleCommandGroupTelemetry: CollapsibleCommandGroupTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}
