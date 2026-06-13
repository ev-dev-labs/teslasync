//
//  AINLDashboardComposer.Source.swift
//  TeslaSync — P4 shared surface · 0031 · AINLDashboardComposer (Apple)
//
//  The in-memory `NLDashboardComposerSource` for previews + unit/UI tests, split out of
//  `…Model.swift` (one file ≤ 400 lines per the SwiftLint contract). It records the forwarded
//  action counts + the last stream body, and synthesises the backend SSE frames (delta text +
//  the `draft_dashboard_layout` tool_result envelope) so the bound model can be driven without
//  a network.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`,
/// `pushStreamState`, `pushEvent`, and the `pushDraft` / `pushAnswer` conveniences, and assert
/// the forwarded action counts + the last stream body (`lastStreamPrompt`).
@MainActor
public final class InMemoryNLDashboardComposerSource: NLDashboardComposerSource {
    public var onInput: (@MainActor (NLDashboardComposerInputSnapshot) -> Void)?
    public var onStreamState: (@MainActor (NLDashboardComposerStreamPhase) -> Void)?
    public var onEvent: (@MainActor (NLDashboardComposerStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0
    public private(set) var lastStreamPrompt: String?

    private let initial: NLDashboardComposerInputSnapshot?

    public init(initial: NLDashboardComposerInputSnapshot? = nil) {
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
    public func pushInput(_ input: NLDashboardComposerInputSnapshot) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: NLDashboardComposerStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: NLDashboardComposerStreamEvent) {
        onEvent?(event)
    }

    /// Pushes a `tool_result` frame carrying a raw JSON envelope string (the backend's
    /// `draft_dashboard_layout` payload), letting tests exercise the adapter decode + the
    /// model's name/status guards directly.
    public func pushToolResult(
        name: String = NLDashboardComposerSurface.draftToolName,
        ok: Bool = true,
        json: String
    ) {
        onEvent?(.toolResult(id: "tr-1", name: name, ok: ok, data: Data(json.utf8)))
    }

    /// Convenience: stream the rationale (one or more delta frames), emit the typed
    /// `draft_dashboard_layout` `tool_result` for `draft`, then close with `done` — mirroring
    /// the backend's accumulated-narrative + tool-result SSE frames the web surface consumes.
    public func pushDraft(
        _ draft: DashboardLayoutDraft,
        rationaleDeltas: [String] = [],
        finishReason: String = "stop"
    ) {
        onStreamState?(.streaming)
        for delta in rationaleDeltas {
            onEvent?(.delta(text: delta))
        }
        onEvent?(.toolResult(
            id: "tr-1",
            name: NLDashboardComposerSurface.draftToolName,
            ok: true,
            data: Self.envelope(for: draft)
        ))
        onEvent?(.done(finishReason: finishReason))
        onStreamState?(.done)
    }

    /// Convenience: stream a plain narrative rationale with no draft (delta frames + `done`).
    public func pushAnswer(_ answer: String, finishReason: String = "stop") {
        onStreamState?(.streaming)
        onEvent?(.delta(text: answer))
        onEvent?(.done(finishReason: finishReason))
        onStreamState?(.done)
    }

    /// Encodes the backend `{ status: "ok", draft: { … } }` envelope for `draft`, matching the
    /// nested shape `DashboardLayoutDraft.parse` (and the web `parseDashboardLayoutDraft`)
    /// expects — including the `grid_pos` `w`/`h` wire keys. Pure (no actor state), so it is
    /// `nonisolated` and callable from any context (tests/previews).
    public nonisolated static func envelope(for draft: DashboardLayoutDraft) -> Data {
        let slots: [[String: Any]] = draft.dashboard.slots.map { slot in
            [
                "panel_name": slot.panelName,
                "grid_pos": [
                    "x": slot.gridPos.x,
                    "y": slot.gridPos.y,
                    "w": slot.gridPos.width,
                    "h": slot.gridPos.height
                ]
            ]
        }
        let payload: [String: Any] = [
            "status": "ok",
            "draft": [
                "prompt": draft.prompt,
                "dashboard": [
                    "title": draft.dashboard.title,
                    "slots": slots
                ],
                "rationale": draft.rationale,
                "referenced_panels": draft.referencedPanels
            ]
        ]
        return (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
    }
}
