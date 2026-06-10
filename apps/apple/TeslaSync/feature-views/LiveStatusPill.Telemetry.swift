//
//  LiveStatusPill.Telemetry.swift
//  TeslaSync — P4 feature view · 0249 · LiveStatusPill (Apple)
//
//  Diagnostics seam for the P1/S11 `view.opened` contract. The `LiveStatusPill`
//  view reports its appearance through this protocol so production wiring,
//  previews, and tests can each supply their own sink. It is `Sendable` (and its
//  members are non-isolated) so the view can emit from its `.task` without a
//  main-actor hop and so a default sink can be supplied as an `init` default.
//

import os

// MARK: - Diagnostics seam (P1/S11 `view.opened`)

/// Diagnostics seam for the P1/S11 `view.opened` contract.
///
/// The web `LiveStatusPill` is a pure presentational component and emits nothing;
/// the native surface adds the diagnostics open-event the P1/S11 contract
/// requires of every shipped surface. The slug is a stable, non-identifying
/// constant (``LiveStatusPillSurface/slug``) — never a VIN, payload, or location.
public protocol LiveStatusPillTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug
/// is a static, non-identifying constant logged verbatim; no payload, VIN, or
/// location is ever recorded.
public struct OSLogLiveStatusPillTelemetry: LiveStatusPillTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}
