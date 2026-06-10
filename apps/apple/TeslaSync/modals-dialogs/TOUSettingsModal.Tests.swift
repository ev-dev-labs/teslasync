//
//  TOUSettingsModal.Tests.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  Adapter + JSON + presets + accessibility coverage for the TOUSettingsModal surface:
//    • `TOUJSON` — the `JSON.stringify(value, null, 2)` pretty printer + the `JSON.parse` object guard.
//    • `TOUSettingsCatalog` — the three presets in `PRESETS` order with their ids / labels / settings.
//    • `TOUSettingsProjection` — `getPayload` (preset lookup + the Custom-JSON parse / object-guard /
//      `tou_settings` wrapping) + the phase resolution matrix.
//    • `TOUSettingsAccessibility` — the dialog summary + tab + preset VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without a
/// bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - JSON pretty printing (web JSON.stringify(_, null, 2))

final class TOUJSONPrettyTests: XCTestCase {
    func testPrettyPrintsOrderedObjectWithTwoSpaceIndent() {
        let value = TOUJSON.obj([
            ("a", 1),
            ("b", .array([2, 3])),
            ("c", "x"),
            ("d", 0.5),
            ("e", true),
            ("f", .null)
        ])
        let expected = [
            "{",
            "  \"a\": 1,",
            "  \"b\": [",
            "    2,",
            "    3",
            "  ],",
            "  \"c\": \"x\",",
            "  \"d\": 0.5,",
            "  \"e\": true,",
            "  \"f\": null",
            "}"
        ].joined(separator: "\n")
        XCTAssertEqual(value.prettyPrinted(), expected)
    }

    func testEmptyObjectAndArrayPrintInline() {
        XCTAssertEqual(TOUJSON.object([]).prettyPrinted(), "{}")
        XCTAssertEqual(TOUJSON.array([]).prettyPrinted(), "[]")
    }

    func testIntegersDropDecimalAndDoublesRoundTrip() {
        XCTAssertEqual(TOUJSON.int(16).prettyPrinted(), "16")
        XCTAssertEqual(TOUJSON.int(0).prettyPrinted(), "0")
        XCTAssertEqual(TOUJSON.double(0.32854).prettyPrinted(), "0.32854")
    }

    func testStringEscapingMatchesJSON() {
        XCTAssertEqual(TOUJSON.string("a\nb").prettyPrinted(), "\"a\\nb\"")
        XCTAssertEqual(TOUJSON.string("q\"q").prettyPrinted(), "\"q\\\"q\"")
    }
}

// MARK: - JSON parsing (web JSON.parse + object guard)

final class TOUJSONParseTests: XCTestCase {
    func testParsesObject() {
        let result = TOUJSON.parseObject("{\"foo\": 1}")
        XCTAssertEqual(result, .success(.object([TOUJSONField("foo", .int(1))])))
    }

    func testFragmentsFailObjectGuardNotSyntax() {
        // Web parity: `JSON.parse` accepts these fragments, then the `typeof === 'object'` guard rejects.
        XCTAssertEqual(TOUJSON.parseObject("42"), .failure(.notObject))
        XCTAssertEqual(TOUJSON.parseObject("\"hi\""), .failure(.notObject))
        XCTAssertEqual(TOUJSON.parseObject("true"), .failure(.notObject))
        XCTAssertEqual(TOUJSON.parseObject("null"), .failure(.notObject))
        XCTAssertEqual(TOUJSON.parseObject("[1, 2]"), .failure(.notObject))
    }

    func testMalformedTextFailsAsInvalidSyntax() {
        XCTAssertEqual(TOUJSON.parseObject("{ not json"), .failure(.invalidSyntax))
        XCTAssertEqual(TOUJSON.parseObject("{\"a\":}"), .failure(.invalidSyntax))
    }
}

// MARK: - Preset catalog (web PRESETS + presetOptions)

final class TOUSettingsCatalogTests: XCTestCase {
    func testThreePresetsInWebOrder() {
        XCTAssertEqual(
            TOUSettingsCatalog.presets.map(\.id),
            ["pge-ev2a", "sce-tou-d", "sdge-tou-dr1"]
        )
    }

    func testOptionLabelsMatchWebFormat() {
        XCTAssertEqual(
            TOUSettingsCatalog.options.map(\.label),
            [
                "PG&E EV2-A — Pacific Gas & Electric",
                "SCE TOU-D — Southern California Edison",
                "SDG&E TOU-DR1 — San Diego Gas & Electric"
            ]
        )
    }

    func testLookupMissAndHit() {
        XCTAssertNil(TOUSettingsCatalog.preset(id: ""))
        XCTAssertNil(TOUSettingsCatalog.settings(id: "nope"))
        XCTAssertEqual(TOUSettingsCatalog.preset(id: "sce-tou-d")?.name, "SCE TOU-D")
        XCTAssertNotNil(TOUSettingsCatalog.settings(id: "pge-ev2a"))
    }

    func testEveryPresetPreviewIsAValidTouSettingsObject() {
        for preset in TOUSettingsCatalog.presets {
            let preview = preset.settings.prettyPrinted()
            XCTAssertTrue(preview.hasPrefix("{\n  \"tou_settings\": {"))
            // The pretty output round-trips through the parser back to a `tou_settings` envelope.
            switch TOUJSON.parseObject(preview) {
            case let .success(object):
                XCTAssertTrue(object.hasKey("tou_settings"))
            case let .failure(error):
                XCTFail("preset \(preset.id) preview did not parse: \(error)")
            }
        }
    }
}

// MARK: - Projection: getPayload

final class TOUSettingsPayloadTests: XCTestCase {
    private func customRoot(_ json: String) -> TOUJSON? {
        switch TOUSettingsProjection.payload(tab: .custom, presetSettings: nil, customJSON: json) {
        case let .success(payload): payload.root
        case .failure: nil
        }
    }

    func testPresetTabReturnsSelectedSettings() throws {
        let settings = TOUSettingsCatalog.settings(id: "pge-ev2a")
        let result = TOUSettingsProjection.payload(
            tab: .preset,
            presetSettings: settings,
            customJSON: ""
        )
        XCTAssertEqual(result, try .success(XCTUnwrap(settings)))
    }

    func testPresetTabWithoutSelectionFailsNoPreset() {
        let result = TOUSettingsProjection.payload(tab: .preset, presetSettings: nil, customJSON: "")
        XCTAssertEqual(result, .failure(.noPreset))
    }

    func testCustomEmptyOrBlankFailsEmptyJSON() {
        XCTAssertEqual(
            TOUSettingsProjection.payload(tab: .custom, presetSettings: nil, customJSON: ""),
            .failure(.emptyJSON)
        )
        XCTAssertEqual(
            TOUSettingsProjection.payload(tab: .custom, presetSettings: nil, customJSON: "   \n\t "),
            .failure(.emptyJSON)
        )
    }

    func testCustomNonObjectFailsNotObject() {
        XCTAssertEqual(
            TOUSettingsProjection.payload(tab: .custom, presetSettings: nil, customJSON: "[1,2]"),
            .failure(.notObject)
        )
        XCTAssertEqual(
            TOUSettingsProjection.payload(tab: .custom, presetSettings: nil, customJSON: "42"),
            .failure(.notObject)
        )
    }

    func testCustomMalformedFailsInvalidJSON() {
        XCTAssertEqual(
            TOUSettingsProjection.payload(tab: .custom, presetSettings: nil, customJSON: "{ bad"),
            .failure(.invalidJSON)
        )
    }

    func testCustomObjectWithoutTouSettingsIsWrapped() {
        let root = customRoot("{\"optimization_strategy\": \"economics\"}")
        XCTAssertEqual(
            root,
            .object([
                TOUJSONField("tou_settings", .object([TOUJSONField("optimization_strategy", .string("economics"))]))
            ])
        )
    }

    func testCustomObjectWithTouSettingsPassesThrough() {
        let root = customRoot("{\"tou_settings\": {\"a\": 1}}")
        XCTAssertEqual(
            root,
            .object([TOUJSONField("tou_settings", .object([TOUJSONField("a", .int(1))]))])
        )
    }
}

// MARK: - Projection: phase resolution

final class TOUSettingsPhaseTests: XCTestCase {
    private let capable = TOUSettingsContext(siteId: 1, siteName: "Home", touCapable: true)
    private let notCapable = TOUSettingsContext(siteId: 2, siteName: "Cabin", touCapable: false)

    func testLoadingResolvesByContextPresence() {
        XCTAssertEqual(TOUSettingsProjection.resolvePhase(status: .loading, context: nil), .loading)
        XCTAssertEqual(TOUSettingsProjection.resolvePhase(status: .loading, context: capable), .content)
    }

    func testLoadedResolvesEmptyWithoutTouCapableSite() {
        XCTAssertEqual(TOUSettingsProjection.resolvePhase(status: .loaded, context: nil), .empty)
        XCTAssertEqual(TOUSettingsProjection.resolvePhase(status: .loaded, context: notCapable), .empty)
        XCTAssertEqual(TOUSettingsProjection.resolvePhase(status: .loaded, context: capable), .content)
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(
            TOUSettingsProjection.resolvePhase(status: .failed("boom"), context: nil),
            .error("boom")
        )
        XCTAssertEqual(
            TOUSettingsProjection.resolvePhase(status: .failed("boom"), context: capable),
            .content
        )
    }
}

// MARK: - Validation error copy

final class TOUSettingsValidationErrorTests: XCTestCase {
    func testEachErrorCarriesItsWebKeyAndFallback() {
        XCTAssertEqual(TOUSettingsValidationError.noPreset.messageKey, "energy.tou.errorNoPreset")
        XCTAssertEqual(TOUSettingsValidationError.noPreset.messageFallback, "Please select a rate plan")
        XCTAssertEqual(TOUSettingsValidationError.emptyJSON.messageKey, "energy.tou.errorEmptyJSON")
        XCTAssertEqual(TOUSettingsValidationError.emptyJSON.messageFallback, "Please enter the TOU settings JSON")
        XCTAssertEqual(TOUSettingsValidationError.notObject.messageKey, "energy.tou.errorNotObject")
        XCTAssertEqual(TOUSettingsValidationError.notObject.messageFallback, "JSON must be an object")
        XCTAssertEqual(TOUSettingsValidationError.invalidJSON.messageKey, "energy.tou.errorInvalidJSON")
        XCTAssertEqual(TOUSettingsValidationError.invalidJSON.messageFallback, "Invalid JSON — please check syntax")
    }
}

// MARK: - Accessibility

final class TOUSettingsAccessibilityTests: XCTestCase {
    func testDialogLabelIsTitle() {
        XCTAssertEqual(
            TOUSettingsAccessibility.dialogLabel(localize: passthroughLocalize),
            "Update Rate Plan"
        )
    }

    func testTabLabelAppendsSelectedState() {
        XCTAssertEqual(
            TOUSettingsAccessibility.tabLabel(title: "Preset Tariff", selected: false, localize: passthroughLocalize),
            "Preset Tariff"
        )
        XCTAssertEqual(
            TOUSettingsAccessibility.tabLabel(title: "Preset Tariff", selected: true, localize: passthroughLocalize),
            "Preset Tariff, selected"
        )
    }

    func testPresetLabelJoinsFieldAndSelection() {
        XCTAssertEqual(
            TOUSettingsAccessibility.presetLabel(field: "Rate Plan", selection: "Choose a rate plan…"),
            "Rate Plan, Choose a rate plan…"
        )
    }
}
