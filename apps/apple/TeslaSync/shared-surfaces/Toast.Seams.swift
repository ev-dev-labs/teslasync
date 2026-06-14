//
//  Toast.Seams.swift
//  TeslaSync — P4 shared surface · 0144 · Toast (Apple)
//
//  The dependency seams the ``ToastCenter`` store binds through, kept apart from the model for the lint
//  file-length budget: the P1/S11 telemetry seam (the once-only `view.opened`), the auto-dismiss
//  scheduler seam (the native peer of the web `setTimeout(dismiss, duration)`, injectable so tests advance
//  a deterministic clock instead of waiting four real seconds), and the P1/S10 localization facade.
//
//  Parity note: the web provider schedules each toast's dismissal with `setTimeout`, and its test suite
//  swaps in `vi.useFakeTimers()` + `vi.advanceTimersByTime(...)` to assert the 4s auto-dismiss without
//  waiting. ``ManualToastScheduler`` is the native peer of those fake timers; ``TaskToastScheduler`` is the
//  production peer of `setTimeout`.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated +
/// redacted there). The slug is a static, non-identifying constant.
public protocol ToastTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogToastTelemetry: ToastTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Auto-dismiss scheduler seam (web `setTimeout(dismiss, duration)`)

/// A cancellable handle for a scheduled auto-dismiss — the native peer of the value `setTimeout` returns
/// (and `clearTimeout` consumes). ``ToastCenter`` keeps one per live toast so a manual dismiss tears down
/// the pending timer instead of leaving it to fire harmlessly later.
@MainActor
public protocol ToastTimer: AnyObject {
    func cancel()
}

/// Schedules a toast's auto-dismissal — the native peer of the web `setTimeout(() => dismiss(id),
/// duration)`. Injectable so the production app sleeps on a real clock while tests fire the pending
/// dismissals synchronously (the peer of `vi.advanceTimersByTime`).
@MainActor
public protocol ToastScheduling: AnyObject {
    func schedule(after seconds: TimeInterval, _ action: @escaping @MainActor () -> Void) -> ToastTimer
}

/// The production scheduler — sleeps on a detached main-actor `Task`, then runs the dismissal unless the
/// handle was cancelled (web `setTimeout` / `clearTimeout`).
@MainActor
public final class TaskToastScheduler: ToastScheduling {
    public init() {}

    public func schedule(
        after seconds: TimeInterval,
        _ action: @escaping @MainActor () -> Void
    ) -> ToastTimer {
        let timer = TaskToastTimer()
        timer.task = Task { @MainActor in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            action()
        }
        return timer
    }
}

/// The `Task`-backed handle ``TaskToastScheduler`` returns.
@MainActor
final class TaskToastTimer: ToastTimer {
    var task: Task<Void, Never>?

    func cancel() {
        task?.cancel()
        task = nil
    }
}

/// The deterministic scheduler for previews + tests — the native peer of `vi.useFakeTimers()`. It records
/// each pending dismissal instead of sleeping, exposes how many remain, and fires them on demand
/// (``fireAll()`` is the peer of advancing fake timers past every toast's duration). No real clock, so the
/// 4s auto-dismiss is asserted instantly.
@MainActor
public final class ManualToastScheduler: ToastScheduling {
    public private(set) var scheduledCount = 0
    private var pending: [Int: @MainActor () -> Void] = [:]
    private var nextHandle = 0

    public init() {}

    public func schedule(
        after _: TimeInterval,
        _ action: @escaping @MainActor () -> Void
    ) -> ToastTimer {
        scheduledCount += 1
        nextHandle += 1
        let handle = nextHandle
        pending[handle] = action
        return ManualToastTimer(handle: handle, scheduler: self)
    }

    /// Dismissals scheduled but not yet fired or cancelled.
    public var pendingCount: Int {
        pending.count
    }

    /// Fires every still-pending dismissal — advances the fake clock past all durations.
    public func fireAll() {
        let actions = pending
        pending.removeAll()
        for action in actions.values {
            action()
        }
    }

    func cancel(handle: Int) {
        pending[handle] = nil
    }
}

/// The handle ``ManualToastScheduler`` returns; cancelling removes its pending dismissal.
@MainActor
final class ManualToastTimer: ToastTimer {
    private let handle: Int
    private weak var scheduler: ManualToastScheduler?

    init(handle: Int, scheduler: ManualToastScheduler) {
        self.handle = handle
        self.scheduler = scheduler
    }

    func cancel() {
        scheduler?.cancel(handle: handle)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "Toast" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. Kept per-surface so each parallel prompt owns its own strings.
public enum ToastStrings {
    public static let table = "Toast"

    public static let string: ToastResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The dismiss control's accessible name (web `aria-label="Dismiss notification"`).
    public static var dismiss: String {
        string("toast.dismiss", "Dismiss notification")
    }

    /// The spoken severity word VoiceOver reads before the title (the native peer of the web ARIA role's
    /// implicit severity cue, which VoiceOver does not surface on its own).
    public static func severity(_ kind: ToastKind) -> String {
        switch kind {
        case .success: string("toast.severity.success", "Success")
        case .error: string("toast.severity.error", "Error")
        case .info: string("toast.severity.info", "Information")
        case .warning: string("toast.severity.warning", "Warning")
        }
    }
}
