//
//  ReloadPrompt.Seams.swift
//  TeslaSync — P4 shared surface · 0136 · ReloadPrompt (Apple)
//
//  The dependency seams the ReloadPrompt view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol (the native shape of the web `useRegisterSW`
//  registration owner), the production controlled source (re-emits the parent-owned registration state
//  and bridges the "activate + reload" hand-off), and the in-memory source for previews / tests.
//
//  Parity note: the web data owner is `useRegisterSW` (vite-plugin-pwa), which surfaces `needRefresh`
//  (a newer build is staged), `updateServiceWorker(reload)` (activate it + reload), and an
//  `onRegisteredSW` hook that re-checks every five minutes. The production app implements
//  `ReloadPromptSource` over the platform update channel (the shared P1/S8 app-update store) and the
//  source emits a coalesced `ReloadPromptUpdate` (the staged-update flag + the check's load /
//  connectivity state) on each change. `applyUpdate()` is the native peer of `updateServiceWorker(true)`
//  — the composition root wires it to the app's update activation (relaunch into the staged build) — and
//  `dismiss()` is the peer of clearing `needRefresh`. The view never reads the registration directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the shared app-update
/// channel; previews and tests use `InMemoryReloadPromptSource`. The view never reads the registration
/// directly.
@MainActor
public protocol ReloadPromptSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ReloadPromptUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-checks for a newer build (web `registration.update()`).
    func refresh()
    /// Activates the staged build and reloads (web `updateServiceWorker(true)`).
    func applyUpdate()
    /// Clears the staged-update flag so the banner stays hidden (web `setNeedRefresh(false)`).
    func dismiss()
}

// MARK: - Static source (production — the controlled registration)

/// The production source. Holds the parent-owned snapshot (the web `useRegisterSW` state) and re-emits
/// it on `start` / `refresh`. The composition root updates the surface by pushing a fresh snapshot via
/// `update`, exactly as the web hook re-renders the banner when `needRefresh` changes. `applyUpdate()`
/// forwards to the injected activation closure (the native `updateServiceWorker(true)`); `dismiss()`
/// clears the staged-update flag locally and re-emits so a reconnect does not resurrect the banner.
@MainActor
public final class StaticReloadPromptSource: ReloadPromptSource {
    public var onUpdate: (@MainActor (ReloadPromptUpdate) -> Void)?

    private var snapshot: ReloadPromptUpdate
    private let onApply: @MainActor () -> Void

    public init(
        _ snapshot: ReloadPromptUpdate = ReloadPromptUpdate(),
        onApply: @escaping @MainActor () -> Void = {}
    ) {
        self.snapshot = snapshot
        self.onApply = onApply
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    public func applyUpdate() {
        onApply()
    }

    public func dismiss() {
        snapshot.updateAvailable = false
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web hook handing the
    /// banner a new `needRefresh` / connectivity state.
    public func update(_ snapshot: ReloadPromptUpdate) {
        self.snapshot = snapshot
        onUpdate?(snapshot)
    }

    /// Marks a newer build as staged and re-emits — the native parity of the web `onNeedRefresh`
    /// callback flipping `needRefresh` true.
    public func markUpdateAvailable() {
        snapshot.updateAvailable = true
        snapshot.status = .idle
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryReloadPromptSource: ReloadPromptSource {
    public var onUpdate: (@MainActor (ReloadPromptUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var applyCount = 0
    public private(set) var dismissCount = 0

    private let initial: ReloadPromptUpdate?

    public init(initial: ReloadPromptUpdate? = nil) {
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

    public func applyUpdate() {
        applyCount += 1
    }

    public func dismiss() {
        dismissCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: ReloadPromptUpdate) {
        onUpdate?(update)
    }
}
