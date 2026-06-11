//
//  AIRAGHelp.Source.swift
//  TeslaSync — P4 shared surface · 0042 · AIRAGHelp (Apple)
//
//  The in-memory `RAGHelpSource` for previews + unit/UI tests, split out of `…Model.swift`
//  (one file ≤ 400 lines per the SwiftLint contract). It records the forwarded action counts +
//  the last stream body, and synthesises the backend SSE delta frames so the bound model can be
//  driven without a network.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`,
/// `pushStreamState`, and `pushEvent`, and assert the forwarded action counts + the last
/// stream body (`lastStreamPrompt`).
@MainActor
public final class InMemoryRAGHelpSource: RAGHelpSource {
    public var onInput: (@MainActor (RAGHelpInputSnapshot) -> Void)?
    public var onStreamState: (@MainActor (RAGHelpStreamPhase) -> Void)?
    public var onEvent: (@MainActor (RAGHelpStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0
    public private(set) var lastStreamPrompt: String?

    private let initial: RAGHelpInputSnapshot?

    public init(initial: RAGHelpInputSnapshot? = nil) {
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

    public func startStream(prompt: String) {
        startStreamCount += 1
        lastStreamPrompt = prompt
        onStreamState?(.streaming)
    }

    public func cancelStream() {
        cancelStreamCount += 1
    }

    /// Pushes a context snapshot to the bound model (test/preview affordance).
    public func pushInput(_ input: RAGHelpInputSnapshot) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: RAGHelpStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: RAGHelpStreamEvent) {
        onEvent?(event)
    }

    /// Convenience: stream a complete answer (one or more delta frames) and close the stream
    /// with `done`, mirroring the backend's accumulated-narrative SSE frames the web
    /// `AiOutputPanel` consumes.
    public func pushAnswer(_ answer: String, finishReason: String = "stop") {
        onStreamState?(.streaming)
        onEvent?(.delta(text: answer))
        onEvent?(.done(finishReason: finishReason))
        onStreamState?(.done)
    }
}
