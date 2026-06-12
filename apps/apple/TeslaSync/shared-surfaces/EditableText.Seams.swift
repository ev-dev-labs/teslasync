//
//  EditableText.Seams.swift
//  TeslaSync — P4 shared surface · 0213 · EditableText (Apple)
//
//  The dependency seams the EditableText view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S11 telemetry seam, the announcement seam (the native peer of the web
//  `useAnnouncer` polite live region), the P1/S8 source protocol, the production source that holds the
//  field's current value and carries the asynchronous commit back to the host, and the in-memory source
//  for previews / tests.
//
//  Parity note: the web `EditableText` is a CONTROLLED primitive — the parent owns `value` and passes a
//  fresh string on every render, and the field commits through `onSave(next): Promise<void>`, which can
//  RESOLVE (the field exits edit mode + announces) or REJECT (the field stays in edit mode + shows the
//  error + keeps focus). The native source reproduces that contract with an ASYNC, THROWING `save(_:)`:
//  the host pushes the current value via `update(_:)`, and a committed draft flows through `save(_:)`,
//  which the live source forwards to the host's async `onSave` and — only on success — stores + re-emits
//  (the parent re-render). A thrown error propagates back to the model unchanged. The feed is otherwise
//  local + synchronous (no fetch) so `start` / `refresh` simply re-emit the current snapshot.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated
/// + redacted there). The slug is a static, non-identifying constant.
public protocol EditableTextFieldTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogEditableTextFieldTelemetry: EditableTextFieldTelemetry {
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
/// component's `announce(...)` polite live region (fired after a successful save). The view injects
/// ``LiveEditableTextFieldAnnouncer`` (which posts an `AccessibilityNotification.Announcement`); tests
/// inject a recording double; the model default logs so previews never emit live speech.
@MainActor
public protocol EditableTextFieldAnnouncer {
    func announce(_ message: String)
}

/// `os.Logger`-backed default that records the intent without driving the assistive technology, so
/// previews and headless models run quietly.
@MainActor
public struct OSLogEditableTextFieldAnnouncer: EditableTextFieldAnnouncer {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "accessibility") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func announce(_ message: String) {
        logger.info("announce length=\(message.count, privacy: .public)")
    }
}

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host's bound value +
/// async save (`LiveEditableTextFieldSource`); previews and tests use the in-memory source. The view
/// never reads or writes the bound value directly — it goes through the model and this seam.
@MainActor
public protocol EditableTextFieldSource: AnyObject {
    var onUpdate: (@MainActor (EditableTextFieldInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Carries a committed draft (the web `onSave(next): Promise<void>`) back to the host. Returns when
    /// the save resolves; THROWS when it rejects (the model catches + surfaces the message + keeps the
    /// field in edit mode with focus).
    func save(_ value: String) async throws
}

// MARK: - Live source (production — holds the bound value, carries the async commit back)

/// The production source. Holds the host's current value snapshot and re-emits it whenever the host
/// updates it (`update(_:)`, the web parent passing a new `value`) or a save succeeds (`save(_:)`, the
/// web `onSave` resolving). A successful save stores the new value, invokes `onSave`, and re-emits so the
/// surface reflects the committed result — the native parity of the parent setting state and
/// re-rendering. A failing `onSave` rethrows WITHOUT mutating the stored value (the web rollback: the
/// canonical `value` is unchanged, so the draft the user keeps typing is still theirs).
@MainActor
public final class LiveEditableTextFieldSource: EditableTextFieldSource {
    public var onUpdate: (@MainActor (EditableTextFieldInput) -> Void)?

    /// The host's save handler — the web `onSave(next): Promise<void>`. Throwing rejects the commit.
    public var onSave: (@MainActor (String) async throws -> Void)?

    private var current: EditableTextFieldInput

    public init(
        value: EditableTextFieldInput = EditableTextFieldInput(),
        onSave: (@MainActor (String) async throws -> Void)? = nil
    ) {
        current = value
        self.onSave = onSave
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host's current value snapshot and re-emits it — the native parity of the web parent
    /// passing a fresh `value` / `prompt` / `disabled` / lifecycle on render.
    public func update(_ input: EditableTextFieldInput) {
        current = input
        emit()
    }

    public func save(_ value: String) async throws {
        try await onSave?(value)
        current.value = value
        emit()
    }

    private func emit() {
        onUpdate?(current)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()`,
/// records committed values + lifecycle call counts, and can be armed to throw a save error (the web
/// `onSave` rejection) so the failure branch is exercised deterministically. A test can also push
/// further snapshots to drive the external-change + connection paths.
@MainActor
public final class InMemoryEditableTextFieldSource: EditableTextFieldSource {
    public var onUpdate: (@MainActor (EditableTextFieldInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var saved: [String] = []

    /// When set, the next `save(_:)` throws this error (the web `onSave` rejection) and records nothing.
    public var saveError: Error?
    /// When `true`, a successful save re-emits the snapshot with the committed value (the web parent
    /// re-render). Off by default so a test can assert the commit in isolation.
    public var echoSavedValue = false

    private var current: EditableTextFieldInput?

    public init(initial: EditableTextFieldInput? = nil) {
        current = initial
    }

    public func start() {
        startCount += 1
        if let current { onUpdate?(current) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func save(_ value: String) async throws {
        if let saveError {
            throw saveError
        }
        saved.append(value)
        if echoSavedValue {
            var next = current ?? EditableTextFieldInput()
            next.value = value
            current = next
            onUpdate?(next)
        }
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: EditableTextFieldInput) {
        current = input
        onUpdate?(input)
    }
}
