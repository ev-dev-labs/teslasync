//
//  AIPiiRedactionSharedExports.Source.swift
//  TeslaSync — P4 shared surface · 0038 · AIPiiRedactionSharedExports (Apple)
//
//  The in-memory `PiiRedactionExportsSource` for previews + unit/UI tests, split out of
//  `…Model.swift` (one file ≤ 400 lines per the SwiftLint contract). It records the forwarded
//  action counts + the last stream body, and exposes push helpers so the bound model can be
//  driven through every state without a network.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`, `pushStreamState`,
/// and `pushEvent`, and assert the forwarded action counts + the last stream body
/// (`lastStreamExportType`).
@MainActor
public final class InMemoryPiiRedactionExportsSource: PiiRedactionExportsSource {
    public var onInput: (@MainActor (PiiRedactionExportsInputSnapshot) -> Void)?
    public var onStreamState: (@MainActor (PiiRedactionExportsStreamPhase) -> Void)?
    public var onEvent: (@MainActor (PiiRedactionExportsStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0
    public private(set) var lastStreamExportType: String?

    private let initial: PiiRedactionExportsInputSnapshot?

    public init(initial: PiiRedactionExportsInputSnapshot? = nil) {
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

    public func startStream(exportType: String) {
        startStreamCount += 1
        lastStreamExportType = exportType
        onStreamState?(.streaming)
    }

    public func cancelStream() {
        cancelStreamCount += 1
    }

    /// Pushes a context snapshot to the bound model (test/preview affordance).
    public func pushInput(_ input: PiiRedactionExportsInputSnapshot) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: PiiRedactionExportsStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: PiiRedactionExportsStreamEvent) {
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
