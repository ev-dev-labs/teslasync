//
//  CommandInputDialog.Seams.swift
//  TeslaSync — P4 modal/dialog · 0030 · CommandInputDialog (Apple)
//
//  The dependency seams the CommandInputDialog view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S11 telemetry contract, the submit/cancel control seam (web
//  `onSubmit(values)` / `onClose`), the coalesced source snapshot, the P1/S8 source protocol, the
//  in-memory source for previews/tests, the P1/S10 i18n facade (web `useTranslation`), and the VoiceOver
//  string builders. No view reads HTTP or a command queue directly — it only ever talks to these seams.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared core `Telemetry.track(.screenView
/// (screen:…))` (ADR-016), consent-gated + redacted there.
public protocol CommandInputTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogCommandInputTelemetry: CommandInputTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Submit / cancel control seam (web `onSubmit` / `onClose`)

/// The dialog's completion seam. `submit` is the web `onSubmit(values)` (the validated `Record<string,
/// string>` handed to the command runner, which builds the request params + dispatches the command);
/// `cancel` is the web `onClose` (dismiss without sending). Keeps the command queue out of the view; the
/// production app injects an adapter that drives the real command pipeline, previews/tests use the
/// logging / spy defaults.
public protocol CommandInputController: Sendable {
    func submit(_ values: [String: String])
    func cancel()
}

/// `os.Logger`-backed default that records the intents without touching a queue, so previews run safely.
/// The submitted field *names* are logged (never the values, which can be PINs).
public struct OSLogCommandInputController: CommandInputController {
    private let logger: Logger
    private let surface = CommandInputSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "commands")
    }

    public func submit(_ values: [String: String]) {
        let fields = values.keys.sorted().joined(separator: ",")
        logger.info("command.input.submit fields=\(fields, privacy: .public) surface=\(surface, privacy: .public)")
    }

    public func cancel() {
        logger.info("command.input.cancel surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `CommandInputSource`: the load status, the resolved command
/// context (the active command spec + vehicle), the live-state freshness, the in-flight submit flag (web
/// `loading` prop), and the refreshing flag.
public struct CommandInputUpdate: Sendable, Equatable {
    public var status: CommandInputLoadStatus
    public var context: CommandInputContext?
    public var connection: CommandInputConnection
    public var submitting: Bool
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: CommandInputLoadStatus = .loading,
        context: CommandInputContext? = nil,
        connection: CommandInputConnection = .live,
        submitting: Bool = false,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.context = context
        self.connection = connection
        self.submitting = submitting
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// resolving the active command definition + its `inputConfig` (web `def`), the bound vehicle (web
/// `vehicle`), the command's in-flight state (web `loading`), plus the live-state freshness and a refresh
/// affordance. Previews/tests use `InMemoryCommandInputSource`.
@MainActor
public protocol CommandInputSource: AnyObject {
    var onUpdate: (@MainActor (CommandInputUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the command context + freshness (web refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets
/// a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryCommandInputSource: CommandInputSource {
    public var onUpdate: (@MainActor (CommandInputUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CommandInputUpdate?

    public init(initial: CommandInputUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { push(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: CommandInputUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "CommandInputDialog" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum CommandInputStrings {
    public static let table = "CommandInputDialog"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the summaries
/// are testable without a bundle.
public enum CommandInputAccessibility {
    /// The dialog summary: the command title (web modal `aria-labelledby` heading) with the prompt as a
    /// hint, so VoiceOver announces what the dialog asks for.
    public static func summary(
        title: String,
        prompt: String
    ) -> String {
        prompt.isEmpty ? title : "\(title), \(prompt)"
    }

    /// The close affordance's VoiceOver label (web `Modal` "×" / `onClose`).
    public static func closeLabel(localize: (String, String) -> String) -> String {
        localize("commands.input.a11y.close", "Close")
    }
}
