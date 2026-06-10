//
//  AINLAutomationBuilder.Source.swift
//  TeslaSync — P4 shared surface · 0030 · AINLAutomationBuilder (Apple)
//
//  The in-memory `NLAutomationBuilderSource` for previews + unit/UI tests, split out of
//  `…Model.swift` (one file ≤ 400 lines per the SwiftLint contract). It records the forwarded
//  action counts + the last stream body, and exposes push helpers so the bound model can be
//  driven through every state without a network.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`, `pushStreamState`,
/// and `pushEvent`, and assert the forwarded action counts + the last stream body
/// (`lastStreamVehicleID` / `lastStreamPrompt`).
@MainActor
public final class InMemoryNLAutomationBuilderSource: NLAutomationBuilderSource {
    public var onInput: (@MainActor (NLAutomationBuilderInputSnapshot) -> Void)?
    public var onStreamState: (@MainActor (NLAutomationBuilderStreamPhase) -> Void)?
    public var onEvent: (@MainActor (NLAutomationBuilderStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0
    public private(set) var lastStreamVehicleID: Int64?
    public private(set) var lastStreamPrompt: String?

    private let initial: NLAutomationBuilderInputSnapshot?

    public init(initial: NLAutomationBuilderInputSnapshot? = nil) {
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
    public func pushInput(_ input: NLAutomationBuilderInputSnapshot) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: NLAutomationBuilderStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: NLAutomationBuilderStreamEvent) {
        onEvent?(event)
    }

    /// Convenience: stream a narrative in one shot — emit each chunk as a `delta` frame and then
    /// settle the lifecycle to `done`, mirroring the backend SSE the web `AiOutputPanel` renders.
    public func pushNarrative(_ chunks: [String]) {
        onStreamState?(.streaming)
        for chunk in chunks {
            onEvent?(.delta(text: chunk))
        }
        onStreamState?(.done)
    }
}
