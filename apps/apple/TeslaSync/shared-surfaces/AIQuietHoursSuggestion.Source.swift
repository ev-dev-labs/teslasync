//
//  AIQuietHoursSuggestion.Source.swift
//  TeslaSync — P4 shared surface · 0041 · AIQuietHoursSuggestion (Apple)
//
//  The in-memory `QuietHoursSuggestionSource` for previews + unit/UI tests, split out of
//  `…Model.swift` (one file ≤ 400 lines per the SwiftLint contract). It records the forwarded action
//  counts and synthesises the backend `draft_quiet_hours_window` SSE frame so the bound model can be
//  driven through every state without a network.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`, `pushStreamState`, and
/// `pushEvent`, and assert the forwarded action counts (`startStreamCount` / `cancelStreamCount` / …).
@MainActor
public final class InMemoryQuietHoursSuggestionSource: QuietHoursSuggestionSource {
    public var onInput: (@MainActor (QuietHoursSuggestionInputSnapshot) -> Void)?
    public var onStreamState: (@MainActor (QuietHoursSuggestionStreamPhase) -> Void)?
    public var onEvent: (@MainActor (QuietHoursSuggestionStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0

    private let initial: QuietHoursSuggestionInputSnapshot?

    public init(initial: QuietHoursSuggestionInputSnapshot? = nil) {
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
    public func pushInput(_ input: QuietHoursSuggestionInputSnapshot) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: QuietHoursSuggestionStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: QuietHoursSuggestionStreamEvent) {
        onEvent?(event)
    }

    /// Convenience: emit a `draft_quiet_hours_window` tool_result carrying a window with the given
    /// fields, mirroring the backend SSE frame the web `onEvent` consumes, then settle the lifecycle
    /// to `done`. `ok` defaults to `true` (the only verdict the web keeps); pass `false` to exercise
    /// the dropped-frame path.
    public func pushProposal(
        startLocal: String = "22:00",
        endLocal: String = "07:00",
        timezone: String = "America/Los_Angeles",
        weekdays: Int = 127,
        bypassSeverities: [String] = ["critical"],
        status: String = "ok",
        existingWindowsCount: Int = 0,
        ok: Bool = true
    ) {
        var data: [String: QuietHoursSuggestionJSON] = [
            "start_local": .string(startLocal),
            "end_local": .string(endLocal),
            "timezone": .string(timezone),
            "weekdays": .number(Double(weekdays)),
            "bypass_severities": .array(bypassSeverities.map { .string($0) }),
            "status": .string(status)
        ]
        if existingWindowsCount > 0 {
            data["existing_windows_count"] = .number(Double(existingWindowsCount))
        }
        onEvent?(.toolResult(QuietHoursSuggestionToolResult(
            id: "tr-1", name: QuietHoursDraftProposal.toolName, ok: ok, data: data
        )))
        onStreamState?(.done)
    }
}
