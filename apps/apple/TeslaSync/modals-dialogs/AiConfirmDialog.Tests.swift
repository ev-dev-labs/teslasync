//
//  AiConfirmDialog.Tests.swift
//  TeslaSync — P4 modal / dialog · 0001 · ConfirmDialog (Apple)
//
//  Projection + accessibility coverage for the AiConfirmDialog surface — the pure data adapter:
//    • `AiConfirmProjection.introText` — the web `tool.mutates ? intro.mutates : intro.read` selection.
//    • `AiConfirmProjection.formatArguments` — the web `JSON.stringify(args ?? {}, null, 2)`: the `{}`
//      empty default, nesting + arrays, integer / double / bool / null rendering, and string escaping.
//    • `AiConfirmProjection.resolvePhase` / `resolveVisibility` / `inlineFailure` — the body phase, the
//      visibility machine (incl. pinned), and the inline envelope.
//    • `AiConfirmProjection.titleText` / `toolLabelText` / `argsLabelText` / `confirmLabelText` /
//      `cancelLabelText` + `confirmDisabled` / `cancelDisabled` — the copy + the disabled rules.
//    • `AiConfirmAccessibility` — the dialog summary, the tool label, the arguments label, and the
//      close VoiceOver copy.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Intro selection (web tool.mutates)

final class AiConfirmIntroTests: XCTestCase {
    func testIntroSelectsByMutates() {
        XCTAssertEqual(
            AiConfirmProjection.introText(mutates: false, localize: passthroughLocalize),
            "The assistant wants to run a tool. Review the inputs, then approve or cancel."
        )
        XCTAssertEqual(
            AiConfirmProjection.introText(mutates: true, localize: passthroughLocalize),
            "The assistant wants to make a change to your data. Review what it will do, then approve or cancel."
        )
    }
}

// MARK: - Argument pretty-printer (web JSON.stringify(args ?? {}, null, 2))

final class AiConfirmArgumentsTests: XCTestCase {
    func testNilAndEmptyRenderEmptyObject() {
        XCTAssertEqual(AiConfirmProjection.formatArguments(nil), "{}")
        XCTAssertEqual(AiConfirmProjection.formatArguments([]), "{}")
    }

    func testSingleIntegerMember() {
        XCTAssertEqual(
            AiConfirmProjection.formatArguments([AiJSONMember("vehicle_id", .integer(42))]),
            "{\n  \"vehicle_id\": 42\n}"
        )
    }

    func testMultipleMembersPreserveOrder() {
        let members = [
            AiJSONMember("b", .integer(1)),
            AiJSONMember("a", .integer(2))
        ]
        XCTAssertEqual(AiConfirmProjection.formatArguments(members), "{\n  \"b\": 1,\n  \"a\": 2\n}")
    }

    func testNestedObjectIndents() {
        let members = [
            AiJSONMember("opts", .object([AiJSONMember("force", .bool(true))]))
        ]
        XCTAssertEqual(
            AiConfirmProjection.formatArguments(members),
            "{\n  \"opts\": {\n    \"force\": true\n  }\n}"
        )
    }

    func testArraysIndentPerElement() {
        let members = [
            AiJSONMember("ids", .array([.integer(1), .integer(2)]))
        ]
        XCTAssertEqual(
            AiConfirmProjection.formatArguments(members),
            "{\n  \"ids\": [\n    1,\n    2\n  ]\n}"
        )
    }

    func testEmptyNestedContainers() {
        let members = [
            AiJSONMember("obj", .object([])),
            AiJSONMember("arr", .array([]))
        ]
        XCTAssertEqual(
            AiConfirmProjection.formatArguments(members),
            "{\n  \"obj\": {},\n  \"arr\": []\n}"
        )
    }

    func testScalarRendering() {
        let members = [
            AiJSONMember("s", .string("hi")),
            AiJSONMember("n", .null),
            AiJSONMember("whole", .double(2.0)),
            AiJSONMember("frac", .double(1.5))
        ]
        XCTAssertEqual(
            AiConfirmProjection.formatArguments(members),
            "{\n  \"s\": \"hi\",\n  \"n\": null,\n  \"whole\": 2,\n  \"frac\": 1.5\n}"
        )
    }

    func testStringEscaping() {
        let members = [AiJSONMember("msg", .string("say \"hi\"\n\tbye\\"))]
        XCTAssertEqual(
            AiConfirmProjection.formatArguments(members),
            "{\n  \"msg\": \"say \\\"hi\\\"\\n\\tbye\\\\\"\n}"
        )
    }
}

// MARK: - phase / visibility / inline failure

final class AiConfirmVisibilityTests: XCTestCase {
    func testBodyPhase() {
        XCTAssertEqual(AiConfirmProjection.resolvePhase(status: .loading, hasRequest: false), .loading)
        XCTAssertEqual(AiConfirmProjection.resolvePhase(status: .loading, hasRequest: true), .content)
        XCTAssertEqual(AiConfirmProjection.resolvePhase(status: .loaded, hasRequest: false), .empty)
        XCTAssertEqual(AiConfirmProjection.resolvePhase(status: .loaded, hasRequest: true), .content)
        XCTAssertEqual(AiConfirmProjection.resolvePhase(status: .failed("x"), hasRequest: false), .error("x"))
        XCTAssertEqual(AiConfirmProjection.resolvePhase(status: .failed("x"), hasRequest: true), .content)
    }

    func testVisibilityPresentsWithRequestAndHidesWithout() {
        XCTAssertEqual(AiConfirmProjection.resolveVisibility(hasRequest: true, pinned: false), .presented)
        XCTAssertEqual(AiConfirmProjection.resolveVisibility(hasRequest: false, pinned: false), .hidden)
    }

    func testPinnedSuppressesAmbientHide() {
        XCTAssertEqual(AiConfirmProjection.resolveVisibility(hasRequest: false, pinned: true), .presented)
    }

    func testInlineFailureEnvelope() {
        XCTAssertEqual(AiConfirmProjection.inlineFailure(status: .failed("boom"), hasRequest: true), "boom")
        XCTAssertNil(AiConfirmProjection.inlineFailure(status: .failed("boom"), hasRequest: false))
        XCTAssertNil(AiConfirmProjection.inlineFailure(status: .loaded, hasRequest: true))
    }
}

// MARK: - Copy + disabled rules

final class AiConfirmCopyTests: XCTestCase {
    func testCopyResolvesWebDefaults() {
        XCTAssertEqual(AiConfirmProjection.titleText(localize: passthroughLocalize), "Approve Helix action")
        XCTAssertEqual(AiConfirmProjection.toolLabelText(localize: passthroughLocalize), "Tool")
        XCTAssertEqual(AiConfirmProjection.argsLabelText(localize: passthroughLocalize), "Arguments")
        XCTAssertEqual(AiConfirmProjection.confirmLabelText(localize: passthroughLocalize), "Approve")
        XCTAssertEqual(AiConfirmProjection.cancelLabelText(localize: passthroughLocalize), "Cancel")
    }

    func testDisabledRulesMirrorBusy() {
        XCTAssertTrue(AiConfirmProjection.confirmDisabled(busy: true))
        XCTAssertFalse(AiConfirmProjection.confirmDisabled(busy: false))
        XCTAssertTrue(AiConfirmProjection.cancelDisabled(busy: true))
        XCTAssertFalse(AiConfirmProjection.cancelDisabled(busy: false))
    }
}

// MARK: - Accessibility

final class AiConfirmAccessibilityTests: XCTestCase {
    func testSummaryUsesTitleAndFallsBack() {
        XCTAssertEqual(
            AiConfirmAccessibility.summary(title: "Approve Helix action", localize: passthroughLocalize),
            "Approve Helix action"
        )
        XCTAssertEqual(
            AiConfirmAccessibility.summary(title: "  ", localize: passthroughLocalize),
            "Approve Helix action"
        )
    }

    func testToolLabelCombinesLabelAndName() {
        XCTAssertEqual(
            AiConfirmAccessibility.toolLabel(label: "Tool", name: "lock_doors"),
            "Tool: lock_doors"
        )
        XCTAssertEqual(AiConfirmAccessibility.toolLabel(label: "Tool", name: "  "), "Tool")
    }

    func testArgumentsLabelPassesThrough() {
        XCTAssertEqual(AiConfirmAccessibility.argumentsLabel(label: "Arguments"), "Arguments")
    }

    func testCloseLabel() {
        XCTAssertEqual(AiConfirmAccessibility.close(localize: passthroughLocalize), "Close")
    }
}
