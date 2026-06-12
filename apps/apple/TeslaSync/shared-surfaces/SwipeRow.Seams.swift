//
//  SwipeRow.Seams.swift
//  TeslaSync — P4 shared surface · 0189 · SwipeRow (Apple)
//
//  The dependency seams the SwipeRow view-model binds through (P1/S8), kept apart from the model for
//  the lint length budget: the source protocol, the production controlled source (the native parity
//  of the host wiring a row's swipe-enabled capability + content + live-connection into the surface),
//  the platform coarse-pointer probe (the native `useIsCoarsePointer` default), and the in-memory
//  source for previews / tests.
//
//  Parity note: the web SwipeRow owns no data — the props are pushed by the parent every render — so
//  the live source reproduces that by holding the host's current snapshot and re-emitting it on
//  `update(_:)` / `start` / `refresh`. Both feeds are local + synchronous (no HTTP), matching the
//  web source.
//

import Foundation

// MARK: - Coarse-pointer probe (native `useIsCoarsePointer` default)

/// The platform default for the web `useIsCoarsePointer()` capability the surface binds to. iOS /
/// iPadOS are touch-first (coarse → swipe active); macOS is pointer-first (fine → the row renders as
/// a straight pass-through, exactly as the web component attaches zero handlers on a fine pointer).
/// A host that knows better (e.g. an iPad with an attached trackpad, or a desktop touch display) can
/// override the value when constructing the surface.
public enum SwipeRowCapability {
    public static var coarsePointerDefault: Bool {
        #if os(iOS)
            true
        #else
            false
        #endif
    }
}

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host-controlled
/// inputs (`StaticSwipeRowSource`); previews and tests use `InMemorySwipeRowSource`. The view never
/// reads the capability or the connection directly.
@MainActor
public protocol SwipeRowSource: AnyObject {
    var onUpdate: (@MainActor (SwipeRowInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled host inputs)

/// The production source. Holds the host-controlled snapshot (the resolved swipe-enabled capability +
/// content + live-connection freshness + the parent lifecycle) and re-emits it on `start` / `refresh`.
/// The host updates the surface by pushing a fresh snapshot via `update`, exactly as the web row
/// re-renders with new props. No networking — the data is owned upstream.
@MainActor
public final class StaticSwipeRowSource: SwipeRowSource {
    public var onUpdate: (@MainActor (SwipeRowInput) -> Void)?

    private var snapshot: SwipeRowInput

    public init(snapshot: SwipeRowInput) {
        self.snapshot = snapshot
    }

    /// Convenience initializer mirroring the web prop signature — `isCoarsePointer` defaults to the
    /// platform probe (the web `useIsCoarsePointer()` default) and is overridden by a host `enabled`.
    public convenience init(
        isCoarsePointer: Bool = SwipeRowCapability.coarsePointerDefault,
        hasContent: Bool = true,
        connection: SwipeRowConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        self.init(snapshot: SwipeRowInput(
            isCoarsePointer: isCoarsePointer,
            hasContent: hasContent,
            connection: connection,
            isLoading: isLoading,
            errorMessage: errorMessage
        ))
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web row
    /// re-rendering with a new capability / content / connectivity.
    public func update(_ input: SwipeRowInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Emits an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`. The call counters let the wiring +
/// delegation be asserted without a host.
@MainActor
public final class InMemorySwipeRowSource: SwipeRowSource {
    public var onUpdate: (@MainActor (SwipeRowInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SwipeRowInput?

    public init(initial: SwipeRowInput? = nil) {
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
    public func push(_ input: SwipeRowInput) {
        onUpdate?(input)
    }
}
