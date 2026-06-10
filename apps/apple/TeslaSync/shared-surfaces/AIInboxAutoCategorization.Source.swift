//
//  AIInboxAutoCategorization.Source.swift
//  TeslaSync — P4 shared surface · 0021 · AIInboxAutoCategorization (Apple)
//
//  The in-memory `InboxCategorySource` for previews + unit/UI tests, split out of `…Model.swift`
//  (one file ≤ 400 lines per the SwiftLint contract). Drive it with `pushInput`, `pushStreamState`,
//  and `pushEvent`, and assert the forwarded action counts. No network, no real store — the model
//  under test is fully deterministic.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`, `pushStreamState`,
/// and `pushEvent`, and assert the forwarded action counts (`startStreamCount`,
/// `cancelStreamCount`, `refreshCount`).
@MainActor
public final class InMemoryInboxCategorySource: InboxCategorySource {
    public var onInput: (@MainActor (InboxCategoryInput) -> Void)?
    public var onStreamState: (@MainActor (InboxCategoryStreamPhase) -> Void)?
    public var onEvent: (@MainActor (InboxCategoryStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0

    private let initial: InboxCategoryInput?

    public init(initial: InboxCategoryInput? = nil) {
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

    public func startStream() {
        startStreamCount += 1
        onStreamState?(.streaming)
    }

    public func cancelStream() {
        cancelStreamCount += 1
    }

    /// Pushes a context snapshot to the bound model (test/preview affordance).
    public func pushInput(_ input: InboxCategoryInput) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: InboxCategoryStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: InboxCategoryStreamEvent) {
        onEvent?(event)
    }

    /// Convenience: emit a successful `draft_alert_categories` tool_result carrying the given
    /// buckets, mirroring the backend SSE frame the web `handleEvent` consumes. Pass an empty
    /// array to exercise the resolved-but-empty "no categories suggested" capture.
    public func pushProposal(_ buckets: [InboxCategoryBucket]) {
        let encoded = buckets.map { InboxCategoryJSONValue.object($0.encodedFields) }
        let data: [String: InboxCategoryJSONValue] = [
            "status": .string("ok"),
            "categories": .array(encoded)
        ]
        onEvent?(.toolResult(InboxCategoryToolResult(
            id: "tr-1",
            name: InboxCategoryBucket.toolName,
            ok: true,
            data: data
        )))
        onStreamState?(.done)
    }
}

// MARK: - Encoding helper (round-trips an `InboxCategoryBucket` to the wire shape)

extension InboxCategoryBucket {
    /// The snake_case JSON object the backend SSE writer emits for one bucket — the inverse of
    /// `InboxCategoryBucket.list(from:)`. Used by `pushProposal` so previews/tests exercise the
    /// real decode path rather than bypassing it.
    var encodedFields: [String: InboxCategoryJSONValue] {
        var fields: [String: InboxCategoryJSONValue] = [
            "category": .string(category),
            "count": .number(Double(count))
        ]
        if let ruleIDs {
            fields["rule_ids"] = .array(ruleIDs.map { .number(Double($0)) })
        }
        if let sampleTitles {
            fields["sample_titles"] = .array(sampleTitles.map { .string($0) })
        }
        return fields
    }
}
