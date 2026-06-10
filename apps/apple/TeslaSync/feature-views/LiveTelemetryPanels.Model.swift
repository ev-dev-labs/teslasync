//
//  LiveTelemetryPanels.Model.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  Telemetry seam (P1/S11) + i18n facade (P1/S10) + the in-memory source double for the
//  Live Telemetry section — the SwiftUI parity of
//  features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx. The view binds
//  the same data the web component reads through these seams so it performs no I/O. The
//  DTOs live in LiveTelemetryPanels.State.swift and the observable model in
//  LiveTelemetryPanels.ViewModel.swift.
//

import Foundation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event. Kept SwiftUI-free so the
/// model compiles + tests on a plain host; the view re-exposes it.
public enum LiveTelemetryPanelsSurface {
    public static let slug = "LiveTelemetryPanels"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the diagnostics `view.opened` event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// diagnostics pipeline (consent-gated + redacted there).
public protocol LiveTelemetryPanelsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogLiveTelemetryPanelsTelemetry: LiveTelemetryPanelsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// Deterministic telemetry source for previews + unit/UI tests. Emits the optional initial
/// snapshot on `start`, records lifecycle calls, and can be driven manually via `push`.
@MainActor
public final class InMemoryLiveTelemetryPanelsSource: LiveTelemetryPanelsSource {
    public var onUpdate: (@MainActor (LiveTelemetryPanelsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveTelemetryPanelsUpdate?

    public init(initial: LiveTelemetryPanelsUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: LiveTelemetryPanelsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the view holds no
/// hardcoded literals. Keys live in the "LiveTelemetryPanels" table, folded into the app
/// `Localizable.xcstrings` master catalog at integration time; the per-surface table keeps
/// this prompt owning its own strings without editing the shared catalog. Foundation-only
/// so the model + adapter can resolve copy; the SwiftUI `text(_:_:)` helper lives in the
/// view file.
public enum LiveTelemetryPanelsStrings {
    public static let table = "LiveTelemetryPanels"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a format string then substitutes positional arguments (web template
    /// literals).
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        let template = string(key, fallback)
        return String(format: template, locale: Locale.current, arguments: args)
    }
}
