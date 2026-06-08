//
//  TelemetryErrorsPanel.Model.swift
//  TeslaSync — P4 feature view · 0009 · TelemetryErrorsPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the Telemetry Errors panel. The view binds through
//  `TelemetryErrorsModel`; no networking lives in the view. The web source
//  (TelemetryErrorsPanel.tsx) is a pure presentational leaf fed by its parent
//  (FleetApiSection) — so the "source" here carries the parent's prop snapshot
//  (requested / loading / error / raw response) rather than issuing HTTP itself.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol TelemetryErrorsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogTelemetryErrorsTelemetry: TelemetryErrorsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web props from FleetApiSection)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web
/// props (`requested`, `loading`, `error`, `rawData`, `vin`). The parent's
/// extraction is reproduced natively from `response` by the projection, so the
/// extractor is exercised end-to-end rather than trusted from the caller.
public struct TelemetryErrorsInput: Sendable, Equatable {
    public var requested: Bool
    public var loading: Bool
    public var errorMessage: String?
    public var response: TelemetryJSON?
    public var vin: String

    public init(
        requested: Bool = false,
        loading: Bool = false,
        errorMessage: String? = nil,
        response: TelemetryJSON? = nil,
        vin: String = ""
    ) {
        self.requested = requested
        self.loading = loading
        self.errorMessage = errorMessage
        self.response = response
        self.vin = vin
    }
}

/// The resolved, view-ready state — the native mirror of the web component's four
/// render branches plus the leading idle branch (`!requested`).
public struct TelemetryErrorsResolved: Sendable, Equatable {
    /// The mutually-exclusive render branches (web `!requested` / `loading` /
    /// `error` / `errors.length > 0` / empty).
    public enum Phase: Sendable, Equatable {
        case idle
        case loading
        case error(String)
        case data
        case empty
    }

    public let phase: Phase
    public let rows: [TelemetryErrorRow]
    public let ok: Bool
    public let rawJSONText: String?

    public init(phase: Phase, rows: [TelemetryErrorRow], ok: Bool, rawJSONText: String?) {
        self.phase = phase
        self.rows = rows
        self.ok = ok
        self.rawJSONText = rawJSONText
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's `if (!requested) … if (loading) … if (error) … if
/// (errors.length > 0) … else` ladder, with the extractor wired in for the data /
/// empty split. Unit tested across every branch.
public enum TelemetryErrorsProjection {
    public static func resolve(_ input: TelemetryErrorsInput) -> TelemetryErrorsResolved {
        if !input.requested {
            return TelemetryErrorsResolved(phase: .idle, rows: [], ok: false, rawJSONText: nil)
        }
        if input.loading {
            return TelemetryErrorsResolved(phase: .loading, rows: [], ok: false, rawJSONText: nil)
        }
        if let message = input.errorMessage, !message.isEmpty {
            return TelemetryErrorsResolved(phase: .error(message), rows: [], ok: false, rawJSONText: nil)
        }
        let (rows, ok) = TelemetryErrorsExtractor.extract(input.response)
        if !rows.isEmpty {
            return TelemetryErrorsResolved(phase: .data, rows: rows, ok: ok, rawJSONText: nil)
        }
        // Empty: request succeeded but produced zero rows. Surface the raw response
        // only when the shape was unrecognised (web `!ok && rawData != null`).
        let hasRaw = !ok && (input.response.map { $0 != .null } ?? false)
        let rawText = hasRaw ? input.response?.prettyPrinted() : nil
        return TelemetryErrorsResolved(phase: .empty, rows: [], ok: ok, rawJSONText: rawText)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// parent tool's mutation state (the `View Errors` button); previews and tests use
/// `InMemoryTelemetryErrorsSource`. The view never talks to the network directly.
@MainActor
public protocol TelemetryErrorsSource: AnyObject {
    var onUpdate: (@MainActor (TelemetryErrorsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `TelemetryErrorsSource`,
/// recomputes the resolved projection, and exposes a render `Phase` for SwiftUI to
/// switch over.
@MainActor
@Observable
public final class TelemetryErrorsModel {
    public private(set) var phase: TelemetryErrorsResolved.Phase = .idle
    public private(set) var rows: [TelemetryErrorRow] = []
    public private(set) var ok = false
    public private(set) var rawJSONText: String?
    public private(set) var vin = ""

    @ObservationIgnored private let source: any TelemetryErrorsSource
    @ObservationIgnored private let telemetry: any TelemetryErrorsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any TelemetryErrorsSource,
        telemetry: any TelemetryErrorsTelemetry = OSLogTelemetryErrorsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// The JSON export for the "Download Errors" affordance (web download Blob).
    public var export: TelemetryErrorsExport {
        TelemetryErrorsExport.make(rows: rows, vin: vin)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TelemetryErrorsPanel.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the errors (wired to the retry affordance in the error state).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: TelemetryErrorsInput) {
        let resolved = TelemetryErrorsProjection.resolve(input)
        phase = resolved.phase
        rows = resolved.rows
        ok = resolved.ok
        rawJSONText = resolved.rawJSONText
        vin = input.vin
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTelemetryErrorsSource: TelemetryErrorsSource {
    public var onUpdate: (@MainActor (TelemetryErrorsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TelemetryErrorsInput?

    public init(initial: TelemetryErrorsInput? = nil) {
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
    public func push(_ input: TelemetryErrorsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "TelemetryErrorsPanel" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum TEStrings {
    public static let table = "TelemetryErrorsPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
