//
//  GuardedLink.Seams.swift
//  TeslaSync — P4 shared surface · 0122 · GuardedLink (Apple)
//
//  The dependency seams the GuardedLink view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 guard-feed protocol (the native shape of the web
//  `useNavigationGuardContext`), the navigator protocol (the native shape of the web `useNavigate`),
//  the production controlled source (re-emits the parent-owned snapshot), the in-memory source for
//  previews / tests, and a recording navigator for previews / tests.
//
//  Parity note: the web `GuardedLink` reads two hooks. `useNavigate` returns the function it calls to
//  perform the navigation; `useNavigationGuardContext` exposes `confirmIfDirty()` over the registered
//  dirty-form guards. The native split mirrors this: `NavigationGuardSource` emits a coalesced
//  `GuardedLinkInput` (the controlled link props + the live dirty state + the store's load /
//  connectivity state) on each change, and `GuardedNavigator` performs the navigation. The view never
//  reads the router or the guard registry directly.
//

import Foundation

// MARK: - Guard-feed protocol (P1/S8 seam)

/// The seam the view binds through for the link's inputs + live guard state. The production app
/// implements this over the registered navigation guards (the web `NavigationGuardProvider` registry);
/// previews and tests use `InMemoryNavigationGuardSource`. The view never reads the registry directly.
@MainActor
public protocol NavigationGuardSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (GuardedLinkInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Navigator protocol (web `useNavigate`)

/// The seam the model performs navigation through — the native parity of the web `useNavigate`. The
/// production app implements this over the app router; previews and tests use
/// `RecordingGuardedNavigator`. The model never touches the router directly.
@MainActor
public protocol GuardedNavigator: AnyObject {
    /// Web `navigate(to, { replace, relative, state })` — the guarded, same-context navigation.
    func navigate(to destination: GuardedDestination, options: GuardedNavigationOptions)
    /// The guard-bypass path (web modifier-click / `target="_blank"`): open the destination in a new
    /// window / scene, leaving the current context's unsaved work mounted.
    func openInNewContext(_ destination: GuardedDestination)
}

// MARK: - Static source (production — the controlled snapshot)

/// The production source. Holds the parent-owned snapshot (the web `to` + forwarded options + the live
/// guard state + connectivity) and re-emits it on `start` / `refresh`. The composition root updates the
/// surface by pushing a fresh snapshot via `update`, exactly as the web parent re-renders the link with
/// a new `to` or the provider reports a new dirty state.
@MainActor
public final class StaticNavigationGuardSource: NavigationGuardSource {
    public var onUpdate: (@MainActor (GuardedLinkInput) -> Void)?

    private var snapshot: GuardedLinkInput

    public init(_ snapshot: GuardedLinkInput = GuardedLinkInput()) {
        self.snapshot = snapshot
    }

    /// Convenience for the controlled-prop usage — the parity of the web parent supplying `to` +
    /// `replace` / `relative` / `state` plus the provider's live dirty state.
    public convenience init(
        destination: GuardedDestination?,
        options: GuardedNavigationOptions = GuardedNavigationOptions(),
        isDirty: Bool = false,
        guardMessage: String? = nil,
        connection: GuardedLinkConnection = .live
    ) {
        self.init(GuardedLinkInput(
            destination: destination,
            options: options,
            isDirty: isDirty,
            guardMessage: guardMessage,
            connection: connection
        ))
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web parent handing
    /// the link a new `to` or the provider reporting a new dirty state.
    public func update(_ snapshot: GuardedLinkInput) {
        self.snapshot = snapshot
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryNavigationGuardSource: NavigationGuardSource {
    public var onUpdate: (@MainActor (GuardedLinkInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: GuardedLinkInput?

    public init(initial: GuardedLinkInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: GuardedLinkInput) {
        onUpdate?(input)
    }
}

// MARK: - Recording navigator (previews + tests)

/// A `GuardedNavigator` that records the navigations it is asked to perform — used by previews (where
/// no real router exists) and tests (to assert the guard-or-navigate flow). Production injects a real
/// router-backed navigator at the composition root.
@MainActor
public final class RecordingGuardedNavigator: GuardedNavigator {
    /// One recorded same-context navigation (web `navigate(to, options)`).
    public struct Navigation: Sendable, Equatable {
        public let destination: GuardedDestination
        public let options: GuardedNavigationOptions
    }

    public private(set) var navigations: [Navigation] = []
    public private(set) var newContextOpens: [GuardedDestination] = []

    public init() {}

    public func navigate(to destination: GuardedDestination, options: GuardedNavigationOptions) {
        navigations.append(Navigation(destination: destination, options: options))
    }

    public func openInNewContext(_ destination: GuardedDestination) {
        newContextOpens.append(destination)
    }
}
