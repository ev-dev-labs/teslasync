//
//  TagInput.Seams.swift
//  TeslaSync — P4 shared surface · 0160 · TagInput (Apple)
//
//  The dependency seams the TagInput view-model binds through, kept apart from the model for the lint
//  length budget: the P1/S8 source protocol, the production source that holds the field's current value
//  and re-emits it as a snapshot (and carries committed edits back to the host), and the in-memory source
//  for previews / tests.
//
//  Parity note: the web `TagInput` is a CONTROLLED field — the parent owns `value` and passes a fresh
//  array on every render, and the field calls `onChange(next)` on each add / remove. The native source
//  reproduces that two-way contract: the host pushes the current value via `update(_:)`, and the field
//  writes the new tag list back via `commit(_:)`, which the live source forwards to the host's `onCommit`
//  and re-emits (the parent re-render). The feed is local + synchronous — no HTTP — so `start` / `refresh`
//  simply re-emit the current value.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated
/// + redacted there). The slug is a static, non-identifying constant.
public protocol TagInputTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTagInputTelemetry: TagInputTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Announcement seam (native parity of the web `useAnnouncer` live region)

/// Posts a polite announcement to the assistive technology — the native boundary that replaces the web
/// component's `announce(...)` polite live region. The view injects ``LiveTagInputAnnouncer`` (which posts
/// an `AccessibilityNotification.Announcement`); tests inject a recording double; the model default logs
/// so previews never emit live speech.
@MainActor
public protocol TagInputAnnouncer {
    func announce(_ message: String)
}

/// `os.Logger`-backed default that records the intent without driving the assistive technology, so
/// previews and headless models run quietly.
@MainActor
public struct OSLogTagInputAnnouncer: TagInputAnnouncer {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "accessibility") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func announce(_ message: String) {
        logger.info("announce length=\(message.count, privacy: .public)")
    }
}

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host form's bound value
/// (`LiveTagInputSource`); previews and tests use the in-memory source. The view never reads or writes the
/// bound value directly — it goes through the model and this seam.
@MainActor
public protocol TagInputSource: AnyObject {
    var onUpdate: (@MainActor (TagInputSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Carries a committed value (the web `onChange(next)`) back to the host.
    func commit(_ tags: [String])
}

// MARK: - Live source (production — holds the bound value, carries commits back)

/// The production source. Holds the host form's current value snapshot and re-emits it whenever the host
/// updates it (`update(_:)`, the web parent passing a new `value`) or the field commits an edit
/// (`commit(_:)`, the web `onChange`). A committed value is stored, forwarded to `onCommit`, and re-emitted
/// so the surface reflects the new list — the native parity of the parent setting state and re-rendering.
@MainActor
public final class LiveTagInputSource: TagInputSource {
    public var onUpdate: (@MainActor (TagInputSnapshot) -> Void)?

    /// The host's change handler — the web `onChange` callback.
    public var onCommit: (@MainActor ([String]) -> Void)?

    private var current: TagInputSnapshot

    public init(
        value: TagInputSnapshot = TagInputSnapshot(),
        onCommit: (@MainActor ([String]) -> Void)? = nil
    ) {
        current = value
        self.onCommit = onCommit
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host's current value snapshot and re-emits it — the native parity of the web parent
    /// passing a fresh `value` / `label` / `maxTags` / lifecycle on render.
    public func update(_ input: TagInputSnapshot) {
        current = input
        emit()
    }

    public func commit(_ tags: [String]) {
        current.tags = tags
        onCommit?(tags)
        emit()
    }

    private func emit() {
        onUpdate?(current)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()`,
/// records committed values + lifecycle call counts, and lets a test push further snapshots.
@MainActor
public final class InMemoryTagInputSource: TagInputSource {
    public var onUpdate: (@MainActor (TagInputSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var committed: [[String]] = []

    private let initial: TagInputSnapshot?

    public init(initial: TagInputSnapshot? = nil) {
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

    public func commit(_ tags: [String]) {
        committed.append(tags)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: TagInputSnapshot) {
        onUpdate?(input)
    }
}
