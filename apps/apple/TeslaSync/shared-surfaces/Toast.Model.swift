//
//  Toast.Model.swift
//  TeslaSync — P4 shared surface · 0144 · Toast (Apple)
//
//  The caller-facing action value type, the live toast value, and the observable state-holder (P1/S8) for
//  the transient toast surface. The web keeps its toasts in `ToastProvider`'s `useState` array, read
//  through the `useToast()` context; the native peer is the `@Observable` ``ToastCenter`` — an app-global
//  ``shared`` instance (the provider parity) that is equally instantiable for previews / tests. The holder
//  owns the toast array (web `toasts`), appends an id'd toast capped to the five newest (web
//  `[...prev.slice(-4), toast]`), auto-dismisses each after its duration through the injected scheduler
//  (web `setTimeout`), dismisses on demand (web `dismiss`), bridges TanStack-style mutation results (web
//  `useMutationToast`), and emits the single `view.opened` diagnostics event. No networking lives here.
//

import Foundation
import Observation

// MARK: - ToastAction (web discriminated `ToastAction`)

/// One toast's optional action — the caller-facing native peer of the web `ToastAction`. Two flavours,
/// discriminated by which field is set: a navigation link (web `{ label, to }`, carried as
/// ``navigationPath``) or a callback (web `{ label, onClick }`, carried as ``perform``). When both are
/// supplied the navigation form wins, so existing call-sites stay intact (web comment).
public struct ToastAction {
    /// Visible label, e.g. "View" or "Undo" (web `action.label`).
    public let label: String
    /// Router target — a path + query string, the same shape as the web `<Link to=>` (web `action.to`). The
    /// host resolves it through its `onNavigate` closure. Mutually exclusive with ``perform``.
    public let navigationPath: String?
    /// Callback fired when the action is chosen; the toast auto-dismisses after it runs (web
    /// `action.onClick`). Mutually exclusive with ``navigationPath``.
    public let perform: (@MainActor () -> Void)?

    public init(
        label: String,
        navigationPath: String? = nil,
        perform: (@MainActor () -> Void)? = nil
    ) {
        self.label = label
        self.navigationPath = navigationPath
        self.perform = perform
    }

    /// A navigation action (web `{ label, to }`).
    public static func navigate(_ label: String, to path: String) -> ToastAction {
        ToastAction(label: label, navigationPath: path)
    }

    /// A callback action (web `{ label, onClick }`).
    public static func callback(_ label: String, perform: @escaping @MainActor () -> Void) -> ToastAction {
        ToastAction(label: label, perform: perform)
    }

    /// Which affordance this action renders — navigation wins when both fields are set (web behaviour);
    /// `nil` when neither is, so the toast renders no action at all.
    public var resolvedStyle: ToastActionStyle? {
        if navigationPath != nil { return .navigation }
        if perform != nil { return .callback }
        return nil
    }
}

// MARK: - ToastItem (web `Toast`)

/// One live toast — the native peer of the web `Toast` value. Carries the closure-bearing ``ToastAction``;
/// its closure-free ``descriptor`` feeds the pure projection, the queue, and the VoiceOver label.
public struct ToastItem: Identifiable {
    /// Stable identity (web `toast-${++toastCounter}`).
    public let id: String
    public let kind: ToastKind
    public let title: String
    public let message: String?
    /// Already resolved against the 4s default (web `opts.duration ?? 4000`).
    public let durationMilliseconds: Int
    public let action: ToastAction?

    public init(
        id: String,
        kind: ToastKind,
        title: String,
        message: String? = nil,
        durationMilliseconds: Int = ToastDuration.defaultMilliseconds,
        action: ToastAction? = nil
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.message = message
        self.durationMilliseconds = durationMilliseconds
        self.action = action
    }

    /// The closure-free description used by the pure projection, the queue, and the VoiceOver label.
    public var descriptor: ToastDescriptor {
        ToastDescriptor(
            id: id,
            kind: kind,
            title: title,
            message: message,
            durationMilliseconds: durationMilliseconds,
            actionLabel: action?.label,
            actionStyle: action?.resolvedStyle
        )
    }
}

// MARK: - ToastCenter (P1/S8) — app-global store + queue + auto-dismiss

/// The surface's observable state-holder — the native peer of the web `ToastProvider` (the `useState`
/// toast array read through `useToast()`). The app mounts one ``ToastHost`` bound to ``shared`` (the
/// provider parity); previews and tests inject their own instance. It owns the toast array (web `toasts`),
/// posts / dismisses toasts, caps the queue to the five newest, auto-dismisses through the injected
/// scheduler, bridges mutation results, and emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class ToastCenter {
    /// The app-global instance — the native peer of the single mounted `ToastProvider`. Call sites that do
    /// not inject a center (the default ``ToastHost``) share it.
    public static let shared = ToastCenter()

    /// The live toasts, oldest-first (web `toasts`). Observed so the host re-renders the stack on change.
    public private(set) var items: [ToastItem] = []

    @ObservationIgnored private let telemetry: any ToastTelemetry
    @ObservationIgnored private let scheduler: any ToastScheduling
    @ObservationIgnored private var timers: [String: ToastTimer] = [:]
    @ObservationIgnored private var counter = 0
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        telemetry: any ToastTelemetry = OSLogToastTelemetry(),
        scheduler: any ToastScheduling = TaskToastScheduler()
    ) {
        self.telemetry = telemetry
        self.scheduler = scheduler
    }

    // MARK: Lifecycle (P1/S11 once-only view.opened)

    /// Begins the surface and emits `view.opened` once. Idempotent across SwiftUI appear / disappear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ToastSurface.slug)
        }
    }

    /// Marks the surface inactive. The once-only `view.opened` contract is preserved.
    public func stop() {
        started = false
    }

    // MARK: Posting (web `addToast`)

    /// Posts a toast — the native peer of the web `addToast(opts)`: mints a unique id, resolves the
    /// duration (web `?? 4000`), appends it capped to the five newest (web `[...prev.slice(-4), toast]`),
    /// and schedules its auto-dismiss when the duration is positive (web `if (duration > 0)`). Returns the
    /// new toast's id so a caller can dismiss it programmatically.
    @discardableResult
    public func post(
        kind: ToastKind,
        title: String,
        message: String? = nil,
        durationMilliseconds: Int? = nil,
        action: ToastAction? = nil
    ) -> String {
        counter += 1
        let id = "toast-\(counter)"
        let duration = ToastDuration.resolve(durationMilliseconds)
        let item = ToastItem(
            id: id,
            kind: kind,
            title: title,
            message: message,
            durationMilliseconds: duration,
            action: action
        )
        let previous = items
        items = ToastQueue.appending(item, to: items)
        cancelTimersForEvicted(previous: previous)
        if ToastDuration.isAutoDismissing(duration) {
            timers[id] = scheduler.schedule(after: ToastDuration.seconds(duration)) { [weak self] in
                self?.dismiss(id: id)
            }
        }
        return id
    }

    /// Web `toast.success(title, message?)`.
    @discardableResult
    public func success(_ title: String, message: String? = nil) -> String {
        post(kind: .success, title: title, message: message)
    }

    /// Web `toast.error(title, message?)`.
    @discardableResult
    public func error(_ title: String, message: String? = nil) -> String {
        post(kind: .error, title: title, message: message)
    }

    /// Web `toast.info(title, message?)`.
    @discardableResult
    public func info(_ title: String, message: String? = nil) -> String {
        post(kind: .info, title: title, message: message)
    }

    /// Web `toast.warning(title, message?)`.
    @discardableResult
    public func warning(_ title: String, message: String? = nil) -> String {
        post(kind: .warning, title: title, message: message)
    }

    // MARK: Dismissal (web `dismiss`)

    /// Dismisses a toast by id and cancels its pending auto-dismiss (web `dismiss(id)`; idempotent).
    public func dismiss(id: String) {
        timers[id]?.cancel()
        timers[id] = nil
        items = ToastQueue.removing(id: id, from: items)
    }

    /// Clears every toast and cancels all pending auto-dismissals (no web peer; native convenience).
    public func dismissAll() {
        for timer in timers.values {
            timer.cancel()
        }
        timers.removeAll()
        items = []
    }

    // MARK: Mutation bridge (web `useMutationToast`)

    /// Posts a success toast for a completed mutation — the native peer of the web `useMutationToast`
    /// `success(key, fallback)`. The title resolves through the P1/S10 facade.
    @discardableResult
    public func mutationSucceeded(key: String, fallback: String, message: String? = nil) -> String {
        success(ToastStrings.string(key, fallback), message: message)
    }

    /// Posts an error toast for a failed mutation — the native peer of the web `useMutationToast`
    /// `error(err, key, fallback)`: the localized title plus the error's description as the secondary line.
    @discardableResult
    public func mutationFailed(
        _ error: Error,
        key: String = "toast.common.error",
        fallback: String = "Something went wrong"
    ) -> String {
        self.error(ToastStrings.string(key, fallback), message: error.localizedDescription)
    }

    /// Detail-string overload of ``mutationFailed(_:key:fallback:)`` for non-`Error` failures (web `err ==
    /// null ? undefined : String(err)`).
    @discardableResult
    public func mutationFailed(
        detail: String?,
        key: String = "toast.common.error",
        fallback: String = "Something went wrong"
    ) -> String {
        error(ToastStrings.string(key, fallback), message: detail)
    }

    private func cancelTimersForEvicted(previous: [ToastItem]) {
        for old in previous where !items.contains(where: { $0.id == old.id }) {
            timers[old.id]?.cancel()
            timers[old.id] = nil
        }
    }
}
