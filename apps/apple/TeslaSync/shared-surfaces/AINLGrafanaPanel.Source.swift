//
//  AINLGrafanaPanel.Source.swift
//  TeslaSync — P4 shared surface · 0033 · AINLGrafanaPanel (Apple)
//
//  The in-memory `NLGrafanaPanelSource` for previews + unit/UI tests, split out of
//  `…Model.swift` (one file ≤ 400 lines per the SwiftLint contract). It records the forwarded
//  action counts + the last stream body, and synthesises the backend SSE frames (delta text +
//  the `draft_grafana_panel` tool_result envelope) so the bound model can be driven without a
//  network.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`, `pushStreamState`,
/// `pushEvent`, and the `pushDraft` / `pushAnswer` conveniences, and assert the forwarded action
/// counts + the last stream body (`lastStreamPrompt`).
@MainActor
public final class InMemoryNLGrafanaPanelSource: NLGrafanaPanelSource {
    public var onInput: (@MainActor (NLGrafanaPanelInputSnapshot) -> Void)?
    public var onStreamState: (@MainActor (NLGrafanaPanelStreamPhase) -> Void)?
    public var onEvent: (@MainActor (NLGrafanaPanelStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0
    public private(set) var lastStreamPrompt: String?

    private let initial: NLGrafanaPanelInputSnapshot?

    public init(initial: NLGrafanaPanelInputSnapshot? = nil) {
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
    public func pushInput(_ input: NLGrafanaPanelInputSnapshot) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: NLGrafanaPanelStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: NLGrafanaPanelStreamEvent) {
        onEvent?(event)
    }

    /// Pushes a `tool_result` frame carrying a raw JSON envelope string (the backend's
    /// `draft_grafana_panel` payload), letting tests exercise the adapter decode + the model's
    /// name/status guards directly.
    public func pushToolResult(
        name: String = NLGrafanaPanelSurface.draftToolName,
        ok: Bool = true,
        json: String
    ) {
        onEvent?(.toolResult(id: "tr-1", name: name, ok: ok, data: Data(json.utf8)))
    }

    /// Convenience: stream the rationale (one or more delta frames), emit the typed
    /// `draft_grafana_panel` `tool_result` for `draft`, then close with `done` — mirroring the
    /// backend's accumulated-narrative + tool-result SSE frames the web surface consumes.
    public func pushDraft(
        _ draft: GrafanaPanelDraft,
        rationaleDeltas: [String] = [],
        finishReason: String = "stop"
    ) {
        onStreamState?(.streaming)
        for delta in rationaleDeltas {
            onEvent?(.delta(text: delta))
        }
        onEvent?(.toolResult(
            id: "tr-1",
            name: NLGrafanaPanelSurface.draftToolName,
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
    /// nested shape `GrafanaPanelDraft.parse` (and the web `parseGrafanaPanelDraft`) expects —
    /// including the `grid_pos` `w`/`h` wire keys and the per-target `ref_id` / `raw_sql` /
    /// `expr` / `format` snake_case keys. Pure (no actor state), so it is `nonisolated` and
    /// callable from any context (tests/previews).
    public nonisolated static func envelope(for draft: GrafanaPanelDraft) -> Data {
        let payload: [String: Any] = [
            "status": "ok",
            "draft": [
                "prompt": draft.prompt,
                "panel": panelDict(draft.panel),
                "rationale": draft.rationale,
                "referenced_tables": draft.referencedTables
            ]
        ]
        return (try? JSONSerialization.data(withJSONObject: payload)) ?? Data()
    }

    /// Encodes one panel envelope (title / type / datasource / targets / grid_pos) to the wire
    /// shape, omitting each target's absent optional keys (web only sets `raw_sql` / `expr` /
    /// `format` when the value is a string).
    private nonisolated static func panelDict(_ panel: GrafanaPanelEnvelope) -> [String: Any] {
        [
            "title": panel.title,
            "type": panel.type,
            "datasource": [
                "type": panel.datasource.type,
                "uid": panel.datasource.uid
            ],
            "targets": panel.targets.map(targetDict),
            "grid_pos": [
                "x": panel.gridPos.x,
                "y": panel.gridPos.y,
                "w": panel.gridPos.width,
                "h": panel.gridPos.height
            ]
        ]
    }

    /// Encodes one target, attaching only the optional keys that are present.
    private nonisolated static func targetDict(_ target: GrafanaPanelTarget) -> [String: Any] {
        var dict: [String: Any] = ["ref_id": target.refID]
        if let rawSQL = target.rawSQL { dict["raw_sql"] = rawSQL }
        if let expr = target.expr { dict["expr"] = expr }
        if let format = target.format { dict["format"] = format }
        return dict
    }
}
