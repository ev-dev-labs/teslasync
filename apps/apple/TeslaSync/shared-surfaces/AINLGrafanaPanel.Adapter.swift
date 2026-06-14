//
//  AINLGrafanaPanel.Adapter.swift
//  TeslaSync — P4 shared surface · 0033 · AINLGrafanaPanel (Apple)
//
//  The testable projection core for the "Helix natural-language Grafana panel drafter" panel —
//  the SwiftUI parity of components/ai/AINLGrafanaPanel.tsx. Everything here is pure +
//  dependency-free (Foundation only — no SwiftUI, no Observation, no network), so the
//  request-body projection (the web `body` useMemo `{ prompt }`), the prompt validity gate
//  (web `hasPrompt`), and the typed `tool_result` envelope decode (the web
//  `parseGrafanaPanelDraft`) are all unit tested in isolation without rendering a view.
//
//  Parity note: the web component computes
//    const trimmed = prompt.trim()
//    const hasPrompt = trimmed.length > 0
//    const body = useMemo(() => ({ prompt: trimmed }), [trimmed])
//  and, when the LLM emits a `tool_result` for `draft_grafana_panel`, captures a typed
//  GrafanaPanelDraft via `parseGrafanaPanelDraft(ev.data)`.
//  `NLGrafanaPanelRequest.project` reproduces the body walk; `GrafanaPanelDraft.parse`
//  reproduces the defensive nested decode (envelope → datasource → targets → grid) bit-for-bit,
//  so the POSTed `{ prompt }` body (POST /api/v1/ai/power/grafana-panel/draft, guard
//  `nl-grafana-panel`) and the propose-only draft capture stay faithful (ADR-015 §I8).
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`) and
/// the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum NLGrafanaPanelSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AINLGrafanaPanel"
    /// The AI feature id (web `withAiFeature('nl-grafana-panel', …)`).
    public static let featureID = "nl-grafana-panel"
    /// The tool name whose `tool_result` carries the typed draft (web
    /// `ev.name === 'draft_grafana_panel'`).
    public static let draftToolName = "draft_grafana_panel"
}

// MARK: - Request projection (web `body` useMemo + `prompt.trim()`)

/// The projected POST body for `/ai/power/grafana-panel/draft` — the native mirror of the web
/// `body` useMemo `{ prompt: trimmed }`. The `prompt` is trimmed (web `prompt.trim()`); the
/// validity gate reproduces the web `hasPrompt = prompt.trim().length > 0` boolean the
/// "Draft panel" button reads. The view never builds this directly — the model projects it
/// from the user's prompt before handing it to the source's `startStream`.
public struct NLGrafanaPanelRequest: Equatable, Sendable {
    /// The trimmed prompt text (web `trimmed = prompt.trim()`).
    public let prompt: String

    public init(prompt: String) {
        self.prompt = prompt
    }

    /// Native port of the web `body` useMemo: trim the raw prompt (web `prompt.trim()`) so a
    /// whitespace-only prompt cannot start a stream. The trimmed value is what the on-mode
    /// stream POSTs, matching the wire contract `{ prompt }`.
    public static func project(rawPrompt: String) -> NLGrafanaPanelRequest {
        NLGrafanaPanelRequest(prompt: rawPrompt.trimmingCharacters(in: .whitespacesAndNewlines))
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

// MARK: - Typed draft envelope (web `GrafanaPanelDraft` + `parseGrafanaPanelDraft`)

/// A panel's dashboard-grid placement — the native mirror of the web `GrafanaPanelGridPos`
/// (and the Go-side `GrafanaPanelGridPos` DTO, all `int`). The wire keys are `w`/`h`; the Swift
/// properties are spelled `width`/`height` for readability (the parser maps `w`→`width`,
/// `h`→`height`). Grid coordinates are integers (Grafana grid units).
public struct GrafanaPanelGridPos: Equatable, Sendable {
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

/// The panel's datasource reference — the native mirror of the web `GrafanaDatasourceRef`:
/// the datasource `type` (e.g. "postgres") plus its stable `uid`.
public struct GrafanaDatasourceRef: Equatable, Sendable {
    /// The datasource type (web `datasource.type`).
    public let type: String
    /// The datasource uid (web `datasource.uid`).
    public let uid: String

    public init(type: String, uid: String) {
        self.type = type
        self.uid = uid
    }
}

/// One query target in the proposed panel — the native mirror of the web `GrafanaPanelTarget`:
/// a required `ref_id` plus the optional `raw_sql` / `expr` / `format` the panel query carries.
/// The optionals are present only when the wire value is a string (web's per-field `typeof`
/// guard); a missing value stays `nil`.
public struct GrafanaPanelTarget: Equatable, Sendable {
    /// The target ref id (web `ref_id`, e.g. "A").
    public let refID: String
    /// The raw SQL the target runs, when present (web `raw_sql`).
    public let rawSQL: String?
    /// The PromQL/expr the target runs, when present (web `expr`).
    public let expr: String?
    /// The result format hint, when present (web `format`, e.g. "time_series").
    public let format: String?

    public init(refID: String, rawSQL: String? = nil, expr: String? = nil, format: String? = nil) {
        self.refID = refID
        self.rawSQL = rawSQL
        self.expr = expr
        self.format = format
    }
}

/// The proposed panel envelope — the native mirror of the web `GrafanaPanelEnvelope`: the panel
/// title + type, its datasource ref, the ordered query targets, and the grid placement.
public struct GrafanaPanelEnvelope: Equatable, Sendable {
    /// Human-readable panel title (web `panel.title`).
    public let title: String
    /// The Grafana panel type (web `panel.type`, e.g. "timeseries").
    public let type: String
    /// The datasource the panel queries (web `panel.datasource`).
    public let datasource: GrafanaDatasourceRef
    /// The ordered query targets (web `panel.targets`).
    public let targets: [GrafanaPanelTarget]
    /// The panel's grid placement (web `panel.grid_pos`).
    public let gridPos: GrafanaPanelGridPos

    public init(
        title: String,
        type: String,
        datasource: GrafanaDatasourceRef,
        targets: [GrafanaPanelTarget],
        gridPos: GrafanaPanelGridPos
    ) {
        self.title = title
        self.type = type
        self.datasource = datasource
        self.targets = targets
        self.gridPos = gridPos
    }
}

/// The typed payload the Helix panel captures when the LLM successfully calls
/// `draft_grafana_panel` — the native mirror of the web `GrafanaPanelDraft` interface (and the
/// Go-side `GrafanaPanelDraft` DTO in internal/ai/tools/nl_grafana_panel.go). The field set is
/// intentionally narrow: only the panel-envelope fields the deterministic editor already owns.
/// The LLM never pushes the panel to Grafana (ADR-015 §I8 propose-only); the user applies the
/// draft explicitly.
public struct GrafanaPanelDraft: Equatable, Sendable {
    /// The natural-language prompt the draft answers (web `prompt`).
    public let prompt: String
    /// The proposed panel envelope (web `panel`).
    public let panel: GrafanaPanelEnvelope
    /// Helix's short explanation of the panel (web `rationale`).
    public let rationale: String
    /// The DB tables the draft references (web `referenced_tables`, snake_case on the wire).
    public let referencedTables: [String]

    public init(
        prompt: String,
        panel: GrafanaPanelEnvelope,
        rationale: String,
        referencedTables: [String]
    ) {
        self.prompt = prompt
        self.panel = panel
        self.rationale = rationale
        self.referencedTables = referencedTables
    }

    /// Native port of the web `parseGrafanaPanelDraft(data: unknown)`: decode the raw
    /// `tool_result` `data` JSON bytes and validate the envelope shape. Returns `nil` for any
    /// non-conforming payload (no data, not an object, `status !== 'ok'`, missing/!string
    /// prompt/rationale/title/type, missing datasource, missing/non-numeric grid_pos), exactly
    /// like the web guard chain.
    public static func parse(toolResultData data: Data?) -> GrafanaPanelDraft? {
        guard let data, !data.isEmpty,
              let root = try? JSONSerialization.jsonObject(with: data),
              let object = root as? [String: Any]
        else { return nil }
        return parse(toolResultObject: object)
    }

    /// The decoded-object form of the web `parseGrafanaPanelDraft` guard chain, split out so it
    /// is unit tested without round-tripping through `Data`. The check order mirrors the web
    /// source exactly: status → draft → prompt → rationale → panel → title → type → datasource
    /// (type, uid) → targets (optional) → grid_pos (required) → referenced_tables filter.
    public static func parse(toolResultObject object: [String: Any]) -> GrafanaPanelDraft? {
        guard (object["status"] as? String) == "ok" else { return nil }
        guard let draftObject = object["draft"] as? [String: Any] else { return nil }
        guard let prompt = draftObject["prompt"] as? String,
              let rationale = draftObject["rationale"] as? String
        else { return nil }
        guard let panel = parsePanel(draftObject["panel"]) else { return nil }
        // Web: `Array.isArray(referenced_tables) ? filter(string) : []`.
        let tables = (draftObject["referenced_tables"] as? [Any])?
            .compactMap { $0 as? String } ?? []
        return GrafanaPanelDraft(
            prompt: prompt,
            panel: panel,
            rationale: rationale,
            referencedTables: tables
        )
    }

    /// Web panel guard: the panel must be an object with string `title` + `type`, a valid
    /// `datasource`, and a valid `grid_pos`; `targets` is optional (defaults to `[]`). Any
    /// missing required field collapses the whole draft to `nil` (web returns `null`).
    private static func parsePanel(_ raw: Any?) -> GrafanaPanelEnvelope? {
        guard let panelObject = raw as? [String: Any] else { return nil }
        guard let title = panelObject["title"] as? String,
              let type = panelObject["type"] as? String
        else { return nil }
        guard let datasource = parseDatasource(panelObject["datasource"]) else { return nil }
        guard let gridPos = parseGridPos(panelObject["grid_pos"]) else { return nil }
        let targets = parseTargets(panelObject["targets"])
        return GrafanaPanelEnvelope(
            title: title,
            type: type,
            datasource: datasource,
            targets: targets,
            gridPos: gridPos
        )
    }

    /// Web datasource guard: an object whose `type` + `uid` are both strings, else the panel
    /// (and the whole draft) is rejected.
    private static func parseDatasource(_ raw: Any?) -> GrafanaDatasourceRef? {
        guard let datasourceObject = raw as? [String: Any] else { return nil }
        guard let type = datasourceObject["type"] as? String,
              let uid = datasourceObject["uid"] as? String
        else { return nil }
        return GrafanaDatasourceRef(type: type, uid: uid)
    }

    /// Web: `Array.isArray(p.targets) ? targets.map(parse).filter(nonNull) : []`. A non-array
    /// (or absent) value yields no targets; each malformed target is dropped (web `map → null →
    /// filter`), the conforming ones kept in order.
    private static func parseTargets(_ raw: Any?) -> [GrafanaPanelTarget] {
        guard let array = raw as? [Any] else { return [] }
        return array.compactMap { parseTarget($0) }
    }

    /// Web per-target guard: the target must be an object with a string `ref_id`; the optional
    /// `raw_sql` / `expr` / `format` are attached only when each is a string (web per-field
    /// `typeof === 'string'`).
    private static func parseTarget(_ raw: Any) -> GrafanaPanelTarget? {
        guard let targetObject = raw as? [String: Any] else { return nil }
        guard let refID = targetObject["ref_id"] as? String else { return nil }
        return GrafanaPanelTarget(
            refID: refID,
            rawSQL: targetObject["raw_sql"] as? String,
            expr: targetObject["expr"] as? String,
            format: targetObject["format"] as? String
        )
    }

    /// Web grid guard: an object whose `x`/`y`/`w`/`h` are all numbers, else the panel (and the
    /// whole draft) is rejected. The grid is integer (Grafana grid units, Go `int`).
    private static func parseGridPos(_ raw: Any?) -> GrafanaPanelGridPos? {
        guard let gridObject = raw as? [String: Any] else { return nil }
        guard let x = numericInt(gridObject["x"]),
              let y = numericInt(gridObject["y"]),
              let width = numericInt(gridObject["w"]),
              let height = numericInt(gridObject["h"])
        else { return nil }
        return GrafanaPanelGridPos(x: x, y: y, width: width, height: height)
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
