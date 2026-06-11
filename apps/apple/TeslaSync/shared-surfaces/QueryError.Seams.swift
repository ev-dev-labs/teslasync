//
//  QueryError.Seams.swift
//  TeslaSync — P4 shared surface · 0133 · QueryError (Apple)
//
//  The dependency seams the QueryError view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol, the navigator protocol (the native shape of the web
//  `useNavigate`), the production controlled source (the native parity of the host wiring the failed
//  query `error` + `useOnlineStatus` into the surface), the in-memory source for previews / tests, and
//  a recording navigator for previews / tests.
//
//  Parity note: the web `QueryError` is fully controlled — the host (a page or a `QueryBoundary`)
//  decides when it renders and supplies the `error`, `resourceName`, `listHref`, and `onRetry`; the
//  `online` state comes from `useOnlineStatus`. There is no fetch inside the component.
//  `StaticQueryErrorSource` reproduces that: it re-emits the host-provided snapshot on `start` /
//  `refresh`, and `update(_:)` pushes a new one exactly as the web host re-renders with new props or
//  the online state flips.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host-controlled
/// inputs (`StaticQueryErrorSource`); previews and tests use `InMemoryQueryErrorSource`. The view
/// never reads the query error or the online state directly.
@MainActor
public protocol QueryErrorSource: AnyObject {
    var onUpdate: (@MainActor (QueryErrorInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Navigator protocol (web `useNavigate`)

/// The seam the model performs navigation through — the native parity of the web `useNavigate`. The
/// production app implements this over the app router (the 404 `Back to list` → `navigate(listHref)`
/// and the 401/403 `Sign in` → `navigate('/login')`); previews and tests use
/// `RecordingQueryErrorNavigator`. The model never touches the router directly.
@MainActor
public protocol QueryErrorNavigator: AnyObject {
    func navigate(to destination: String)
}

// MARK: - Static source (production — the controlled host inputs)

/// The production source. Holds the host-controlled snapshot (the failed query `error` + the
/// resource/list context + the live online state + the P4 freshness + the parent lifecycle) and
/// re-emits it on `start` / `refresh`. The host updates the surface by pushing a fresh snapshot via
/// `update`, exactly as the web host re-renders with new props. No networking — the data is owned
/// upstream.
@MainActor
public final class StaticQueryErrorSource: QueryErrorSource {
    public var onUpdate: (@MainActor (QueryErrorInput) -> Void)?

    private var snapshot: QueryErrorInput

    public init(_ snapshot: QueryErrorInput = QueryErrorInput()) {
        self.snapshot = snapshot
    }

    /// Convenience for the controlled-prop usage — the parity of the web host supplying `error` +
    /// `resourceName` / `listHref` plus the `useOnlineStatus` flag.
    public convenience init(
        failure: QueryFailure?,
        resourceName: String? = nil,
        listHref: String? = nil,
        online: Bool = true,
        isStale: Bool = false,
        isLoading: Bool = false
    ) {
        self.init(QueryErrorInput(
            failure: failure,
            resourceName: resourceName,
            listHref: listHref,
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

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web host handing
    /// the component a new `error` or the online state flipping.
    public func update(_ input: QueryErrorInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, with call counters for the lifecycle assertions.
@MainActor
public final class InMemoryQueryErrorSource: QueryErrorSource {
    public var onUpdate: (@MainActor (QueryErrorInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: QueryErrorInput?

    public init(initial: QueryErrorInput? = nil) {
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
    public func push(_ input: QueryErrorInput) {
        onUpdate?(input)
    }
}

// MARK: - Recording navigator (previews + tests)

/// A `QueryErrorNavigator` that records the destinations it is asked to navigate to — used by previews
/// (where no real router exists) and tests (to assert the Back-to-list / Sign-in flow). Production
/// injects a real router-backed navigator at the composition root.
@MainActor
public final class RecordingQueryErrorNavigator: QueryErrorNavigator {
    public private(set) var destinations: [String] = []

    public init() {}

    public func navigate(to destination: String) {
        destinations.append(destination)
    }
}
