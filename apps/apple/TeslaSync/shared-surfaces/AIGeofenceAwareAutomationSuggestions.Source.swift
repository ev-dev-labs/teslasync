//
//  AIGeofenceAwareAutomationSuggestions.Source.swift
//  TeslaSync — P4 shared surface · 0020 · AIGeofenceAwareAutomationSuggestions (Apple)
//
//  The in-memory `GeofenceAutomationSource` for previews + unit/UI tests, split out of
//  `…Model.swift` (one file ≤ 400 lines per the SwiftLint contract). It records the
//  forwarded action counts + the last stream body, and synthesises the backend
//  `draft_automation_graph` SSE frame so the bound model can be driven without a network.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`,
/// `pushStreamState`, and `pushEvent`, and assert the forwarded action counts + the last
/// stream body (`lastStreamVehicleID` / `lastStreamPrompt`).
@MainActor
public final class InMemoryGeofenceAutomationSource: GeofenceAutomationSource {
    public var onInput: (@MainActor (GeofenceAutomationInputSnapshot) -> Void)?
    public var onStreamState: (@MainActor (GeofenceAutomationStreamPhase) -> Void)?
    public var onEvent: (@MainActor (GeofenceAutomationStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0
    public private(set) var lastStreamVehicleID: Int64?
    public private(set) var lastStreamPrompt: String?

    private let initial: GeofenceAutomationInputSnapshot?

    public init(initial: GeofenceAutomationInputSnapshot? = nil) {
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
    public func pushInput(_ input: GeofenceAutomationInputSnapshot) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: GeofenceAutomationStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: GeofenceAutomationStreamEvent) {
        onEvent?(event)
    }

    /// Convenience: emit a successful `draft_automation_graph` tool_result carrying a graph
    /// with the given node counts, mirroring the backend SSE frame the web `handleEvent`
    /// consumes. Trigger/condition/action nodes are opaque (the panel only counts them).
    public func pushDraft(
        name: String,
        description: String = "",
        vehicleID: Int64,
        enabled: Bool = true,
        triggers: Int = 0,
        conditions: Int = 0,
        actions: Int = 0,
        status: String,
        validationError: String? = nil
    ) {
        let nodes: (Int) -> GeofenceAutomationJSON = { count in
            .array(Array(repeating: .object([:]), count: count))
        }
        let graph: [String: GeofenceAutomationJSON] = [
            "name": .string(name),
            "description": .string(description),
            "vehicle_id": .number(Double(vehicleID)),
            "enabled": .bool(enabled),
            "triggers": nodes(triggers),
            "conditions": nodes(conditions),
            "actions": nodes(actions)
        ]
        var data: [String: GeofenceAutomationJSON] = [
            "draft": .object(graph),
            "status": .string(status)
        ]
        if let validationError { data["validation_error"] = .string(validationError) }
        onEvent?(.toolResult(GeofenceAutomationToolResult(
            id: "tr-1", name: GeofenceAutomationDraft.toolName, ok: true, data: data
        )))
        onStreamState?(.done)
    }
}
