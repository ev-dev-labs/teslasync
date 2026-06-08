//
//  TemplateGallery.Telemetry.swift
//  TeslaSync — P4 feature view · 0132 · TemplateGallery (Apple)
//
//  Diagnostics seam for the P1/S11 `view.opened` contract. The TemplateGallery
//  surface reports its appearance through this protocol so production wiring,
//  previews, and tests can each supply their own sink.
//

import os

// MARK: - Diagnostics seam (P1/S11 `view.opened`)

/// Emits the `view.opened` diagnostics event for the surface. It is `Sendable`
/// (and its members non-isolated) so the view can emit from its `.task` without
/// a main-actor hop and so a default sink can be supplied as an `init` default.
/// The production app injects an adapter that forwards to the shared
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted
/// there.
public protocol TemplateGalleryTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug
/// is a static, non-identifying constant logged verbatim; no payload, VIN, or
/// location is ever recorded.
public struct OSLogTemplateGalleryTelemetry: TemplateGalleryTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}
