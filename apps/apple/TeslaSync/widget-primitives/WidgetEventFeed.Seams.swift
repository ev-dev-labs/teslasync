//
//  WidgetEventFeed.Seams.swift
//  TeslaSync — P4 widget primitive · 0005 · WidgetEventFeed (Apple)
//
//  The dependency seams the WidgetEventFeed view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 source protocol, the production controlled source (the native
//  parity of a widget host wiring its query result + the props + the feed freshness into the
//  primitive), and the in-memory source for previews / tests.
//
//  Parity note: the web `WidgetEventFeed` is fully controlled — the host (a dashboard widget) decides
//  the `items` + `compact` / `maxItems` / `emptyMessage` and re-renders with new props as its query
//  settles. There is no fetch inside the primitive. `StaticWidgetEventFeedSource` reproduces that: it
//  re-emits the host-provided snapshot on `start` / `refresh`, and `update(_:)` pushes a new one
//  exactly as the web host re-renders the primitive with new props.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host-controlled
/// inputs (`StaticWidgetEventFeedSource`); previews and tests use the in-memory source. The view never
/// reads the items or the connection directly.
@MainActor
public protocol WidgetEventFeedSource: AnyObject {
    var onUpdate: (@MainActor (WidgetEventFeedInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled host inputs)

/// The production source. Holds the host-controlled snapshot (the items + props + the feed freshness +
/// the parent lifecycle) and re-emits it on `start` / `refresh`. The host updates the surface by
/// pushing a fresh snapshot via `update`, exactly as the web host re-renders with new props. No
/// networking — the items are owned upstream.
@MainActor
public final class StaticWidgetEventFeedSource: WidgetEventFeedSource {
    public var onUpdate: (@MainActor (WidgetEventFeedInput) -> Void)?

    private var snapshot: WidgetEventFeedInput

    public init(_ snapshot: WidgetEventFeedInput = WidgetEventFeedInput()) {
        self.snapshot = snapshot
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web host
    /// re-rendering the surface with new items / connectivity / lifecycle.
    public func update(_ input: WidgetEventFeedInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryWidgetEventFeedSource: WidgetEventFeedSource {
    public var onUpdate: (@MainActor (WidgetEventFeedInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WidgetEventFeedInput?

    public init(initial: WidgetEventFeedInput? = nil) {
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
    public func push(_ input: WidgetEventFeedInput) {
        onUpdate?(input)
    }
}
