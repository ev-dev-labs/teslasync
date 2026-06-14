//
//  AINLGrafanaPanel.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0033 · AINLGrafanaPanel (Apple)
//
//  Typed `tool_result` envelope-decode coverage split out of `…Tests.swift` (one file ≤ 400
//  lines per the SwiftLint contract): `GrafanaPanelDraft.parse` — the native port of the web
//  `parseGrafanaPanelDraft` nested guard chain (status → draft → prompt → rationale → panel →
//  title → type → datasource → targets → grid_pos → referenced_tables). Pure + Foundation-only;
//  no view, no network, no real store.
//
//  Parity note: unlike the dashboard composer's `slots` (which default to `[]`), the Grafana
//  panel's `datasource` and `grid_pos` are REQUIRED — a missing/malformed one collapses the
//  whole draft to `nil` (web returns `null`). `targets` and `referenced_tables` default to `[]`.
//

import XCTest
@testable import TeslaSync

// MARK: - Envelope builders (web `parseGrafanaPanelDraft` fixtures)

private func grafGridDict(
    x: Any? = 0,
    y: Any? = 0,
    width: Any? = 12,
    height: Any? = 8
) -> [String: Any] {
    var grid: [String: Any] = [:]
    if let x { grid["x"] = x }
    if let y { grid["y"] = y }
    if let width { grid["w"] = width }
    if let height { grid["h"] = height }
    return grid
}

private func grafDatasourceDict(type: Any? = "postgres", uid: Any? = "tsdb") -> [String: Any] {
    var datasource: [String: Any] = [:]
    if let type { datasource["type"] = type }
    if let uid { datasource["uid"] = uid }
    return datasource
}

private func grafTargetDict(
    refID: Any? = "A",
    rawSQL: Any? = "SELECT 1",
    expr: Any? = nil,
    format: Any? = "time_series"
) -> [String: Any] {
    var target: [String: Any] = [:]
    if let refID { target["ref_id"] = refID }
    if let rawSQL { target["raw_sql"] = rawSQL }
    if let expr { target["expr"] = expr }
    if let format { target["format"] = format }
    return target
}

private func grafPanelDict(
    title: Any? = "Daily Distance",
    type: Any? = "timeseries",
    datasource: Any? = grafDatasourceDict(),
    targets: Any? = [grafTargetDict()],
    grid: Any? = grafGridDict()
) -> [String: Any] {
    var panel: [String: Any] = [:]
    if let title { panel["title"] = title }
    if let type { panel["type"] = type }
    if let datasource { panel["datasource"] = datasource }
    if let targets { panel["targets"] = targets }
    if let grid { panel["grid_pos"] = grid }
    return panel
}

private func grafDraftDict(
    prompt: Any? = "p",
    rationale: Any? = "r",
    panel: Any? = grafPanelDict(),
    referencedTables: Any? = ["drives", "charging_sessions"]
) -> [String: Any] {
    var draft: [String: Any] = [:]
    if let prompt { draft["prompt"] = prompt }
    if let rationale { draft["rationale"] = rationale }
    if let panel { draft["panel"] = panel }
    if let referencedTables { draft["referenced_tables"] = referencedTables }
    return draft
}

private func grafObject(status: String = "ok", draft: [String: Any]? = grafDraftDict()) -> [String: Any] {
    var obj: [String: Any] = ["status": status]
    if let draft { obj["draft"] = draft }
    return obj
}

// MARK: - Typed draft decode (web `parseGrafanaPanelDraft`)

@MainActor final class GrafanaPanelDraftTests: XCTestCase {
    func testParsesValidNestedEnvelope() {
        let parsed = GrafanaPanelDraft.parse(toolResultObject: grafObject())
        XCTAssertEqual(parsed?.prompt, "p")
        XCTAssertEqual(parsed?.rationale, "r")
        XCTAssertEqual(parsed?.panel.title, "Daily Distance")
        XCTAssertEqual(parsed?.panel.type, "timeseries")
        XCTAssertEqual(parsed?.panel.datasource, GrafanaDatasourceRef(type: "postgres", uid: "tsdb"))
        XCTAssertEqual(parsed?.panel.gridPos, GrafanaPanelGridPos(x: 0, y: 0, width: 12, height: 8))
        XCTAssertEqual(parsed?.panel.targets.count, 1)
        XCTAssertEqual(parsed?.panel.targets.first?.refID, "A")
        XCTAssertEqual(parsed?.panel.targets.first?.rawSQL, "SELECT 1")
        XCTAssertEqual(parsed?.panel.targets.first?.format, "time_series")
        XCTAssertNil(parsed?.panel.targets.first?.expr)
        XCTAssertEqual(parsed?.referencedTables, ["drives", "charging_sessions"])
    }

    func testParsesFromRawData() {
        let data = InMemoryNLGrafanaPanelSource.envelope(for: GrafanaPanelDraft(
            prompt: "p2",
            panel: GrafanaPanelEnvelope(
                title: "Energy",
                type: "barchart",
                datasource: GrafanaDatasourceRef(type: "prometheus", uid: "prom"),
                targets: [GrafanaPanelTarget(refID: "B", rawSQL: nil, expr: "sum(rate(x[5m]))", format: nil)],
                gridPos: GrafanaPanelGridPos(x: 6, y: 0, width: 6, height: 10)
            ),
            rationale: "r2",
            referencedTables: ["signal_log"]
        ))
        let parsed = GrafanaPanelDraft.parse(toolResultData: data)
        XCTAssertEqual(parsed?.panel.title, "Energy")
        XCTAssertEqual(parsed?.panel.type, "barchart")
        XCTAssertEqual(parsed?.panel.datasource.uid, "prom")
        XCTAssertEqual(parsed?.panel.targets.first?.expr, "sum(rate(x[5m]))")
        XCTAssertNil(parsed?.panel.targets.first?.rawSQL)
        XCTAssertEqual(parsed?.panel.gridPos.width, 6)
        XCTAssertEqual(parsed?.referencedTables, ["signal_log"])
    }

    func testRejectsNonOkStatus() {
        XCTAssertNil(GrafanaPanelDraft.parse(toolResultObject: grafObject(status: "error")))
    }

    func testRejectsMissingDraft() {
        XCTAssertNil(GrafanaPanelDraft.parse(toolResultObject: grafObject(draft: nil)))
    }

    func testRejectsMissingRequiredStringFields() {
        XCTAssertNil(GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(prompt: nil))
        ))
        XCTAssertNil(GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(rationale: nil))
        ))
    }

    func testRejectsMissingPanelObject() {
        XCTAssertNil(GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(panel: nil))
        ))
    }

    func testRejectsMissingTitleOrType() {
        let noTitle = grafPanelDict(title: nil)
        XCTAssertNil(GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(panel: noTitle))
        ))
        let noType = grafPanelDict(type: nil)
        XCTAssertNil(GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(panel: noType))
        ))
    }

    func testRejectsMissingOrMalformedDatasource() {
        // Whole draft collapses when datasource is absent (web returns null).
        let noDatasource = grafPanelDict(datasource: nil)
        XCTAssertNil(GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(panel: noDatasource))
        ))
        // Non-string uid → rejected.
        let badUID = grafPanelDict(datasource: grafDatasourceDict(uid: 7))
        XCTAssertNil(GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(panel: badUID))
        ))
    }

    func testRejectsMissingGridPos() {
        // Unlike the dashboard slots, grid_pos is REQUIRED — its absence collapses the draft.
        let noGrid = grafPanelDict(grid: nil)
        XCTAssertNil(GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(panel: noGrid))
        ))
    }

    func testRejectsNonNumericGridValuesCollapsesDraft() {
        // Web `typeof g.x !== 'number'` — a boolean / string grid value rejects the WHOLE draft.
        let boolGrid = grafPanelDict(grid: grafGridDict(width: true))
        XCTAssertNil(GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(panel: boolGrid))
        ))
        let stringGrid = grafPanelDict(grid: grafGridDict(height: "8"))
        XCTAssertNil(GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(panel: stringGrid))
        ))
    }

    func testDefaultsTargetsToEmptyWhenMissingOrWrongType() {
        let noTargets = grafPanelDict(targets: nil)
        XCTAssertEqual(
            GrafanaPanelDraft.parse(
                toolResultObject: grafObject(draft: grafDraftDict(panel: noTargets))
            )?.panel.targets,
            []
        )
        let wrongType = grafPanelDict(targets: "not-an-array")
        XCTAssertEqual(
            GrafanaPanelDraft.parse(
                toolResultObject: grafObject(draft: grafDraftDict(panel: wrongType))
            )?.panel.targets,
            []
        )
    }

    func testDropsMalformedTargetsKeepingValidOnes() {
        let targets: [Any] = [
            grafTargetDict(refID: "A"),
            "not-an-object",
            grafTargetDict(refID: nil),
            grafTargetDict(refID: "B", rawSQL: nil, expr: "up", format: nil)
        ]
        let panel = grafPanelDict(targets: targets)
        let parsed = GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(panel: panel))
        )
        // Only the two well-formed targets survive, in order.
        XCTAssertEqual(parsed?.panel.targets.map(\.refID), ["A", "B"])
    }

    func testTargetOptionalFieldsAreStringGated() {
        // ref_id present but raw_sql/expr/format non-string → kept target, optionals nil.
        let target = grafTargetDict(refID: "A", rawSQL: 42, expr: nil, format: true)
        let panel = grafPanelDict(targets: [target])
        let parsed = GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(panel: panel))
        )
        let first = parsed?.panel.targets.first
        XCTAssertEqual(first?.refID, "A")
        XCTAssertNil(first?.rawSQL)
        XCTAssertNil(first?.expr)
        XCTAssertNil(first?.format)
    }

    func testDefaultsReferencedTablesToEmptyWhenMissingOrWrongType() {
        let noTables = GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(referencedTables: nil))
        )
        XCTAssertEqual(noTables?.referencedTables, [])
        let wrongType = GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(referencedTables: "drives"))
        )
        XCTAssertEqual(wrongType?.referencedTables, [])
    }

    func testFiltersNonStringTableEntries() {
        let parsed = GrafanaPanelDraft.parse(
            toolResultObject: grafObject(draft: grafDraftDict(
                referencedTables: ["drives", 42, "charging_sessions", NSNull()]
            ))
        )
        XCTAssertEqual(parsed?.referencedTables, ["drives", "charging_sessions"])
    }

    func testRejectsEmptyOrMalformedData() {
        XCTAssertNil(GrafanaPanelDraft.parse(toolResultData: nil))
        XCTAssertNil(GrafanaPanelDraft.parse(toolResultData: Data()))
        XCTAssertNil(GrafanaPanelDraft.parse(toolResultData: Data("not json".utf8)))
        XCTAssertNil(GrafanaPanelDraft.parse(toolResultData: Data("[1,2,3]".utf8)))
    }
}
