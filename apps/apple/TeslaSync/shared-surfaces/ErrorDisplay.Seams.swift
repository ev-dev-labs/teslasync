//
//  ErrorDisplay.Seams.swift
//  TeslaSync — P4 shared surface · 0120 · ErrorDisplay (Apple)
//
//  The dependency seams the ErrorDisplay view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol, the navigator protocol (the native shape of the web
//  `useNavigate`), the production controlled source (the native parity of the host wiring the failed
//  operation's `error` + `useOnlineStatus` into the surface), the in-memory source for previews /
//  tests, and a recording navigator for previews / tests.
//
//  Parity note: the web `ErrorDisplay` is fully controlled — the host (a page or a mutation panel)
//  decides when it renders and supplies the `error`, `resourceName`, `listHref`, `compact`, and
//  `onRetry`; the `online` state comes from `useOnlineStatus`. There is no fetch inside the component.
//  `StaticErrorDisplaySource` reproduces that: it re-emits the host-provided snapshot on `start` /
//  `refresh`, and `update(_:)` pushes a new one exactly as the web host re-renders with new props or
//  the online state flips.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host-controlled inputs
/// (`StaticErrorDisplaySource`); previews and tests use `InMemoryErrorDisplaySource`. The view never
/// reads the failure or the online state directly.
@MainActor
public protocol ErrorDisplaySource: AnyObject {
    var onUpdate: (@MainActor (ErrorDisplayInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Navigator protocol (web `useNavigate`)

/// The seam the model performs navigation through — the native parity of the web `useNavigate`. The
/// production app implements this over the app router (the 404 `Back to list` → `navigate(listHref)`
/// and the 401/403 `Sign in` → `navigate('/login')`); previews and tests use
/// `RecordingErrorDisplayNavigator`. The model never touches the router directly.
@MainActor
public protocol ErrorDisplayNavigator: AnyObject {
    func navigate(to destination: String)
}

// MARK: - Static source (production — the controlled host inputs)

/// The production source. Holds the host-controlled snapshot (the failed operation's `error` + the
/// resource/list context + the `compact` density + the live online state + the P4 freshness + the
/// parent lifecycle) and re-emits it on `start` / `refresh`. The host updates the surface by pushing a
/// fresh snapshot via `update`, exactly as the web host re-renders with new props. No networking — the
/// data is owned upstream.
@MainActor
public final class StaticErrorDisplaySource: ErrorDisplaySource {
    public var onUpdate: (@MainActor (ErrorDisplayInput) -> Void)?

    private var snapshot: ErrorDisplayInput

    public init(_ snapshot: ErrorDisplayInput = ErrorDisplayInput()) {
        self.snapshot = snapshot
    }

    /// Convenience for the controlled-prop usage — the parity of the web host supplying `error` +
    /// `resourceName` / `listHref` / `compact` plus the `useOnlineStatus` flag.
    public convenience init(
        failure: ErrorFailure?,
        resourceName: String? = nil,
        listHref: String? = nil,
        compact: Bool = false,
        online: Bool = true,
        isStale: Bool = false,
        isLoading: Bool = false
    ) {
        self.init(ErrorDisplayInput(
            failure: failure,
            resourceName: resourceName,
            listHref: listHref,
            compact: compact,
            online: online,
            isStale: isStale,
            isLoading: isLoading
        ))
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web host handing the
    /// component a new `error` or the online state flipping.
    public func update(_ input: ErrorDisplayInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryErrorDisplaySource: ErrorDisplaySource {
    public var onUpdate: (@MainActor (ErrorDisplayInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ErrorDisplayInput?

    public init(initial: ErrorDisplayInput? = nil) {
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
    public func push(_ input: ErrorDisplayInput) {
        onUpdate?(input)
    }
}

// MARK: - Recording navigator (previews + tests)

/// An `ErrorDisplayNavigator` that records the destinations it is asked to navigate to — used by
/// previews (where no real router exists) and tests (to assert the Back-to-list / Sign-in flow).
/// Production injects a real router-backed navigator at the composition root.
@MainActor
public final class RecordingErrorDisplayNavigator: ErrorDisplayNavigator {
    public private(set) var destinations: [String] = []

    public init() {}

    public func navigate(to destination: String) {
        destinations.append(destination)
    }
}
