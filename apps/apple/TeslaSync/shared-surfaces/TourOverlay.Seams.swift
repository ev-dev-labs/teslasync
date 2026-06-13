//
//  TourOverlay.Seams.swift
//  TeslaSync — P4 shared surface · 0145 · TourOverlay (Apple)
//
//  The dependency seams the TourOverlay view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S11 telemetry contract (`view.opened`), the tour-control seam (web
//  `onNext` / `onPrev` / `onSkip`), the coalesced source snapshot, the P1/S8 source protocol (the
//  native shape of the web `useTour` state owner), the in-memory source for previews / tests, and the
//  P1/S10 i18n facade (web `useTranslation`).
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol TourOverlayTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTourOverlayTelemetry: TourOverlayTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Tour-control seam (web `onNext` / `onPrev` / `onSkip`)

/// The overlay's command seam — the native parity of the web `TourOverlay` callbacks (`onNext`,
/// `onPrev`, `onSkip`), which the `useTour` engine owns. The view never mutates tour state directly:
/// it forwards intent here, and the production adapter drives the real tour engine, which re-pushes a
/// fresh snapshot through the source. Previews / tests use the logging / spy defaults.
public protocol TourOverlayController: Sendable {
    func next()
    func prev()
    func skip()
}

/// `os.Logger`-backed default that records the intents without driving a tour, so previews run safely.
public struct OSLogTourOverlayController: TourOverlayController {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "onboarding")
    }

    public func next() {
        logger.info("tour.next source=\(TourOverlaySurface.slug, privacy: .public)")
    }

    public func prev() {
        logger.info("tour.prev source=\(TourOverlaySurface.slug, privacy: .public)")
    }

    public func skip() {
        logger.info("tour.skip source=\(TourOverlaySurface.slug, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `TourOverlaySource`: the load status, the active step + its
/// anchor rect (web `step` + `targetRect`), the step index + count (web `currentStep` + `totalSteps`),
/// the live-state freshness, and the in-flight flag.
public struct TourOverlayUpdate: Sendable, Equatable {
    public var status: TourOverlayLoadStatus
    public var connection: TourOverlayConnection
    public var refreshing: Bool
    public var step: TourOverlayStep?
    public var targetRect: TourOverlayTargetRect?
    public var currentStep: Int
    public var totalSteps: Int
    public var updatedAt: Date?

    public init(
        status: TourOverlayLoadStatus = .loading,
        connection: TourOverlayConnection = .live,
        refreshing: Bool = false,
        step: TourOverlayStep? = nil,
        targetRect: TourOverlayTargetRect? = nil,
        currentStep: Int = 0,
        totalSteps: Int = 0,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.refreshing = refreshing
        self.step = step
        self.targetRect = targetRect
        self.currentStep = currentStep
        self.totalSteps = totalSteps
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// the live `useTour` state (active step, resolved element rect via the layout observer, step index +
/// count) plus the live-state freshness — and a `refresh` affordance (the web `updateRect` re-measure /
/// the stale auto-refresh). Previews / tests use `InMemoryTourOverlaySource`. The view never reads the
/// tour engine or the DOM geometry directly.
@MainActor
public protocol TourOverlaySource: AnyObject {
    var onUpdate: (@MainActor (TourOverlayUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-measures the target element / re-reads the tour state (web `updateRect`, the stale
    /// auto-refresh, the error-state retry).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets
/// a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryTourOverlaySource: TourOverlaySource {
    public var onUpdate: (@MainActor (TourOverlayUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TourOverlayUpdate?

    public init(initial: TourOverlayUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: TourOverlayUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "TourOverlay" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum TourOverlayStrings {
    public static let table = "TourOverlay"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
