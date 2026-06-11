//
//  AINLSqlPlayground.Tests.swift
//  TeslaSync — P4 shared surface · 0035 · AINLSqlPlayground (Apple)
//
//  Unit coverage for the AINLSqlPlayground surface:
//    • Adapter — the request-body projection (the web `body` useMemo `{ prompt }` + `prompt
//      .trim()`), the validity gate (web `hasPrompt`), and the typed `tool_result` envelope
//      decode (the web `parseReadonlySQLDraft` guard chain).
//    • Logic — the prompt/stream-lifecycle button logic (isBusy / canStart / buttonDisabled /
//      canApply / output visibility / thinking / idle-invite / emptyHint).
//    • Accessibility — the spoken summary across phases + the draft-ready cue.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store.
//  Per-state view rendering is covered by the #Preview blocks (compiled by the app targets);
//  the per-state *behaviour* is asserted in `…ModelTests.swift`.
//

import XCTest
@testable import TeslaSync

// MARK: - Request projection (web `body` useMemo + validity gate)

@MainActor final class NLSqlPlaygroundRequestTests: XCTestCase {
    func testProjectTrimsPrompt() {
        let request = NLSqlPlaygroundRequest.project(rawPrompt: "  how many drives last week\n")
        XCTAssertEqual(request.prompt, "how many drives last week")
    }

    func testPromptValidityRequiresNonEmpty() {
        XCTAssertTrue(NLSqlPlaygroundRequest(prompt: "a").isPromptValid)
        XCTAssertFalse(NLSqlPlaygroundRequest(prompt: "").isPromptValid)
    }

    func testCanStartRequiresNonEmptyPrompt() {
        XCTAssertTrue(NLSqlPlaygroundRequest(prompt: "drives last week").canStart)
        XCTAssertFalse(NLSqlPlaygroundRequest(prompt: "").canStart)
    }

    func testProjectionFeedsValidityFromRawWhitespace() {
        let request = NLSqlPlaygroundRequest.project(rawPrompt: "   \n\t ")
        XCTAssertEqual(request.prompt, "")
        XCTAssertFalse(request.isPromptValid)
        XCTAssertFalse(request.canStart)
    }

    func testProjectionHasNoCharacterCap() {
        let long = String(repeating: "select ", count: 1000)
        let request = NLSqlPlaygroundRequest.project(rawPrompt: long + "  ")
        XCTAssertEqual(request.prompt, long.trimmingCharacters(in: .whitespacesAndNewlines))
        XCTAssertTrue(request.canStart)
    }

    func testSurfaceConstants() {
        XCTAssertEqual(NLSqlPlaygroundSurface.slug, "AINLSqlPlayground")
        XCTAssertEqual(NLSqlPlaygroundSurface.featureID, "nl-sql-playground")
        XCTAssertEqual(NLSqlPlaygroundSurface.draftToolName, "draft_readonly_sql")
    }
}

// MARK: - Typed draft decode (web `parseReadonlySQLDraft`)

@MainActor final class ReadonlySQLDraftTests: XCTestCase {
    private func object(
        status: String = "ok",
        draft: [String: Any]? = [
            "prompt": "p", "sql": "SELECT 1", "rationale": "r",
            "referenced_tables": ["drives", "charging_sessions"]
        ]
    ) -> [String: Any] {
        var obj: [String: Any] = ["status": status]
        if let draft { obj["draft"] = draft }
        return obj
    }

    func testParsesValidEnvelope() {
        let parsed = ReadonlySQLDraft.parse(toolResultObject: object())
        XCTAssertEqual(parsed?.prompt, "p")
        XCTAssertEqual(parsed?.sql, "SELECT 1")
        XCTAssertEqual(parsed?.rationale, "r")
        XCTAssertEqual(parsed?.referencedTables, ["drives", "charging_sessions"])
    }

    func testParsesFromRawData() {
        let data = InMemoryNLSqlPlaygroundSource.envelope(for: ReadonlySQLDraft(
            prompt: "p", sql: "SELECT 2", rationale: "r2", referencedTables: ["drives"]
        ))
        let parsed = ReadonlySQLDraft.parse(toolResultData: data)
        XCTAssertEqual(parsed?.sql, "SELECT 2")
        XCTAssertEqual(parsed?.referencedTables, ["drives"])
    }

    func testRejectsNonOkStatus() {
        XCTAssertNil(ReadonlySQLDraft.parse(toolResultObject: object(status: "error")))
    }

    func testRejectsMissingDraft() {
        XCTAssertNil(ReadonlySQLDraft.parse(toolResultObject: object(draft: nil)))
    }

    func testRejectsMissingRequiredStringFields() {
        XCTAssertNil(ReadonlySQLDraft.parse(toolResultObject: object(draft: [
            "sql": "SELECT 1", "rationale": "r"
        ])))
        XCTAssertNil(ReadonlySQLDraft.parse(toolResultObject: object(draft: [
            "prompt": "p", "rationale": "r"
        ])))
        XCTAssertNil(ReadonlySQLDraft.parse(toolResultObject: object(draft: [
            "prompt": "p", "sql": "SELECT 1"
        ])))
    }

    func testDefaultsTablesToEmptyWhenMissingOrWrongType() {
        let noTables = ReadonlySQLDraft.parse(toolResultObject: object(draft: [
            "prompt": "p", "sql": "SELECT 1", "rationale": "r"
        ]))
        XCTAssertEqual(noTables?.referencedTables, [])

        let wrongType = ReadonlySQLDraft.parse(toolResultObject: object(draft: [
            "prompt": "p", "sql": "SELECT 1", "rationale": "r", "referenced_tables": "drives"
        ]))
        XCTAssertEqual(wrongType?.referencedTables, [])
    }

    func testFiltersNonStringTableEntries() {
        let parsed = ReadonlySQLDraft.parse(toolResultObject: object(draft: [
            "prompt": "p", "sql": "SELECT 1", "rationale": "r",
            "referenced_tables": ["drives", 42, "charging_sessions", NSNull()]
        ]))
        XCTAssertEqual(parsed?.referencedTables, ["drives", "charging_sessions"])
    }

    func testRejectsEmptyOrMalformedData() {
        XCTAssertNil(ReadonlySQLDraft.parse(toolResultData: nil))
        XCTAssertNil(ReadonlySQLDraft.parse(toolResultData: Data()))
        XCTAssertNil(ReadonlySQLDraft.parse(toolResultData: Data("not json".utf8)))
        XCTAssertNil(ReadonlySQLDraft.parse(toolResultData: Data("[1,2,3]".utf8)))
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel + canApply)

@MainActor final class NLSqlPlaygroundLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(NLSqlPlaygroundLogic.isBusy(.streaming))
        XCTAssertTrue(NLSqlPlaygroundLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(NLSqlPlaygroundLogic.isBusy(.idle))
        XCTAssertFalse(NLSqlPlaygroundLogic.isBusy(.done))
        XCTAssertFalse(NLSqlPlaygroundLogic.isBusy(.error("x")))
    }

    func testCanStartRequiresPrompt() {
        XCTAssertTrue(NLSqlPlaygroundLogic.canStart(prompt: "go"))
        XCTAssertFalse(NLSqlPlaygroundLogic.canStart(prompt: ""))
        XCTAssertFalse(NLSqlPlaygroundLogic.canStart(prompt: "   \n "))
    }

    func testButtonDisabled() {
        XCTAssertFalse(NLSqlPlaygroundLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLSqlPlaygroundLogic.buttonDisabled(
            prompt: "go", phase: .streaming, connection: .live
        ))
        XCTAssertTrue(NLSqlPlaygroundLogic.buttonDisabled(
            prompt: "", phase: .idle, connection: .live
        ))
        XCTAssertTrue(NLSqlPlaygroundLogic.buttonDisabled(
            prompt: "go", phase: .idle, connection: .offline
        ))
    }

    func testCanApply() {
        XCTAssertTrue(NLSqlPlaygroundLogic.canApply(hasDraft: true, phase: .done))
        XCTAssertTrue(NLSqlPlaygroundLogic.canApply(hasDraft: true, phase: .idle))
        XCTAssertFalse(NLSqlPlaygroundLogic.canApply(hasDraft: false, phase: .done))
        XCTAssertFalse(NLSqlPlaygroundLogic.canApply(hasDraft: true, phase: .streaming))
    }

    func testOutputVisible() {
        XCTAssertFalse(NLSqlPlaygroundLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(NLSqlPlaygroundLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(NLSqlPlaygroundLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(NLSqlPlaygroundLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(NLSqlPlaygroundLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(NLSqlPlaygroundLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(NLSqlPlaygroundLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(NLSqlPlaygroundLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(NLSqlPlaygroundLogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(NLSqlPlaygroundLogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(NLSqlPlaygroundLogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testEmptyHintReflectsPrompt() {
        XCTAssertEqual(NLSqlPlaygroundLogic.emptyHint(prompt: "", phase: .idle), .enterPrompt)
        XCTAssertEqual(NLSqlPlaygroundLogic.emptyHint(prompt: "  \n", phase: .idle), .enterPrompt)
        XCTAssertNil(NLSqlPlaygroundLogic.emptyHint(prompt: "drives last week", phase: .idle))
        XCTAssertNil(NLSqlPlaygroundLogic.emptyHint(prompt: "", phase: .streaming))
        XCTAssertNil(NLSqlPlaygroundLogic.emptyHint(prompt: "", phase: .pausedConfirm))
    }
}

// MARK: - Accessibility summary

@MainActor final class NLSqlPlaygroundAccessibilityTests: XCTestCase {
    private let labels = NLSqlPlaygroundAccessibility.Labels(
        title: "Helix natural-language SQL drafter",
        thinking: "Helix is thinking…",
        resultsReady: "Rationale ready",
        draftReady: "SQL draft ready to apply",
        error: "Helix error:"
    )

    func testIdleReadsTitleOnly() {
        let summary = NLSqlPlaygroundAccessibility.summary(
            labels: labels, phase: .idle, hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language SQL drafter")
    }

    func testStreamingAppendsThinking() {
        let summary = NLSqlPlaygroundAccessibility.summary(
            labels: labels, phase: .streaming, hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language SQL drafter. Helix is thinking…")
    }

    func testStreamingSuppressesDraftCue() {
        // While streaming the draft cue is held back (web `canApply` is false mid-stream).
        let summary = NLSqlPlaygroundAccessibility.summary(
            labels: labels, phase: .streaming, hasAnswer: false, hasDraft: true
        )
        XCTAssertEqual(summary, "Helix natural-language SQL drafter. Helix is thinking…")
    }

    func testDoneWithAnswerAppendsRationaleReady() {
        let summary = NLSqlPlaygroundAccessibility.summary(
            labels: labels, phase: .done, hasAnswer: true, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language SQL drafter. Rationale ready")
    }

    func testDoneWithDraftAppendsDraftReady() {
        let summary = NLSqlPlaygroundAccessibility.summary(
            labels: labels, phase: .done, hasAnswer: true, hasDraft: true
        )
        XCTAssertEqual(
            summary,
            "Helix natural-language SQL drafter. Rationale ready. SQL draft ready to apply"
        )
    }

    func testErrorAppendsLabelAndMessage() {
        let summary = NLSqlPlaygroundAccessibility.summary(
            labels: labels, phase: .error("rate limited"), hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(
            summary, "Helix natural-language SQL drafter. Helix error: rate limited"
        )
    }

    func testEmptyErrorMessageReadsLabelOnly() {
        let summary = NLSqlPlaygroundAccessibility.summary(
            labels: labels, phase: .error(""), hasAnswer: false, hasDraft: false
        )
        XCTAssertEqual(summary, "Helix natural-language SQL drafter. Helix error:")
    }
}

// MARK: - i18n facade

@MainActor final class NLSqlPlaygroundStringsTests: XCTestCase {
    /// The "AINLSqlPlayground" table folds in at integration time, so the test bundle resolves
    /// each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            NLSqlPlaygroundStrings.string(
                "powerSql.aiDrafter.title", "Helix natural-language SQL drafter"
            ),
            "Helix natural-language SQL drafter"
        )
        XCTAssertEqual(
            NLSqlPlaygroundStrings.string("powerSql.aiDrafter.button", "Draft SQL"),
            "Draft SQL"
        )
        XCTAssertEqual(
            NLSqlPlaygroundStrings.string("powerSql.aiDrafter.applyButton", "Apply to editor"),
            "Apply to editor"
        )
        XCTAssertEqual(NLSqlPlaygroundStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(
            NLSqlPlaygroundStrings.string(
                "powerSql.aiDrafter.promptLabel", "SQL request"
            ),
            "SQL request"
        )
    }
}
