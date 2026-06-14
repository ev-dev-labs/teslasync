//
//  WidgetRankedList.Seams.swift
//  TeslaSync — P4 widget primitive · 0009 · WidgetRankedList (Apple)
//
//  The dependency seams the WidgetRankedList view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol, the production controlled source (the native parity of a
//  widget host wiring its query result + the props + the data freshness into the primitive), and the
//  in-memory source for previews / tests.
//
//  Parity note: the web `<WidgetRankedList>` is fully controlled — the host (a dashboard widget) decides
//  the `items` + `maxItems` / `compact` / `showBars` / `emptyMessage` and re-renders with new props as its
//  query settles. There is no fetch inside the primitive. ``StaticWidgetRankedListSource`` reproduces that:
//  it re-emits the host-provided snapshot on `start` / `refresh`, and `update(_:)` pushes a new one exactly
//  as the web host re-renders the primitive with new props.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host-controlled inputs
/// (``StaticWidgetRankedListSource``); previews and tests use the in-memory source. The view never reads
/// the items or the connection directly.
@MainActor
public protocol WidgetRankedListSource: AnyObject {
    var onUpdate: (@MainActor (WidgetRankedListInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Static source (production — the controlled host inputs)

/// The production source. Holds the host-controlled snapshot (the items + props + the data freshness + the
/// parent lifecycle) and re-emits it on `start` / `refresh`. The host updates the surface by pushing a
/// fresh snapshot via `update`, exactly as the web host re-renders with new props. No networking — the
/// items are owned upstream.
@MainActor
public final class StaticWidgetRankedListSource: WidgetRankedListSource {
    public var onUpdate: (@MainActor (WidgetRankedListInput) -> Void)?

    private var snapshot: WidgetRankedListInput

    public init(_ snapshot: WidgetRankedListInput = WidgetRankedListInput()) {
        self.snapshot = snapshot
    }

    public func start() {
        onUpdate?(snapshot)
    }

    public func stop() {}

    public func refresh() {
        onUpdate?(snapshot)
    }

    /// Replaces the controlled snapshot and re-emits it — the native parity of the web host re-rendering
    /// the surface with new items / connectivity / lifecycle.
    public func update(_ input: WidgetRankedListInput) {
        snapshot = input
        onUpdate?(snapshot)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, asserting the lifecycle call counts.
@MainActor
public final class InMemoryWidgetRankedListSource: WidgetRankedListSource {
    public var onUpdate: (@MainActor (WidgetRankedListInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WidgetRankedListInput?

    public init(initial: WidgetRankedListInput? = nil) {
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
    public func push(_ input: WidgetRankedListInput) {
        onUpdate?(input)
    }
}
