//
//  ResponseViewer.Telemetry.swift
//  TeslaSync — P4 feature view · 0041 · ResponseViewer (Apple)
//
//  The P1/S11 `view.opened` diagnostics seam and the stable surface identity for
//  the `ResponseViewer` feature view. Factored so production wiring, previews,
//  and tests can each supply their own sink, and so the slug is referenced by
//  both the view and its tests and never drifts.
//

import os

// MARK: - Surface identity

/// Stable, non-identifying identity for the `ResponseViewer` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract.
public enum ResponseViewerSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "ResponseViewer"

    /// Reports the surface becoming visible. This is the exact code path the
    /// view runs from its `.task`, factored out so it is unit-testable without a
    /// rendering host.
    public static func reportOpen(to telemetry: any ResponseViewerTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Diagnostics seam (P1/S11 `view.opened`)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The `ResponseViewer`
/// view reports its appearance through this protocol. It is `Sendable` (with
/// non-isolated members) so the view can emit from its `.task` without
/// main-actor hops and a default sink can be supplied as an `init` default.
public protocol ResponseViewerTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug
/// is a static, non-identifying constant logged verbatim; no payload, header,
/// body, VIN, or location is ever recorded.
public struct OSLogResponseViewerTelemetry: ResponseViewerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}
