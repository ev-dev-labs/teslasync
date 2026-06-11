//
//  CommandConfirmDialog.Seams.swift
//  TeslaSync — P4 modal / dialog · 0029 · CommandConfirmDialog (Apple)
//
//  The dependency seams the CommandConfirmDialog view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract, the confirm / cancel command seam (web
//  `onConfirm` / `onClose`), the countdown ticker (web `setInterval(…, 1000)`), the coalesced source
//  snapshot, the P1/S8 source protocol, the in-memory source for previews / tests, the P1/S10 i18n
//  facade (web `useTranslation`), and the VoiceOver string builders. No view reads HTTP, persistence,
//  or a wall-clock timer directly — it only ever talks to these seams.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-
/// gated + redacted there).
public protocol CommandConfirmTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a static,
/// non-identifying constant.
public struct OSLogCommandConfirmTelemetry: CommandConfirmTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Confirm / cancel command seam (web `onConfirm` / `onClose`)

/// The dialog's two decisions. `confirm()` is the web `onConfirm` — the parent forwards the approval
/// to its command dispatch (the native seam awaits it so the in-flight `submitting` state can drive
/// the spinner + disabled buttons, the parity of the web `loading` prop). `cancel()` is the web
/// `onClose`. Keeps the action plumbing out of the view; the production app injects an adapter over
/// the caller's handlers, previews / tests use the logging / spy defaults.
public protocol CommandConfirmController: Sendable {
    /// Approve the command (web `onConfirm`). Awaited so the dialog can show the in-flight state.
    func confirm() async
    /// Dismiss without acting (web `onClose`).
    func cancel()
}

/// `os.Logger`-backed default that records the decisions without dispatching a command, so previews
/// render safely.
public struct OSLogCommandConfirmController: CommandConfirmController {
    private let logger: Logger
    private let surface = CommandConfirmSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "commands")
    }

    public func confirm() async {
        logger.info("commands.confirm surface=\(surface, privacy: .public)")
    }

    public func cancel() {
        logger.info("commands.cancel surface=\(surface, privacy: .public)")
    }
}

// MARK: - Countdown ticker seam (web `setInterval(…, 1000)`)

/// The 1-second countdown clock (web `setInterval`). The model owns the remaining count + the
/// decrement rule; this seam only decides *when* a tick happens, so the countdown is driven by a real
/// clock in the app and by a manual pulse in tests (no flaky wall-clock waits).
@MainActor
public protocol CommandConfirmTicker: AnyObject {
    /// Invoked on the main actor once per interval while running.
    var onTick: (@MainActor () -> Void)? { get set }
    /// Begins ticking (restarts if already running).
    func start()
    /// Stops ticking.
    func stop()
}

/// Structured-concurrency default: a cancellable main-actor `Task` that pulses `onTick` once per
/// interval. Used in the running app; previews / tests inject `ManualCommandConfirmTicker`.
@MainActor
public final class TaskCommandConfirmTicker: CommandConfirmTicker {
    public var onTick: (@MainActor () -> Void)?
    private var task: Task<Void, Never>?
    private let interval: Duration

    public init(interval: Duration = .seconds(1)) {
        self.interval = interval
    }

    public func start() {
        stop()
        let interval = interval
        task = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                if Task.isCancelled { return }
                self?.onTick?()
            }
        }
    }

    public func stop() {
        task?.cancel()
        task = nil
    }
}

/// In-memory ticker for previews + unit tests: records start / stop and drives a tick synchronously
/// via `fire()`, so the countdown is exercised deterministically.
@MainActor
public final class ManualCommandConfirmTicker: CommandConfirmTicker {
    public var onTick: (@MainActor () -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var isRunning = false

    public init() {}

    public func start() {
        startCount += 1
        isRunning = true
    }

    public func stop() {
        stopCount += 1
        isRunning = false
    }

    /// Drives one countdown tick on the bound model (test / preview affordance).
    public func fire() {
        onTick?()
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `CommandConfirmSource`: the delivery status, the resolved
/// command request, the live-state freshness, the in-flight background-reload flag, and the
/// last-updated timestamp.
public struct CommandConfirmUpdate: Sendable, Equatable {
    public var status: CommandConfirmLoadStatus
    public var request: CommandConfirmRequest?
    public var connection: CommandConfirmConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: CommandConfirmLoadStatus = .loading,
        request: CommandConfirmRequest? = nil,
        connection: CommandConfirmConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.request = request
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 command-palette
/// coordinator (the command a row's "run" button armed for confirmation, plus the `loading` flag the
/// dispatch toggles); previews / tests use `InMemoryCommandConfirmSource`. The view never talks to
/// persistence or the network.
@MainActor
public protocol CommandConfirmSource: AnyObject {
    var onUpdate: (@MainActor (CommandConfirmUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the pending command (web refetch / the error-state retry / stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryCommandConfirmSource: CommandConfirmSource {
    public var onUpdate: (@MainActor (CommandConfirmUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CommandConfirmUpdate?

    public init(initial: CommandConfirmUpdate? = nil) {
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
    public func push(_ update: CommandConfirmUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "CommandConfirmDialog" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum CommandConfirmStrings {
    public static let table = "CommandConfirmDialog"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum CommandConfirmAccessibility {
    /// The dialog's region label (web `Modal` title). Falls back to the localized "Confirm" when a
    /// request carries no title.
    public static func summary(title: String, localize: (String, String) -> String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return localize(CommandConfirmProjection.Keys.confirm, CommandConfirmProjection.Fallbacks.confirm)
        }
        return title
    }

    /// The "Warning" prefix read before the message so VoiceOver announces the stakes (web red
    /// `AlertTriangle` icon), then the message.
    public static func messageLabel(message: String, localize: (String, String) -> String) -> String {
        let prefix = localize("commands.confirm.a11y.warning", "Warning")
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? prefix : "\(prefix). \(message)"
    }

    /// The Confirm button's VoiceOver value while the countdown ticks ("Available in N seconds"), so
    /// the disabled-countdown state is legible. Empty once the countdown has elapsed.
    public static func countdownValue(remaining: Int, localize: (String, String) -> String) -> String {
        guard CommandConfirmProjection.countdownActive(remaining: remaining) else { return "" }
        return localize("commands.confirm.a11y.countdown", "Available in {{seconds}} seconds")
            .replacingOccurrences(of: "{{seconds}}", with: String(remaining))
    }

    /// The typed-confirmation field's VoiceOver label (web `aria-label`), passed through from the
    /// resolved prompt copy.
    public static func typedFieldLabel(_ label: String) -> String {
        label
    }

    /// The close affordance's VoiceOver label (web `Modal` "×").
    public static func closeLabel(localize: (String, String) -> String) -> String {
        localize("commands.confirm.close", "Close")
    }
}
