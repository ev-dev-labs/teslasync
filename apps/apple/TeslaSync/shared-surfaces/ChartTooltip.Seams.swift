//
//  ChartTooltip.Seams.swift
//  TeslaSync — P4 shared surface · 0070 · ChartTooltip (Apple)
//
//  The dependency seams the ChartTooltip view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S8 source protocol, the production source that holds the chart's
//  current selection and re-emits it as a snapshot, and the in-memory source for previews/tests.
//
//  Parity note: the web `ChartTooltip` owns no data — Recharts pushes `active` + `payload` +
//  `label` into it on every hover/focus and clears them when the cursor leaves the plot. The
//  native source reproduces that contract: the host chart calls `update(_:)` with the current
//  selection (or an inactive snapshot when the cursor leaves), and the source coalesces that into
//  the `ChartTooltipInput` the model projects. The feed is local + synchronous — no HTTP — so
//  `start` / `refresh` simply re-emit the current selection.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host chart's
/// selection (`LiveChartTooltipSource`); previews and tests use `InMemoryChartTooltipSource`. The
/// view never reads the chart selection directly.
@MainActor
public protocol ChartTooltipSource: AnyObject {
    var onUpdate: (@MainActor (ChartTooltipInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — holds the chart's current selection)

/// The production source. Holds the host chart's current selection and re-emits it as a coalesced
/// `ChartTooltipInput` whenever the chart updates it — the native bridge between the chart's
/// hover/focus events and the surface's snapshot contract. Defaults to an inactive selection so a
/// freshly-mounted readout shows the empty state until the cursor lands on a point (web `active`
/// starting `false`).
@MainActor
public final class LiveChartTooltipSource: ChartTooltipSource {
    public var onUpdate: (@MainActor (ChartTooltipInput) -> Void)?

    private var selection: ChartTooltipInput

    public init(selection: ChartTooltipInput = ChartTooltipInput()) {
        self.selection = selection
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the chart's current selection and re-emits it — the native parity of Recharts pushing
    /// a fresh `active` / `payload` / `label` into the tooltip on hover/focus, or an inactive
    /// snapshot when the cursor leaves the plot.
    public func update(_ selection: ChartTooltipInput) {
        self.selection = selection
        emit()
    }

    private func emit() {
        onUpdate?(selection)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryChartTooltipSource: ChartTooltipSource {
    public var onUpdate: (@MainActor (ChartTooltipInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChartTooltipInput?

    public init(initial: ChartTooltipInput? = nil) {
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
    public func push(_ input: ChartTooltipInput) {
        onUpdate?(input)
    }
}
