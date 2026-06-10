//
//  AISignalExplorerNlFilter.Source.swift
//  TeslaSync — P4 shared surface · 0046 · AISignalExplorerNlFilter (Apple)
//
//  The in-memory `SignalExplorerFilterSource` for previews + unit/UI tests, split out of
//  `…Model.swift` (one file ≤ 400 lines per the SwiftLint contract). It records the forwarded action
//  counts + the last stream body, and synthesises the backend `draft_signal_filter` SSE frame so the
//  bound model can be driven through every state without a network.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`, `pushStreamState`, and
/// `pushEvent`, and assert the forwarded action counts + the last stream body
/// (`lastStreamVehicleID` / `lastStreamPrompt`).
@MainActor
public final class InMemorySignalExplorerFilterSource: SignalExplorerFilterSource {
    public var onInput: (@MainActor (SignalExplorerFilterInputSnapshot) -> Void)?
    public var onStreamState: (@MainActor (SignalExplorerFilterStreamPhase) -> Void)?
    public var onEvent: (@MainActor (SignalExplorerFilterStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0
    public private(set) var lastStreamVehicleID: Int64?
    public private(set) var lastStreamPrompt: String?

    private let initial: SignalExplorerFilterInputSnapshot?

    public init(initial: SignalExplorerFilterInputSnapshot? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onInput?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func startStream(vehicleID: Int64, prompt: String) {
        startStreamCount += 1
        lastStreamVehicleID = vehicleID
        lastStreamPrompt = prompt
        onStreamState?(.streaming)
    }

    public func cancelStream() {
        cancelStreamCount += 1
    }

    /// Pushes a context snapshot to the bound model (test/preview affordance).
    public func pushInput(_ input: SignalExplorerFilterInputSnapshot) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: SignalExplorerFilterStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: SignalExplorerFilterStreamEvent) {
        onEvent?(event)
    }

    /// Convenience: emit a `draft_signal_filter` tool_result carrying a filter with the given
    /// fields, mirroring the backend SSE frame the web `onEvent` consumes, then settle the lifecycle
    /// to `done`. `status` defaults to `"ok"` (the only verdict the web keeps); pass another value to
    /// exercise the dropped-frame path.
    public func pushDraft(
        vehicleID: Int64,
        signals: [String],
        rangePreset: String,
        perPage: Int,
        status: String = "ok"
    ) {
        let filter: [String: SignalExplorerFilterJSON] = [
            "vehicle_id": .number(Double(vehicleID)),
            "signals": .array(signals.map { .string($0) }),
            "range_preset": .string(rangePreset),
            "per_page": .number(Double(perPage))
        ]
        let data: [String: SignalExplorerFilterJSON] = [
            "draft": .object(filter),
            "status": .string(status)
        ]
        onEvent?(.toolResult(SignalExplorerFilterToolResult(
            id: "tr-1", name: SignalExplorerFilterDraft.toolName, ok: true, data: data
        )))
        onStreamState?(.done)
    }
}
