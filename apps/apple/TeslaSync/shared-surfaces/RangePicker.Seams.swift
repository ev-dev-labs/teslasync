//
//  RangePicker.Seams.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  The dependency seams the ``RangePickerModel`` binds through, kept apart from the model for the SwiftLint
//  file-length budget: the P1/S11 telemetry seam (the `view.opened` sink), the P4 render phase, the snapshot
//  the page pushes (the web `value` + props + the in-flight/error/connectivity axis), the P1/S8 read source
//  seam, the production closure-free source, and the in-memory source for previews + tests. The view never
//  reads the source directly — it goes through the model, which goes through these seams. No networking.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter forwarding to the consent-gated shared-core diagnostics sink.
public protocol RangePickerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogRangePickerTelemetry: RangePickerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Phase + snapshot (P4 leaf contract)

/// The render phase (web has only `content`; the rest are the P4 always-render leaf states).
public enum RangePickerPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The page's current picker state pushed through the source — the props (`input`), the in-flight/error
/// flags, and the connectivity axis.
public struct RangePickerSnapshot: Sendable, Equatable {
    public let input: RangePickerInput
    public let isLoading: Bool
    public let errorMessage: String?
    public let connection: RangePickerConnection

    public init(
        input: RangePickerInput,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: RangePickerConnection = .live
    ) {
        self.input = input
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Read source seam (P1/S8) — the page's current range + props

/// The read seam the model binds through. The production app re-emits the host page's current range + props
/// (`LiveRangePickerSource`); previews and tests use `InMemoryRangePickerSource`. The view never reads it.
@MainActor
public protocol RangePickerSource: AnyObject {
    var onUpdate: (@MainActor (RangePickerSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production read source — holds the host page's current snapshot and re-emits it whenever the page
/// updates it (a fresh range, a prop change, or a connectivity transition).
@MainActor
public final class LiveRangePickerSource: RangePickerSource {
    public var onUpdate: (@MainActor (RangePickerSnapshot) -> Void)?
    private var snapshot: RangePickerSnapshot

    public init(snapshot: RangePickerSnapshot) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}
    public func refresh() {
        emit()
    }

    /// Push a fresh snapshot (the page's new range / props / connectivity) and re-emit it.
    public func update(_ snapshot: RangePickerSnapshot) {
        self.snapshot = snapshot
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}

/// A fully-working in-memory source for previews + tests. Emits a fixed snapshot and records refreshes.
@MainActor
public final class InMemoryRangePickerSource: RangePickerSource {
    public var onUpdate: (@MainActor (RangePickerSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var refreshCount = 0
    private let snapshot: RangePickerSnapshot

    public init(snapshot: RangePickerSnapshot) {
        self.snapshot = snapshot
    }

    public func start() {
        startCount += 1
        onUpdate?(snapshot)
    }

    public func stop() {}
    public func refresh() {
        refreshCount += 1
        onUpdate?(snapshot)
    }
}
