//
//  OnboardingWizard.Seams.swift
//  TeslaSync — P4 shared surface · 0131 · OnboardingWizard (Apple)
//
//  The persistence + peer-bus seam the OnboardingWizard state-holder binds through (P1/S8), kept apart from
//  the model for the lint length budget. The web first-run intro persists a single completion flag in
//  `localStorage['teslasync-onboarded']` and coordinates across browser tabs over a `BroadcastChannel`
//  (`broadcast({type:'onboarded'})` / `subscribe`). The native peers:
//
//    • ``OnboardingWizardStore`` — the seam: read the completion flag, persist-and-broadcast it, and notify
//      this scene when a *peer* scene completes onboarding (the web `subscribe` callback). The view never
//      touches `UserDefaults` or `NotificationCenter` directly.
//    • ``UserDefaultsOnboardingWizardStore`` — production: the flag in `UserDefaults` (key
//      "teslasync-onboarded", identical to the web key) + a `NotificationCenter` peer broadcast so a second
//      window / scene dismisses its own intro instead of two scenes racing the same walkthrough.
//    • ``InMemoryOnboardingWizardStore`` — previews + tests: a seeded flag, call counters, and a manual
//      `simulatePeerDismissal()` so the cross-scene branch is exercised deterministically.
//

import Foundation

// MARK: - Store protocol (P1/S8 seam)

/// The persistence + peer-bus seam the surface binds through. The production app uses
/// ``UserDefaultsOnboardingWizardStore``; previews and tests use ``InMemoryOnboardingWizardStore``. The view
/// reads neither `UserDefaults` nor the notification bus directly.
@MainActor
public protocol OnboardingWizardStore: AnyObject {
    /// Whether onboarding was already completed — the web `localStorage.getItem(ONBOARDED_KEY) != null`. When
    /// `true` the surface stays dismissed and never reveals.
    var hasOnboarded: Bool { get }

    /// Persists the completion flag and broadcasts it to peer scenes — the web `handleClose`
    /// (`localStorage.setItem(...)` + `broadcast({type:'onboarded'})`).
    func markOnboarded()

    /// Invoked on the main actor when a *peer* scene completes onboarding — the web `subscribe` callback that
    /// runs `setVisible(false)`. Set by the model.
    var onDismissedByPeer: (@MainActor () -> Void)? { get set }

    /// Begins observing the peer bus — the web `useEffect(() => subscribe(...))`.
    func start()

    /// Stops observing the peer bus — the web effect cleanup.
    func stop()
}

// MARK: - UserDefaults store (production)

/// The production store. The completion flag lives in `UserDefaults` under the web key "teslasync-onboarded";
/// `markOnboarded()` writes it and posts a `NotificationCenter` broadcast tagged with `self` so peer scenes
/// dismiss their own intro while the posting scene (which already transitioned) ignores its own echo. The
/// observer is selector-based (the established repo pattern, Swift 6 strict-concurrency clean) and is removed
/// in `stop()` and `deinit`, so there is no dangling subscription.
@MainActor
public final class UserDefaultsOnboardingWizardStore: NSObject, OnboardingWizardStore {
    /// The persisted completion key — identical to the web `ONBOARDED_KEY`.
    public static let onboardedKey = "teslasync-onboarded"
    /// The peer-broadcast notification name — the native peer of the web `BroadcastChannel` message.
    /// `nonisolated` so `deinit` (and any thread) can reference it.
    public nonisolated static let didOnboardNotification =
        Notification.Name("io.teslasync.onboardingWizard.didOnboard")

    public var onDismissedByPeer: (@MainActor () -> Void)?

    private let defaults: UserDefaults
    private let center: NotificationCenter
    private var observing = false

    public init(defaults: UserDefaults = .standard, center: NotificationCenter = .default) {
        self.defaults = defaults
        self.center = center
        super.init()
    }

    public var hasOnboarded: Bool {
        defaults.bool(forKey: Self.onboardedKey)
    }

    public func markOnboarded() {
        defaults.set(true, forKey: Self.onboardedKey)
        center.post(name: Self.didOnboardNotification, object: self)
    }

    public func start() {
        guard !observing else { return }
        observing = true
        center.addObserver(
            self,
            selector: #selector(handleDidOnboard(_:)),
            name: Self.didOnboardNotification,
            object: nil
        )
    }

    public func stop() {
        guard observing else { return }
        center.removeObserver(self, name: Self.didOnboardNotification, object: nil)
        observing = false
    }

    @objc
    private func handleDidOnboard(_ note: Notification) {
        // Ignore our own echo — only a peer scene's broadcast dismisses this instance (web subscribe).
        if let object = note.object as AnyObject?, object === self { return }
        onDismissedByPeer?()
    }

    deinit {
        center.removeObserver(self, name: Self.didOnboardNotification, object: nil)
    }
}

// MARK: - In-memory store (previews + tests)

/// In-memory store for previews + unit/UI tests. Seeds the completion flag, counts the lifecycle calls, and
/// exposes `simulatePeerDismissal()` so the cross-scene `subscribe` branch is exercised without a real
/// notification bus.
@MainActor
public final class InMemoryOnboardingWizardStore: OnboardingWizardStore {
    public var onDismissedByPeer: (@MainActor () -> Void)?
    public private(set) var hasOnboarded: Bool
    public private(set) var markOnboardedCount = 0
    public private(set) var startCount = 0
    public private(set) var stopCount = 0

    public init(hasOnboarded: Bool = false) {
        self.hasOnboarded = hasOnboarded
    }

    public func markOnboarded() {
        markOnboardedCount += 1
        hasOnboarded = true
    }

    public func start() {
        startCount += 1
    }

    public func stop() {
        stopCount += 1
    }

    /// Drives the cross-scene dismissal path (the native peer of a peer tab broadcasting `{type:'onboarded'}`).
    public func simulatePeerDismissal() {
        onDismissedByPeer?()
    }
}
