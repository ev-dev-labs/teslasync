//
//  AINLDashboardComposer.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0031 · AINLDashboardComposer (Apple)
//
//  Typed `tool_result` envelope-decode coverage split out of `…Tests.swift` (one file ≤ 400
//  lines per the SwiftLint contract): `DashboardLayoutDraft.parse` — the native port of the
//  web `parseDashboardLayoutDraft` nested guard chain (status → draft → prompt → rationale →
//  dashboard → title, then the per-slot `panel_name` + numeric `grid_pos` decode and the
//  referenced-panel string filter). Pure + Foundation-only; no view, no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Envelope builders (web `parseDashboardLayoutDraft` fixtures)

private func dashGridDict(
    x: Any? = 0,
    y: Any? = 8,
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

private func dashSlotDict(
    panelName: Any? = "daily-drives",
    grid: [String: Any]? = dashGridDict()
) -> [String: Any] {
    var slot: [String: Any] = [:]
    if let panelName { slot["panel_name"] = panelName }
    if let grid { slot["grid_pos"] = grid }
    return slot
}

private func dashEnvelopeDict(
    title: Any? = "Fleet Overview",
    slots: Any? = [dashSlotDict()]
) -> [String: Any] {
    var dashboard: [String: Any] = [:]
    if let title { dashboard["title"] = title }
    if let slots { dashboard["slots"] = slots }
    return dashboard
}

private func dashDraftDict(
    prompt: Any? = "p",
    rationale: Any? = "r",
    dashboard: Any? = dashEnvelopeDict(),
    referencedPanels: Any? = ["daily-drives", "recent-alerts"]
) -> [String: Any] {
    var draft: [String: Any] = [:]
    if let prompt { draft["prompt"] = prompt }
    if let rationale { draft["rationale"] = rationale }
    if let dashboard { draft["dashboard"] = dashboard }
    if let referencedPanels { draft["referenced_panels"] = referencedPanels }
    return draft
}

private func dashObject(status: String = "ok", draft: [String: Any]? = dashDraftDict()) -> [String: Any] {
    var obj: [String: Any] = ["status": status]
    if let draft { obj["draft"] = draft }
    return obj
}

// MARK: - Typed draft decode (web `parseDashboardLayoutDraft`)

@MainActor final class DashboardLayoutDraftTests: XCTestCase {
    func testParsesValidNestedEnvelope() {
        let parsed = DashboardLayoutDraft.parse(toolResultObject: dashObject())
        XCTAssertEqual(parsed?.prompt, "p")
        XCTAssertEqual(parsed?.rationale, "r")
        XCTAssertEqual(parsed?.dashboard.title, "Fleet Overview")
        XCTAssertEqual(parsed?.dashboard.slots.count, 1)
        XCTAssertEqual(parsed?.dashboard.slots.first?.panelName, "daily-drives")
        XCTAssertEqual(
            parsed?.dashboard.slots.first?.gridPos,
            DashboardSlotGrid(x: 0, y: 8, width: 12, height: 8)
        )
        XCTAssertEqual(parsed?.referencedPanels, ["daily-drives", "recent-alerts"])
    }

    func testParsesFromRawData() {
        let data = InMemoryNLDashboardComposerSource.envelope(for: DashboardLayoutDraft(
            prompt: "p2",
            dashboard: DashboardEnvelope(
                title: "Energy",
                slots: [DashboardSlot(
                    panelName: "charging",
                    gridPos: DashboardSlotGrid(x: 6, y: 0, width: 6, height: 10)
                )]
            ),
            rationale: "r2",
            referencedPanels: ["charging"]
        ))
        let parsed = DashboardLayoutDraft.parse(toolResultData: data)
        XCTAssertEqual(parsed?.dashboard.title, "Energy")
        XCTAssertEqual(parsed?.dashboard.slots.first?.gridPos.width, 6)
        XCTAssertEqual(parsed?.dashboard.slots.first?.gridPos.height, 10)
        XCTAssertEqual(parsed?.referencedPanels, ["charging"])
    }

    func testRejectsNonOkStatus() {
        XCTAssertNil(DashboardLayoutDraft.parse(toolResultObject: dashObject(status: "error")))
    }

    func testRejectsMissingDraft() {
        XCTAssertNil(DashboardLayoutDraft.parse(toolResultObject: dashObject(draft: nil)))
    }

    func testRejectsMissingRequiredStringFields() {
        // Missing prompt.
        XCTAssertNil(DashboardLayoutDraft.parse(
            toolResultObject: dashObject(draft: dashDraftDict(prompt: nil))
        ))
        // Missing rationale.
        XCTAssertNil(DashboardLayoutDraft.parse(
            toolResultObject: dashObject(draft: dashDraftDict(rationale: nil))
        ))
    }

    func testRejectsMissingDashboardObject() {
        XCTAssertNil(DashboardLayoutDraft.parse(
            toolResultObject: dashObject(draft: dashDraftDict(dashboard: nil))
        ))
    }

    func testRejectsMissingTitle() {
        let dashboard = dashEnvelopeDict(title: nil)
        XCTAssertNil(DashboardLayoutDraft.parse(
            toolResultObject: dashObject(draft: dashDraftDict(dashboard: dashboard))
        ))
    }

    func testDefaultsSlotsToEmptyWhenMissingOrWrongType() {
        let noSlots = dashEnvelopeDict(slots: nil)
        XCTAssertEqual(
            DashboardLayoutDraft.parse(
                toolResultObject: dashObject(draft: dashDraftDict(dashboard: noSlots))
            )?.dashboard.slots,
            []
        )
        let wrongType = dashEnvelopeDict(slots: "not-an-array")
        XCTAssertEqual(
            DashboardLayoutDraft.parse(
                toolResultObject: dashObject(draft: dashDraftDict(dashboard: wrongType))
            )?.dashboard.slots,
            []
        )
    }

    func testDropsMalformedSlotsKeepingValidOnes() {
        let slots: [Any] = [
            dashSlotDict(),
            "not-an-object",
            dashSlotDict(panelName: nil),
            dashSlotDict(grid: nil),
            dashSlotDict(grid: dashGridDict(y: nil)),
            dashSlotDict(panelName: "recent-alerts", grid: dashGridDict(x: 6, y: 8, width: 6, height: 8))
        ]
        let dashboard = dashEnvelopeDict(slots: slots)
        let parsed = DashboardLayoutDraft.parse(
            toolResultObject: dashObject(draft: dashDraftDict(dashboard: dashboard))
        )
        // Only the two well-formed slots survive, in order.
        XCTAssertEqual(parsed?.dashboard.slots.map(\.panelName), ["daily-drives", "recent-alerts"])
    }

    func testRejectsNonNumericGridValues() {
        // Web `typeof g.x !== 'number'` — a boolean / string grid value drops the slot.
        let boolGrid = dashSlotDict(grid: dashGridDict(width: true))
        let stringGrid = dashSlotDict(grid: dashGridDict(height: "8"))
        let dashboard = dashEnvelopeDict(slots: [boolGrid, stringGrid])
        let parsed = DashboardLayoutDraft.parse(
            toolResultObject: dashObject(draft: dashDraftDict(dashboard: dashboard))
        )
        XCTAssertEqual(parsed?.dashboard.slots, [])
    }

    func testDefaultsReferencedPanelsToEmptyWhenMissingOrWrongType() {
        let noPanels = DashboardLayoutDraft.parse(
            toolResultObject: dashObject(draft: dashDraftDict(referencedPanels: nil))
        )
        XCTAssertEqual(noPanels?.referencedPanels, [])
        let wrongType = DashboardLayoutDraft.parse(
            toolResultObject: dashObject(draft: dashDraftDict(referencedPanels: "daily-drives"))
        )
        XCTAssertEqual(wrongType?.referencedPanels, [])
    }

    func testFiltersNonStringPanelEntries() {
        let parsed = DashboardLayoutDraft.parse(
            toolResultObject: dashObject(draft: dashDraftDict(
                referencedPanels: ["daily-drives", 42, "recent-alerts", NSNull()]
            ))
        )
        XCTAssertEqual(parsed?.referencedPanels, ["daily-drives", "recent-alerts"])
    }

    func testRejectsEmptyOrMalformedData() {
        XCTAssertNil(DashboardLayoutDraft.parse(toolResultData: nil))
        XCTAssertNil(DashboardLayoutDraft.parse(toolResultData: Data()))
        XCTAssertNil(DashboardLayoutDraft.parse(toolResultData: Data("not json".utf8)))
        XCTAssertNil(DashboardLayoutDraft.parse(toolResultData: Data("[1,2,3]".utf8)))
    }
}
