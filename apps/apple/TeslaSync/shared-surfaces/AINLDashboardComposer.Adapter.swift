//
//  AINLDashboardComposer.Adapter.swift
//  TeslaSync — P4 shared surface · 0031 · AINLDashboardComposer (Apple)
//
//  The testable projection core for the "Helix natural-language dashboard composer" panel —
//  the SwiftUI parity of components/ai/AINLDashboardComposer.tsx. Everything here is pure +
//  dependency-free (Foundation only — no SwiftUI, no Observation, no network), so the
//  request-body projection (the web `body` useMemo `{ prompt }`), the prompt validity gate
//  (web `hasPrompt`), and the typed `tool_result` envelope decode (the web
//  `parseDashboardLayoutDraft`) are all unit tested in isolation without rendering a view.
//
//  Parity note: the web component computes
//    const trimmed = prompt.trim()
//    const hasPrompt = trimmed.length > 0
//    const body = useMemo(() => ({ prompt: trimmed }), [trimmed])
//  and, when the LLM emits a `tool_result` for `draft_dashboard_layout`, captures a typed
//  DashboardLayoutDraft via `parseDashboardLayoutDraft(ev.data)`.
//  `NLDashboardComposerRequest.project` reproduces the body walk; `DashboardLayoutDraft.parse`
//  reproduces the defensive nested decode (envelope → slots → grid) bit-for-bit, so the POSTed
//  `{ prompt }` body (POST /api/v1/ai/power/dashboard/draft, guard `nl-dashboard-composer`)
//  and the propose-only draft capture stay faithful (ADR-015 §I8 propose-only).
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`) and
/// the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum NLDashboardComposerSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AINLDashboardComposer"
    /// The AI feature id (web `withAiFeature('nl-dashboard-composer', …)`).
    public static let featureID = "nl-dashboard-composer"
    /// The tool name whose `tool_result` carries the typed draft (web
    /// `ev.name === 'draft_dashboard_layout'`).
    public static let draftToolName = "draft_dashboard_layout"
}

// MARK: - Request projection (web `body` useMemo + `prompt.trim()`)

/// The projected POST body for `/ai/power/dashboard/draft` — the native mirror of the web
/// `body` useMemo `{ prompt: trimmed }`. The `prompt` is trimmed (web `prompt.trim()`); the
/// validity gate reproduces the web `hasPrompt = prompt.trim().length > 0` boolean the
/// "Draft dashboard" button reads. The view never builds this directly — the model projects it
/// from the user's prompt before handing it to the source's `startStream`.
public struct NLDashboardComposerRequest: Equatable, Sendable {
    /// The trimmed prompt text (web `trimmed = prompt.trim()`).
    public let prompt: String

    public init(prompt: String) {
        self.prompt = prompt
    }

    /// Native port of the web `body` useMemo: trim the raw prompt (web `prompt.trim()`) so a
    /// whitespace-only prompt cannot start a stream. The trimmed value is what the on-mode
    /// stream POSTs, matching the wire contract `{ prompt }`.
    public static func project(rawPrompt: String) -> NLDashboardComposerRequest {
        NLDashboardComposerRequest(prompt: rawPrompt.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// Web `hasPrompt = trimmed.length > 0` — the AIFeatureCard button gate's only input
    /// predicate (this surface has no vehicle scope and no character cap).
    public var isPromptValid: Bool {
        !prompt.isEmpty
    }

    /// Web `canStart = hasPrompt`. The prompt validity is the whole gate.
    public var canStart: Bool {
        isPromptValid
    }
}

// MARK: - Typed draft envelope (web `DashboardLayoutDraft` + `parseDashboardLayoutDraft`)

/// One panel slot's dashboard-grid placement — the native mirror of the web `DashboardSlotGrid`
/// (and the Go-side `DashboardSlotGrid` DTO, all `int`). The wire keys are `w`/`h`; the Swift
/// properties are spelled `width`/`height` for readability (the parser maps `w`→`width`,
/// `h`→`height`). Grid coordinates are integers (Grafana grid units).
public struct DashboardSlotGrid: Equatable, Sendable {
    /// Grid x-coordinate (web `grid_pos.x`).
    public let x: Int
    /// Grid y-coordinate (web `grid_pos.y`).
    public let y: Int
    /// Grid width in columns (web `grid_pos.w`).
    public let width: Int
    /// Grid height in rows (web `grid_pos.h`).
    public let height: Int

    public init(x: Int, y: Int, width: Int, height: Int) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

/// One panel slot in the proposed dashboard — the native mirror of the web `DashboardSlot`:
/// a curated-catalog panel name plus its grid placement.
public struct DashboardSlot: Equatable, Sendable {
    /// The panel name from the in-scope curated catalog (web `panel_name`).
    public let panelName: String
    /// The slot's dashboard-grid placement (web `grid_pos`).
    public let gridPos: DashboardSlotGrid

    public init(panelName: String, gridPos: DashboardSlotGrid) {
        self.panelName = panelName
        self.gridPos = gridPos
    }
}

/// The proposed dashboard envelope — the native mirror of the web `DashboardEnvelope`: a title
/// plus the ordered list of panel slots.
public struct DashboardEnvelope: Equatable, Sendable {
    /// Human-readable dashboard title (web `dashboard.title`).
    public let title: String
    /// The ordered panel slots (web `dashboard.slots`).
    public let slots: [DashboardSlot]

    public init(title: String, slots: [DashboardSlot]) {
        self.title = title
        self.slots = slots
    }
}

/// The typed payload the Helix panel captures when the LLM successfully calls
/// `draft_dashboard_layout` — the native mirror of the web `DashboardLayoutDraft` interface
/// (and the Go-side `DashboardLayoutDraft` DTO in internal/ai/tools/nlq/dashboard.go). The
/// field set is intentionally narrow: only the dashboard-envelope fields the deterministic
/// composer already owns. The LLM never pushes the dashboard to Grafana (ADR-015 §I8
/// propose-only); the user applies the draft explicitly.
public struct DashboardLayoutDraft: Equatable, Sendable {
    /// The natural-language prompt the draft answers (web `prompt`).
    public let prompt: String
    /// The proposed dashboard envelope (web `dashboard`).
    public let dashboard: DashboardEnvelope
    /// Helix's short explanation of the dashboard (web `rationale`).
    public let rationale: String
    /// The curated panels the draft references (web `referenced_panels`, snake_case on the wire).
    public let referencedPanels: [String]

    public init(
        prompt: String,
        dashboard: DashboardEnvelope,
        rationale: String,
        referencedPanels: [String]
    ) {
        self.prompt = prompt
        self.dashboard = dashboard
        self.rationale = rationale
        self.referencedPanels = referencedPanels
    }

    /// Native port of the web `parseDashboardLayoutDraft(data: unknown)`: decode the raw
    /// `tool_result` `data` JSON bytes and validate the envelope shape. Returns `nil` for any
    /// non-conforming payload (no data, not an object, `status !== 'ok'`, missing/!string
    /// prompt/rationale/title, missing dashboard object), exactly like the web guard chain.
    public static func parse(toolResultData data: Data?) -> DashboardLayoutDraft? {
        guard let data, !data.isEmpty,
              let root = try? JSONSerialization.jsonObject(with: data),
              let object = root as? [String: Any]
        else { return nil }
        return parse(toolResultObject: object)
    }

    /// The decoded-object form of the web `parseDashboardLayoutDraft` guard chain, split out so
    /// it is unit tested without round-tripping through `Data`. The check order mirrors the web
    /// source exactly: status → draft → prompt → rationale → dashboard → title, then the
    /// per-slot decode and the referenced-panel filter.
    public static func parse(toolResultObject object: [String: Any]) -> DashboardLayoutDraft? {
        guard (object["status"] as? String) == "ok" else { return nil }
        guard let draftObject = object["draft"] as? [String: Any] else { return nil }
        guard let prompt = draftObject["prompt"] as? String,
              let rationale = draftObject["rationale"] as? String
        else { return nil }
        guard let dashboardObject = draftObject["dashboard"] as? [String: Any] else { return nil }
        guard let title = dashboardObject["title"] as? String else { return nil }
        let slots = parseSlots(dashboardObject["slots"])
        // Web: `Array.isArray(referenced_panels) ? filter(string) : []`.
        let panels = (draftObject["referenced_panels"] as? [Any])?
            .compactMap { $0 as? String } ?? []
        return DashboardLayoutDraft(
            prompt: prompt,
            dashboard: DashboardEnvelope(title: title, slots: slots),
            rationale: rationale,
            referencedPanels: panels
        )
    }

    /// Web: `Array.isArray(dash.slots) ? slots.map(parse).filter(nonNull) : []`. A non-array
    /// (or absent) value yields no slots; each malformed slot is dropped (web `map → null →
    /// filter`), the conforming ones kept in order.
    private static func parseSlots(_ raw: Any?) -> [DashboardSlot] {
        guard let array = raw as? [Any] else { return [] }
        return array.compactMap { parseSlot($0) }
    }

    /// Web per-slot guard: the slot must be an object with a string `panel_name` and a
    /// `grid_pos` object whose `x`/`y`/`w`/`h` are all numbers — otherwise the slot is dropped.
    private static func parseSlot(_ raw: Any) -> DashboardSlot? {
        guard let slotObject = raw as? [String: Any] else { return nil }
        guard let panelName = slotObject["panel_name"] as? String else { return nil }
        guard let gridObject = slotObject["grid_pos"] as? [String: Any] else { return nil }
        guard let x = numericInt(gridObject["x"]),
              let y = numericInt(gridObject["y"]),
              let width = numericInt(gridObject["w"]),
              let height = numericInt(gridObject["h"])
        else { return nil }
        return DashboardSlot(
            panelName: panelName,
            gridPos: DashboardSlotGrid(x: x, y: y, width: width, height: height)
        )
    }

    /// Web `typeof === 'number'` — accept a JSON number and reject booleans (JS
    /// `typeof true === 'boolean'`), strings, and missing values. `JSONSerialization` bridges
    /// JSON booleans to `NSNumber`, so the `CFBoolean` type is excluded explicitly. The grid is
    /// integer (Grafana grid units, Go `int`), so the number is taken as its `intValue`.
    private static func numericInt(_ raw: Any?) -> Int? {
        guard let number = raw as? NSNumber else { return nil }
        if CFGetTypeID(number) == CFBooleanGetTypeID() { return nil }
        return number.intValue
    }
}
