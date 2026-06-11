//
//  AnnotationList.Model.swift
//  TeslaSync — P4 shared surface · 0063 · AnnotationList (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the chart-annotation list. The view binds through `AnnotationListModel`;
//  no networking lives in the view. The web component reads only `useTranslation` and is handed its
//  `annotations` + `onRemove` by the parent; the native model keeps the same data contract — a
//  source emits the data + connectivity snapshot, the model derives the resolved projection, forwards
//  removals to the host (web `onRemove`), emits `view.opened` once when the list first presents its
//  content, and auto-refreshes once when the snapshot goes stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AnnotationListTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogAnnotationListTelemetry: AnnotationListTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Context source seam (P1/S8 layer)

/// The seam the model binds through for the surface inputs — the fetched annotations (web parent
/// `annotations` prop) + the P4 connectivity axis. The production app implements this over the live
/// annotations store (`LiveAnnotationListSource`); previews and tests use
/// `InMemoryAnnotationListSource`. The feed is local + synchronous (no HTTP in the view).
@MainActor
public protocol AnnotationListSource: AnyObject {
    var onUpdate: (@MainActor (AnnotationListInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production context source. Holds the host-provided snapshot and re-emits it on
/// `start`/`refresh` — the native binding point for the web parent's fetched `annotations`. The feed
/// is local + synchronous; the host re-creates the source (or pushes through a subclass) when the
/// annotation set changes (e.g. after a removal).
@MainActor
public final class LiveAnnotationListSource: AnnotationListSource {
    public var onUpdate: (@MainActor (AnnotationListInput) -> Void)?

    private let input: AnnotationListInput

    public init(input: AnnotationListInput) {
        self.input = input
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    private func emit() {
        onUpdate?(input)
    }
}

/// In-memory context source for previews + unit/UI tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAnnotationListSource: AnnotationListSource {
    public var onUpdate: (@MainActor (AnnotationListInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AnnotationListInput?

    public init(initial: AnnotationListInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial {
            onUpdate?(initial)
        }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a context snapshot to the bound model (test/preview affordance).
    public func push(_ input: AnnotationListInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds an `AnnotationListSource` (data + connectivity),
/// recomputes the resolved projection, exposes the resolved view-state, forwards removals to the
/// host (web `onRemove`), emits the `view.opened` diagnostics event exactly once when the list first
/// presents its content (never while loading / errored / withdrawn), and auto-refreshes once when
/// the snapshot transitions to stale.
@MainActor
@Observable
public final class AnnotationListModel {
    public private(set) var resolved: AnnotationListResolved

    public var phase: AnnotationListResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any AnnotationListSource
    @ObservationIgnored private let telemetry: any AnnotationListTelemetry
    @ObservationIgnored private let onRemove: (@MainActor (String) -> Void)?
    @ObservationIgnored private var input = AnnotationListInput()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any AnnotationListSource,
        onRemove: (@MainActor (String) -> Void)? = nil,
        telemetry: any AnnotationListTelemetry = OSLogAnnotationListTelemetry()
    ) {
        self.source = source
        self.onRemove = onRemove
        self.telemetry = telemetry
        resolved = AnnotationListProjection.resolve(AnnotationListInput())
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the context. Idempotent; the `view.opened` event is emitted lazily the first
    /// time the list actually presents content (not here — the surface may resolve to loading first
    /// or, when empty under `.withdraw`, to nothing at all).
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing the context.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the context snapshot (freshness chip + offline/stale recovery).
    public func refresh() {
        source.refresh()
    }

    /// Removes an annotation — the native parity of the web `onRemove(id)` prop. Forwards to the
    /// host, which updates its store and pushes a new snapshot through the source.
    public func remove(id: String) {
        onRemove?(id)
    }

    private func apply(_ input: AnnotationListInput) {
        let previous = self.input
        self.input = input
        recompute()
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch); offline never
        // auto-refreshes (there is no connection to re-fetch over).
        if input.connection == .stale, previous.connection != .stale {
            source.refresh()
        }
    }

    private func recompute() {
        resolved = AnnotationListProjection.resolve(input)
        // `view.opened` fires once, the first time the list actually shows content (populated rows
        // or the friendly empty state). Loading is pre-content; the web `null` (withdrawn) means the
        // surface was never opened.
        if resolved.presentsContent, !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: AnnotationListMeta.surfaceSlug)
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "AnnotationList" table (the web source keys
/// `annotation.listTitle` / `annotation.remove`, the `ANNOTATION_CATEGORY_LABELS` names, plus the
/// native P4 chrome), folded into the app `Localizable.xcstrings` catalog at integration time; kept
/// per-surface so each parallel prompt owns its own strings.
public enum AnnotationListStrings {
    public static let table = "AnnotationList"

    public static let string: AnnotationListResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
