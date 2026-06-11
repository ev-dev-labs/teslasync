//
//  InstallPrompt.Stores.swift
//  TeslaSync — P4 shared surface · 0125 · InstallPrompt (Apple)
//
//  The persistence + fan-out seams the InstallPrompt source binds through, split out of
//  `InstallPrompt.Seams.swift` for the lint file-length budget: the dismissal store (the native parity
//  of the web `teslasync-pwa-install-dismissed` localStorage contract — production `UserDefaults` +
//  an in-memory double) and the cross-scene broadcast (the native parity of the web
//  `broadcast`/`subscribe` bus — production `NotificationCenter` + a controllable double). Foundation
//  only; no view logic, no projection — each piece is unit tested in isolation.
//

import Foundation

// MARK: - Dismissal store (web `teslasync-pwa-install-dismissed` localStorage)

/// The seam that persists the sticky dismissal instant — the native parity of the web `localStorage`
/// contract. `dismissedAt` is `nil` when never dismissed (the web safe-default when storage access
/// throws), so the prompt shows by default.
@MainActor
public protocol InstallPromptDismissalStore: AnyObject {
    /// The instant the prompt was last dismissed, or `nil` if never (web `localStorage.getItem`).
    var dismissedAt: Date? { get }
    /// Persists the dismissal instant (web `localStorage.setItem(DISMISS_KEY, String(Date.now()))`).
    func markDismissed(at date: Date)
    /// Clears the persisted dismissal (test / "show again" affordance).
    func clear()
}

/// Production store backed by `UserDefaults`, using the same key the web persists
/// (`teslasync-pwa-install-dismissed`) so the dismissal contract is recognisably identical across
/// platforms. The persisted value is the dismissal instant as a Unix timestamp; the 14-day window is
/// evaluated by `InstallPromptDismissal` at read time.
@MainActor
public final class UserDefaultsInstallPromptDismissalStore: InstallPromptDismissalStore {
    /// The dismissal key — verbatim from the web `DISMISS_KEY`.
    public static let storageKey = InstallPromptConstants.dismissKey

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var dismissedAt: Date? {
        guard defaults.object(forKey: Self.storageKey) != nil else { return nil }
        let timestamp = defaults.double(forKey: Self.storageKey)
        guard timestamp > 0 else { return nil }
        return Date(timeIntervalSince1970: timestamp)
    }

    public func markDismissed(at date: Date) {
        defaults.set(date.timeIntervalSince1970, forKey: Self.storageKey)
    }

    public func clear() {
        defaults.removeObject(forKey: Self.storageKey)
    }
}

/// In-memory dismissal store for previews + tests. Records the number of writes so the persistence
/// contract can be asserted without touching `UserDefaults`.
@MainActor
public final class InMemoryInstallPromptDismissalStore: InstallPromptDismissalStore {
    public private(set) var dismissedAt: Date?
    public private(set) var markCount = 0
    public private(set) var clearCount = 0

    public init(dismissedAt: Date? = nil) {
        self.dismissedAt = dismissedAt
    }

    public func markDismissed(at date: Date) {
        dismissedAt = date
        markCount += 1
    }

    public func clear() {
        dismissedAt = nil
        clearCount += 1
    }
}

// MARK: - Cross-scene broadcast (web `broadcast`/`subscribe` bus)

/// The seam that fans a dismissal out to sibling scenes — the native parity of the web
/// `broadcast({ type: 'install.dismissed' })` + `subscribe`. Posting hides the prompt in the app's
/// other windows (iPad multiwindow / macOS); subscribing reflects a sibling's dismissal here.
@MainActor
public protocol InstallPromptBroadcast: AnyObject {
    /// Posts the dismissal to sibling scenes (web `broadcast({ type: 'install.dismissed' })`).
    func postDismissed()
    /// Subscribes to cross-scene dismissals; `handler` runs on the main actor. Replaces any prior.
    func subscribe(_ handler: @escaping @MainActor () -> Void)
    /// Tears down the subscription.
    func unsubscribe()
}

/// Production broadcast over `NotificationCenter` — the in-process fan-out across the app's scenes
/// (which share `UserDefaults.standard`, so a sibling's persisted dismissal is visible here on the
/// nudge). A post tags itself as the sender so the posting scene ignores its own notification (web
/// `BroadcastChannel` does not echo to the posting context).
@MainActor
public final class NotificationCenterInstallPromptBroadcast: NSObject, InstallPromptBroadcast {
    /// The cross-scene dismissal notification — the native parity of the web `install.dismissed`
    /// broadcast message type. `nonisolated` so `deinit` (and any thread) can reference it.
    public nonisolated static let dismissedNotification =
        Notification.Name("io.teslasync.installPrompt.dismissed")

    private let center: NotificationCenter
    private var handler: (@MainActor () -> Void)?

    public init(center: NotificationCenter = .default) {
        self.center = center
        super.init()
    }

    public func postDismissed() {
        center.post(name: Self.dismissedNotification, object: self)
    }

    public func subscribe(_ handler: @escaping @MainActor () -> Void) {
        self.handler = handler
        center.addObserver(
            self,
            selector: #selector(handleDismissed(_:)),
            name: Self.dismissedNotification,
            object: nil
        )
    }

    public func unsubscribe() {
        center.removeObserver(self, name: Self.dismissedNotification, object: nil)
        handler = nil
    }

    @objc
    private func handleDismissed(_ note: Notification) {
        // Ignore our own post — only sibling scenes should hide us (web cross-tab semantics).
        if let object = note.object as AnyObject?, object === self { return }
        handler?()
    }

    deinit {
        center.removeObserver(self, name: Self.dismissedNotification, object: nil)
    }
}

/// Controllable broadcast for previews + tests. Records the post count and delivers a simulated
/// sibling-scene dismissal on demand via `deliver()`, so the fan-out can be asserted without
/// `NotificationCenter` or multiple windows.
@MainActor
public final class ControlledInstallPromptBroadcast: InstallPromptBroadcast {
    public private(set) var postCount = 0
    public private(set) var subscribeCount = 0
    public private(set) var unsubscribeCount = 0

    private var handler: (@MainActor () -> Void)?

    public init() {}

    public func postDismissed() {
        postCount += 1
    }

    public func subscribe(_ handler: @escaping @MainActor () -> Void) {
        self.handler = handler
        subscribeCount += 1
    }

    public func unsubscribe() {
        handler = nil
        unsubscribeCount += 1
    }

    /// Simulates a sibling scene posting `install.dismissed` — invokes the subscribed handler.
    public func deliver() {
        handler?()
    }
}
